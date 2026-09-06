// cmd/agent/executor.go — Bridge between the API job payload and the act runner library.

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/nektos/act/pkg/model"
	"github.com/nektos/act/pkg/runner"
	go_log "github.com/sirupsen/logrus"
)

// Executor runs workflow jobs by bridging the API payload to act's runner.
type Executor struct {
	cfg    *RunnerConfig
	client *APIClient
}

func NewExecutor(cfg *RunnerConfig, client *APIClient) *Executor {
	return &Executor{cfg: cfg, client: client}
}

// Execute runs a single job payload.
func (e *Executor) Execute(ctx context.Context, job *JobPayload) error {
	jobDir := filepath.Join(e.cfg.WorkDir, "jobs", job.ID)
	if err := os.MkdirAll(jobDir, 0755); err != nil {
		return fmt.Errorf("failed to create job dir: %w", err)
	}
	defer os.RemoveAll(jobDir)

	repoDir := filepath.Join(jobDir, "repo")

	// Step 1: Checkout the repository
	if err := e.checkoutRepo(ctx, job, repoDir); err != nil {
		return e.failJob(job, fmt.Sprintf("checkout failed: %v", err))
	}

	// Step 2: Write event.json
	eventPath := filepath.Join(jobDir, "event.json")
	eventData, _ := json.Marshal(job.EventPayload)
	if err := os.WriteFile(eventPath, eventData, 0644); err != nil {
		return e.failJob(job, fmt.Sprintf("failed to write event.json: %v", err))
	}

	// Step 3: Execute via act
	stepResults, runErr := e.runWithAct(ctx, job, repoDir, eventPath)

	// Step 4: Report completion
	conclusion := "success"
	status := "completed"
	if runErr != nil {
		conclusion = "failure"
		status = "failed"
		log.Printf("[Executor] Job %s failed: %v", job.ID, runErr)
	}

	if err := e.client.ReportCompletion(e.cfg.RunnerID, job.ID, status, conclusion, stepResults); err != nil {
		log.Printf("[Executor] Failed to report completion for job %s: %v", job.ID, err)
	}

	return runErr
}

// checkoutRepo clones/fetches the repo at the specified commit using the API's git endpoint.
func (e *Executor) checkoutRepo(ctx context.Context, job *JobPayload, destDir string) error {
	repoURL := fmt.Sprintf("%s/%s.git", e.cfg.APIURL, job.ID)

	if job.RepoOwner != "" && job.RepoName != "" {
		repoURL = fmt.Sprintf("%s/%s/%s.git", e.cfg.APIURL, job.RepoOwner, job.RepoName)
	}

	// Try to extract owner/name from event payload if available
	if ep, ok := job.EventPayload["repository"].(map[string]interface{}); ok {
		owner, _ := ep["owner"].(string)
		name, _ := ep["name"].(string)
		if owner != "" && name != "" {
			repoURL = fmt.Sprintf("%s/%s/%s.git", e.cfg.APIURL, owner, name)
		}
	}

	// Also check workflowDefinition for repo info
	if wd := job.WorkflowDefinition; wd != nil {
		if owner, ok := wd["repoOwner"].(string); ok {
			if name, ok := wd["repoName"].(string); ok {
				repoURL = fmt.Sprintf("%s/%s/%s.git", e.cfg.APIURL, owner, name)
			}
		}
	}

	log.Printf("[Executor] Cloning %s@%s into %s", repoURL, job.CommitSha, destDir)

	if err := os.MkdirAll(destDir, 0755); err != nil {
		return err
	}

	// Use git clone with basic auth (runner token)
	cloneURL := strings.Replace(repoURL, "://", fmt.Sprintf("://runner:%s@", e.cfg.Token), 1)

	cmd := exec.CommandContext(ctx, "git", "clone", "--depth=50", cloneURL, destDir)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("git clone failed: %w\nOutput: %s", err, out)
	}

	// Checkout specific commit if provided
	if job.CommitSha != "" && job.CommitSha != "HEAD" {
		checkout := exec.CommandContext(ctx, "git", "-C", destDir, "checkout", job.CommitSha)
		if out, err := checkout.CombinedOutput(); err != nil {
			log.Printf("[Executor] Warning: git checkout %s failed: %v\nOutput: %s", job.CommitSha, err, out)
		}
	}

	return nil
}

