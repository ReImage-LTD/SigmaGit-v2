package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/nektos/act/pkg/runner"
	go_log "github.com/sirupsen/logrus"
)

const maxStepBytes = 1024 * 1024
const maxChunkBytes = 64 * 1024

type streamedStep struct {
	key, name, pending, status string
	number, bytes, exitCode    int
}

// One bounded buffer per step and a single ordered writer replace unbounded
// per-line goroutines. Completion waits for this writer to drain.
type logStreamHook struct {
	client          *APIClient
	runnerID, jobID string
	mu, flushMu     sync.Mutex
	steps           []*streamedStep
}

func (h *logStreamHook) Levels() []go_log.Level { return go_log.AllLevels }

func (h *logStreamHook) Fire(entry *go_log.Entry) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	name, _ := entry.Data["step"].(string)
	if name == "" {
		name = "run"
	}
	identity, _ := json.Marshal([]interface{}{entry.Data["jobID"], entry.Data["matrix"], entry.Data["stage"], entry.Data["stepID"], name})
	key := string(identity)
	var step *streamedStep
	for _, candidate := range h.steps {
		if candidate.key == key {
			step = candidate
			break
		}
	}
	if step == nil {
		if len(h.steps) >= 200 {
			return nil
		}
		step = &streamedStep{key: key, name: truncateUTF8(name, 200), number: len(h.steps) + 1, status: "in_progress"}
		h.steps = append(h.steps, step)
	}
	message := entry.Message
	// Hooks run before logrus formatters, so apply dynamic masks here too.
	if entry.Context != nil {
		for _, mask := range *runner.Masks(entry.Context) {
			if mask != "" {
				message = strings.ReplaceAll(message, mask, "***")
			}
		}
	}
	if h.client.token != "" {
		message = strings.ReplaceAll(message, h.client.token, "[REDACTED]")
	}
	chunk := truncateUTF8(message+"\n", maxStepBytes-step.bytes)
	step.pending += chunk
	step.bytes += len(chunk)
	if result, ok := entry.Data["stepResult"]; ok {
		switch fmt.Sprint(result) {
		case "success", "skipped":
			step.status = "completed"
		case "failure":
			step.status = "failed"
			step.exitCode = 1
		}
	}
	return nil
}

func truncateUTF8(s string, limit int) string {
	if limit <= 0 {
		return ""
	}
	if len(s) <= limit {
		return s
	}
	s = s[:limit]
	for !utf8.ValidString(s) && len(s) > 0 {
		s = s[:len(s)-1]
	}
	return s
}

func (h *logStreamHook) Flush() error {
	h.flushMu.Lock()
	defer h.flushMu.Unlock()
	h.mu.Lock()
	steps := append([]*streamedStep(nil), h.steps...)
	h.mu.Unlock()
	for _, step := range steps {
		for {
			h.mu.Lock()
			chunk := truncateUTF8(step.pending, maxChunkBytes)
			name, number := step.name, step.number
			h.mu.Unlock()
			if chunk == "" {
				break
			}
			if err := h.client.ReportProgress(h.runnerID, h.jobID, name, number, "in_progress", chunk, nil); err != nil {
				return err
			}
			h.mu.Lock()
			step.pending = step.pending[len(chunk):]
			h.mu.Unlock()
		}
	}
	return nil
}

func (h *logStreamHook) Results(runErr error) []StepResult {
	h.mu.Lock()
	defer h.mu.Unlock()
	results := make([]StepResult, 0, len(h.steps))
	for _, step := range h.steps {
		status, exitCode := step.status, step.exitCode
		if status == "in_progress" {
			status = "completed"
			if runErr != nil {
				status = "failed"
				exitCode = 1
			}
		}
		results = append(results, StepResult{Name: step.name, Number: step.number, Status: status, ExitCode: exitCode})
	}
	return results
}
