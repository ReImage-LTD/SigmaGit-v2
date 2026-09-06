package main

import (
	"context"
	"os"
	"testing"
	"time"
)

// Opt-in: the API harness supplies an isolated database and private repository.
func TestAPIEndToEnd(t *testing.T) {
	baseURL := os.Getenv("SIGMAGIT_TEST_API_URL")
	if baseURL == "" {
		t.Skip("run apps/api/integration/runner-e2e.ts to start the isolated API")
	}
	client := NewAPIClient(baseURL + "/")
	if _, _, err := client.Register("unauthorized", []string{}, "linux", "amd64", "test"); err == nil {
		t.Fatal("registration without a secret succeeded")
	}
	client.SetToken(os.Getenv("SIGMAGIT_TEST_REGISTRATION_SECRET"))
	id, token, err := client.Register("integration-runner", []string{"self-hosted", "linux", "amd64"}, "linux", "amd64", "test")
	if err != nil {
		t.Fatal(err)
	}
	client.SetToken(token)
	job, err := client.Heartbeat(id)
	if err != nil || job == nil {
		t.Fatalf("assignment: %v, job=%v", err, job)
	}
	if job.CommitSha != os.Getenv("SIGMAGIT_TEST_COMMIT") {
		t.Fatal("assignment returned the wrong commit")
	}
	// A normal stream of heartbeats must not hit the anonymous 10-write budget.
	for i := 0; i < 20; i++ {
		cancelled, err := client.KeepAlive(id, job.ID)
		if err != nil || cancelled {
			t.Fatalf("keepalive %d: cancelled=%v, err=%v", i, cancelled, err)
		}
	}
	cfg := &RunnerConfig{APIURL: baseURL, RunnerID: id, Token: token, WorkDir: t.TempDir(), PollInterval: 1, JobImage: "node:24-bookworm"}
	executor := NewExecutor(cfg, client)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	if err := executeWithHeartbeat(ctx, executor, client, cfg, job); err != nil {
		t.Fatal(err)
	}
	// Completion retries must be safe after the first response is lost.
	if err := client.ReportCompletion(id, job.ID, "completed", "success", nil); err != nil {
		t.Fatal(err)
	}
	if err := client.ReportCompletion(id, job.ID, "completed", "failure", nil); err == nil {
		t.Fatal("conflicting completion retry succeeded")
	}
	if next, err := client.Heartbeat(id); err != nil || next != nil {
		t.Fatalf("unexpected second assignment: %v %v", next, err)
	}
	// Read access expires as soon as the assignment becomes terminal.
	if err := executor.checkoutRepo(ctx, job, t.TempDir()); err == nil {
		t.Fatal("terminal runner retained private repository access")
	}
}

func TestAPIFailedJob(t *testing.T) {
	baseURL := os.Getenv("SIGMAGIT_TEST_API_URL")
	if baseURL == "" {
		t.Skip("requires isolated API harness")
	}
	client := NewAPIClient(baseURL)
	client.SetToken(os.Getenv("SIGMAGIT_TEST_RUNNER_TOKEN"))
	id := os.Getenv("SIGMAGIT_TEST_RUNNER_ID")
	job, err := client.Heartbeat(id)
	if err != nil || job == nil {
		t.Fatalf("assignment: %v %v", job, err)
	}
	cfg := &RunnerConfig{APIURL: baseURL, RunnerID: id, Token: client.token, WorkDir: t.TempDir(), PollInterval: 1, JobImage: "node:24-bookworm"}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	if err := executeWithHeartbeat(ctx, NewExecutor(cfg, client), client, cfg, job); err == nil {
		t.Fatal("failed or cancelled job reported success")
	}
	if ctx.Err() != nil {
		t.Fatal("job did not stop within its test deadline")
	}
}
