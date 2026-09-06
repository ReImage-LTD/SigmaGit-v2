// cmd/agent/executor.go — Bridge between the API job payload and the act runner library.

package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/url"
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
	if len(job.ID) != 36 || strings.ContainsAny(job.ID, "/\\.") {
		return errors.New("invalid job ID")
	}
	jobDir := filepath.Join(e.cfg.WorkDir, "jobs", job.ID)
	if err := os.MkdirAll(jobDir, 0755); err != nil {
		return e.failJob(job, fmt.Sprintf("failed to create job dir: %v", err))
	}
	// UUID assignment IDs keep cleanup inside the runner-owned jobs directory.
	defer os.RemoveAll(jobDir)

	repoDir := filepath.Join(jobDir, "repo")

	// Step 1: Checkout the repository
	if err := e.checkoutRepo(ctx, job, repoDir); err != nil {
		if errors.Is(context.Cause(ctx), errAssignmentCancelled) {
			return errAssignmentCancelled
		}
		return e.failJob(job, fmt.Sprintf("checkout failed: %v", err))
	}

	// Step 2: Write event.json
	eventPath := filepath.Join(jobDir, "event.json")
	event := make(map[string]interface{}, len(job.EventPayload)+3)
	for key, value := range job.EventPayload {
		event[key] = value
	}
	event["ref"] = "refs/heads/" + job.Branch
	event["after"] = job.CommitSha
	event["repository"] = map[string]interface{}{
		"name": job.RepoName, "full_name": job.RepoOwner + "/" + job.RepoName,
		"owner": map[string]string{"login": job.RepoOwner}, "default_branch": job.Branch,
	}
	eventData, _ := json.Marshal(event)
	if err := os.WriteFile(eventPath, eventData, 0644); err != nil {
		return e.failJob(job, fmt.Sprintf("failed to write event.json: %v", err))
	}

	// Step 3: Execute via act
	stepResults, runErr := e.runWithAct(ctx, job, repoDir, eventPath)
	if errors.Is(context.Cause(ctx), errAssignmentCancelled) {
		// Cancellation is already terminal in the API; never overwrite it with
		// a failure report from the interrupted container.
		return errAssignmentCancelled
	}

	// Step 4: Report completion
	conclusion := "success"
	status := "completed"
	if runErr != nil {
		conclusion = "failure"
		status = "failed"
		log.Printf("[Executor] Job %s failed: %v", job.ID, runErr)
	}

	if err := e.client.ReportCompletion(e.cfg.RunnerID, job.ID, status, conclusion, stepResults); err != nil {
		return fmt.Errorf("report completion: %w", err)
	}

	return runErr
}

// checkoutRepo clones/fetches the repo at the specified commit using the API's git endpoint.
func (e *Executor) checkoutRepo(ctx context.Context, job *JobPayload, destDir string) error {
	if job.RepoOwner == "" || job.RepoName == "" {
		return errors.New("assignment is missing repository coordinates")
	}
	repoURL := strings.TrimRight(e.cfg.APIURL, "/") + "/" + url.PathEscape(job.RepoOwner) + "/" + url.PathEscape(job.RepoName) + ".git"
	if job.CommitSha == "" {
		return errors.New("assignment is missing commit SHA")
	}
	// Keep credentials out of argv, clone errors, and .git/config.
	gitEnv := append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "GCM_INTERACTIVE=never", "GIT_CONFIG_COUNT=3",
		"GIT_CONFIG_KEY_0=http.extraHeader", "GIT_CONFIG_VALUE_0=Authorization: Bearer "+e.cfg.Token,
		"GIT_CONFIG_KEY_1=http.followRedirects", "GIT_CONFIG_VALUE_1=false",
		"GIT_CONFIG_KEY_2=credential.helper", "GIT_CONFIG_VALUE_2=")
	runGit := func(args ...string) error {
		cmd := exec.CommandContext(ctx, "git", args...)
		cmd.Env = gitEnv
		out, err := cmd.CombinedOutput()
		if err != nil {
			return fmt.Errorf("git failed: %w: %s", err, strings.ReplaceAll(string(out), e.cfg.Token, "[REDACTED]"))
		}
		return nil
	}
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return err
	}
	if err := runGit("init", destDir); err != nil {
		return err
	}
	if err := runGit("-C", destDir, "remote", "add", "origin", repoURL); err != nil {
		return err
	}
	ref := job.CommitSha
	if ref == "HEAD" {
		ref = "refs/heads/" + job.Branch
	}
	if strings.HasPrefix(ref, "-") {
		return errors.New("invalid checkout ref")
	}
	// Fetch the assigned revision, even if it is not on the default branch or
	// lies outside a shallow clone's initial history. Never run a different HEAD.
	if err := runGit("-C", destDir, "fetch", "--no-tags", "origin", ref); err != nil {
		return err
	}
	return runGit("-C", destDir, "checkout", "--detach", "FETCH_HEAD")
}

// runWithAct executes the workflow using the act library.
func (e *Executor) runWithAct(
	ctx context.Context,
	job *JobPayload,
	repoDir string,
	eventPath string,
) ([]StepResult, error) {
	hook := &logStreamHook{client: e.client, runnerID: e.cfg.RunnerID, jobID: job.ID}
	stopLogs := make(chan struct{})
	logsDone := make(chan struct{})
	go func() {
		defer close(logsDone)
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-stopLogs:
				return
			case <-ticker.C:
				if err := hook.Flush(); err != nil {
					log.Printf("[Executor] Log flush: %v", err)
				}
			}
		}
	}()
	defer func() { close(stopLogs); <-logsDone }()
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

	var plan *model.Plan
	if job.WorkflowDefinition["executionMode"] == "workflow" {
		plan, err = planner.PlanAll()
	} else {
		plan, err = planner.PlanJob(job.Name)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to create execution plan: %w", err)
	}
	if plan == nil || len(plan.Stages) == 0 {
		return nil, errors.New("assigned workflow has no executable jobs")
	}

	// Build runner config
	runnerCfg := &runner.Config{
		Actor:                      "runner",
		GitHubInstance:             "github.com",
		RemoteName:                 "origin",
		Workdir:                    repoDir,
		EventName:                  job.EventName,
		EventPath:                  eventPath,
		DefaultBranch:              job.Branch,
		ReuseContainers:            false,
		ForcePull:                  false,
		ErrorOnUnsupportedPlatform: true,
		LogOutput:                  true,
		JSONLogger:                 false,
		Env:                        map[string]string{},
		Secrets:                    map[string]string{},
		Platforms:                  map[string]string{"ubuntu-latest": e.cfg.JobImage, "ubuntu-24.04": e.cfg.JobImage, "ubuntu-22.04": e.cfg.JobImage, "self-hosted": e.cfg.JobImage},
		AutoRemove:                 true,
		UseGitIgnore:               true,
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
	if errors.Is(context.Cause(ctx), errAssignmentCancelled) {
		return nil, errAssignmentCancelled
	}

	if err := hook.Flush(); err != nil {
		runErr = errors.Join(runErr, fmt.Errorf("flush logs: %w", err))
	}
	return hook.Results(runErr), runErr
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
	logger := go_log.New()
	logger.SetLevel(f.logger.GetLevel())
	logger.SetOutput(io.Discard)
	logger.ReplaceHooks(f.logger.Hooks)
	return logger
}
