package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"time"
)

var errAssignmentCancelled = errors.New("assignment cancelled by API")

// KeepAlive refreshes the lease without asking for another assignment.
func (c *APIClient) KeepAlive(runnerID, jobID string) (bool, error) {
	body, status, err := c.do("POST", "/api/runners/"+runnerID+"/heartbeat", map[string]string{"jobId": jobID})
	if err != nil {
		return false, err
	}
	if status != 200 {
		return false, fmt.Errorf("keepalive: unexpected status %d", status)
	}
	var result struct {
		Cancelled bool `json:"cancelled"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return false, err
	}
	return result.Cancelled, nil
}

func executeWithHeartbeat(ctx context.Context, executor *Executor, client *APIClient, cfg *RunnerConfig, job *JobPayload) error {
	jobCtx, cancel := context.WithCancelCause(ctx)
	defer cancel(nil)
	done := make(chan struct{})
	defer func() { cancel(nil); <-done }()
	go func() {
		defer close(done)
		interval := time.Duration(cfg.PollInterval) * time.Second
		if interval <= 0 || interval > 30*time.Second {
			interval = 5 * time.Second
		}
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-jobCtx.Done():
				return
			case <-ticker.C:
				cancelled, err := client.KeepAlive(cfg.RunnerID, job.ID)
				if err != nil {
					log.Printf("[Agent] Keepalive failed: %v", err)
					continue
				}
				if cancelled {
					cancel(errAssignmentCancelled)
					return
				}
			}
		}
	}()
	return executor.Execute(jobCtx, job)
}