// runWithAct executes the workflow using the act library.
func (e *Executor) runWithAct(
	ctx context.Context,
	job *JobPayload,
	repoDir string,
	eventPath string,
) ([]StepResult, error) {
	// Collect per-step logs
	stepLogs := make(map[string]*bytes.Buffer)
	stepOrder := []string{}

	// Custom logrus hook to capture output and stream to API
	hook := &logStreamHook{
		client:    e.client,
		runnerID:  e.cfg.RunnerID,
		jobID:     job.ID,
		stepLogs:  stepLogs,
		stepOrder: &stepOrder,
	}

	logger := go_log.New()
	logger.SetLevel(go_log.DebugLevel)
	logger.AddHook(hook)
	logger.SetOutput(io.Discard) // all output via hook

	// Extract workflow content from job definition
	workflowContent := ""
	if wd := job.WorkflowDefinition; wd != nil {
		if wc, ok := wd["workflowContent"].(string); ok {
			workflowContent = wc
		}
	}

	if workflowContent == "" {
		return nil, fmt.Errorf("workflowContent missing from job definition")
	}

	// Build plan using current model API: planner + PlanJob / PlanAll
	planner, err := model.NewSingleWorkflowPlanner("workflow.yml", strings.NewReader(workflowContent))
	if err != nil {
		return nil, fmt.Errorf("failed to parse workflow YAML: %w", err)
	}

	plan, err := planner.PlanJob(job.Name)
	if err != nil {
		return nil, fmt.Errorf("failed to create job execution plan: %w", err)
	}
	if plan == nil || len(plan.Stages) == 0 {
		plan, err = planner.PlanAll()
		if err != nil {
			return nil, fmt.Errorf("failed to create fallback execution plan: %w", err)
		}
	}

	// Build runner config
	runnerCfg := &runner.Config{
		Actor:           "runner",
		Workdir:         repoDir,
		EventName:       job.EventName,
		EventPath:       eventPath,
		DefaultBranch:   job.Branch,
		ReuseContainers: false,
		ForcePull:       false,
		LogOutput:       true,
		JSONLogger:      false,
		Env:             map[string]string{},
		Secrets:         map[string]string{},
		Platforms:       map[string]string{},
		AutoRemove:      true,
		UseGitIgnore:    true,
	}

	r, err := runner.New(runnerCfg)
	if err != nil {
		return nil, fmt.Errorf("failed to create runner: %w", err)
	}

	executor := r.NewPlanExecutor(plan)

	// WithJobLoggerFactory lives in pkg/runner; it expects a JobLoggerFactory (WithJobLogger() *logrus.Logger).
	jobLoggerFactory := &jobLoggerFactory{logger: logger}
	runCtx := runner.WithJobLoggerFactory(ctx, jobLoggerFactory)

	runErr := executor(runCtx)

	// Build step results
	var results []StepResult
	for i, name := range stepOrder {
		buf := stepLogs[name]
		logOut := ""
		if buf != nil {
			logOut = buf.String()
		}
		exitCode := 0
		if runErr != nil {
			exitCode = 1
		}
		status := "completed"
		if runErr != nil && i == len(stepOrder)-1 {
			status = "failed"
		}
		results = append(results, StepResult{
			Name:      name,
			Number:    i + 1,
			Status:    status,
			ExitCode:  exitCode,
			LogOutput: logOut,
		})
	}

	return results, runErr
}

func (e *Executor) failJob(job *JobPayload, reason string) error {
	log.Printf("[Executor] Failing job %s: %s", job.ID, reason)
	if err := e.client.ReportCompletion(e.cfg.RunnerID, job.ID, "failed", "failure", []StepResult{{
		Name:      "error",
		Number:    1,
		Status:    "failed",
		ExitCode:  1,
		LogOutput: reason,
	}}); err != nil {
		log.Printf("[Executor] Warning: failed to report failure for job %s: %v", job.ID, err)
	}
	return errors.New(reason)
}

// jobLoggerFactory implements runner.JobLoggerFactory so the plan executor gets a logger from context.
type jobLoggerFactory struct {
	logger *go_log.Logger
}

func (f *jobLoggerFactory) WithJobLogger() *go_log.Logger {
	return f.logger
}

// logStreamHook captures logrus entries and streams them to the API.
type logStreamHook struct {
	client    *APIClient
	runnerID  string
	jobID     string
	stepLogs  map[string]*bytes.Buffer
	stepOrder *[]string
	stepNum   int
}

func (h *logStreamHook) Levels() []go_log.Level {
	return go_log.AllLevels
}

func (h *logStreamHook) Fire(entry *go_log.Entry) error {
	stepName, _ := entry.Data["step"].(string)
	if stepName == "" {
		stepName = "run"
	}

	msg := fmt.Sprintf("[%s] %s\n", time.Now().Format("15:04:05"), entry.Message)

	// Accumulate in buffer
	if _, exists := h.stepLogs[stepName]; !exists {
		h.stepLogs[stepName] = &bytes.Buffer{}
		*h.stepOrder = append(*h.stepOrder, stepName)
		h.stepNum++
		// Report step start
		_ = h.client.ReportProgress(h.runnerID, h.jobID, stepName, h.stepNum, "in_progress", "", nil)
	}
	h.stepLogs[stepName].WriteString(msg)

	// Stream chunk to API (best-effort, non-blocking via goroutine)
	stepNum := h.stepNum
	go func() {
		_ = h.client.ReportProgress(h.runnerID, h.jobID, stepName, stepNum, "in_progress", msg, nil)
	}()

	return nil
}
