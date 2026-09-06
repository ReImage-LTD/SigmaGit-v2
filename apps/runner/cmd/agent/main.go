// cmd/agent/main.go — Sigmagit runner agent entrypoint
//
// This agent registers with the Sigmagit API, polls for jobs via heartbeat,
// executes them using the act runner library, and reports results back.
//
// Environment variables:
//   SIGMAGIT_API_URL        — base URL of the Sigmagit API (required)
//   SIGMAGIT_RUNNER_NAME    — human-readable runner name (default: hostname)
//   SIGMAGIT_RUNNER_LABELS  — comma-separated labels (default: self-hosted,linux,<arch>)
//   SIGMAGIT_RUNNER_TOKEN   — runner token if already registered
//   SIGMAGIT_RUNNER_ID      — runner ID if already registered
//   SIGMAGIT_RUNNER_WORKDIR — base directory for job checkouts (default: /tmp/sigmagit-runner)
//   SIGMAGIT_POLL_INTERVAL  — seconds between heartbeats (default: 5)
//   SIGMAGIT_CONFIG_PATH    — path to config JSON file (default: ~/.sigmagit-runner/config.json)

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// RunnerConfig holds all runtime configuration.
type RunnerConfig struct {
	APIURL             string   `json:"apiUrl"`
	RunnerID           string   `json:"runnerId"`
	Token              string   `json:"token"`
	Name               string   `json:"name"`
	Labels             []string `json:"labels"`
	OS                 string   `json:"os"`
	Arch               string   `json:"arch"`
	Version            string   `json:"version"`
	WorkDir            string   `json:"workDir"`
	PollInterval       int      `json:"pollInterval"`
	ConfigPath         string   `json:"-"`
	RegistrationSecret string   `json:"-"`
	JobImage           string   `json:"jobImage"`
}

var agentVersion = "1.0.0"

func loadConfig() *RunnerConfig {
	hostname, _ := os.Hostname()

	configPath := os.Getenv("SIGMAGIT_CONFIG_PATH")
	if configPath == "" {
		home, _ := os.UserHomeDir()
		configPath = filepath.Join(home, ".sigmagit-runner", "config.json")
	}

	cfg := &RunnerConfig{
		APIURL:             os.Getenv("SIGMAGIT_API_URL"),
		Name:               valueOrDefault(os.Getenv("SIGMAGIT_RUNNER_NAME"), hostname),
		WorkDir:            valueOrDefault(os.Getenv("SIGMAGIT_RUNNER_WORKDIR"), "/tmp/sigmagit-runner"),
		OS:                 runtime.GOOS,
		Arch:               runtime.GOARCH,
		Version:            agentVersion,
		PollInterval:       parseIntOrDefault(os.Getenv("SIGMAGIT_POLL_INTERVAL"), 5),
		ConfigPath:         configPath,
		RegistrationSecret: os.Getenv("SIGMAGIT_RUNNER_REGISTRATION_SECRET"),
		JobImage:           valueOrDefault(os.Getenv("SIGMAGIT_RUNNER_IMAGE"), "node:24-bookworm"),
	}

	// Labels
	rawLabels := os.Getenv("SIGMAGIT_RUNNER_LABELS")
	if rawLabels != "" {
		cfg.Labels = strings.Split(rawLabels, ",")
		for i, l := range cfg.Labels {
			cfg.Labels[i] = strings.TrimSpace(l)
		}
	} else {
		cfg.Labels = []string{"self-hosted", runtime.GOOS, runtime.GOARCH}
	}

	// Try loading persisted token/ID from config file
	if data, err := os.ReadFile(configPath); err == nil {
		var persisted struct {
			RunnerID string `json:"runnerId"`
			Token    string `json:"token"`
		}
		if json.Unmarshal(data, &persisted) == nil {
			cfg.RunnerID = persisted.RunnerID
			cfg.Token = persisted.Token
		}
	}

	// Env overrides saved config
	if v := os.Getenv("SIGMAGIT_RUNNER_TOKEN"); v != "" {
		cfg.Token = v
	}
	if v := os.Getenv("SIGMAGIT_RUNNER_ID"); v != "" {
		cfg.RunnerID = v
	}

	return cfg
}

func saveConfig(cfg *RunnerConfig) error {
	dir := filepath.Dir(cfg.ConfigPath)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(map[string]string{
		"runnerId": cfg.RunnerID,
		"token":    cfg.Token,
	}, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(cfg.ConfigPath, data, 0600)
}

func valueOrDefault(v, def string) string {
	if v != "" {
		return v
	}
	return def
}

func parseIntOrDefault(s string, def int) int {
	if v, err := strconv.Atoi(s); err == nil && v > 0 {
		return v
	}
	return def
}

func main() {
	cfg := loadConfig()

	if cfg.APIURL == "" {
		log.Fatal("[Agent] SIGMAGIT_API_URL is required")
	}

	// Ensure workdir exists
	if err := os.MkdirAll(cfg.WorkDir, 0755); err != nil {
		log.Fatalf("[Agent] Failed to create workdir %s: %v", cfg.WorkDir, err)
	}

	client := NewAPIClient(cfg.APIURL)

	// Register if we don't have a token yet
	if cfg.Token == "" || cfg.RunnerID == "" {
		log.Printf("[Agent] Registering runner %q with %s...", cfg.Name, cfg.APIURL)
		client.SetToken(cfg.RegistrationSecret)
		id, token, err := client.Register(cfg.Name, cfg.Labels, cfg.OS, cfg.Arch, cfg.Version)
		if err != nil {
			log.Fatalf("[Agent] Registration failed: %v", err)
		}
		cfg.RunnerID = id
		cfg.Token = token
		if err := saveConfig(cfg); err != nil {
			log.Printf("[Agent] Warning: failed to save config: %v", err)
		}
		log.Printf("[Agent] Registered as runner %s", cfg.RunnerID)
	} else {
		log.Printf("[Agent] Using saved runner ID: %s", cfg.RunnerID)
	}

	client.SetToken(cfg.Token)

	// Graceful shutdown
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	executor := NewExecutor(cfg, client)

	log.Printf("[Agent] Runner ready. Polling every %ds for jobs...", cfg.PollInterval)

	backoff := 0
	const maxBackoff = 60

	for {
		select {
		case <-ctx.Done():
			log.Println("[Agent] Shutting down...")
			return
		case <-time.After(time.Duration(cfg.PollInterval+backoff) * time.Second):
		}

		job, err := client.Heartbeat(cfg.RunnerID)
		if err != nil {
			backoff = int(math.Min(float64(backoff*2+1), float64(maxBackoff)))
			log.Printf("[Agent] Heartbeat error (backoff %ds): %v", backoff, err)
			continue
		}

		backoff = 0 // reset on success

		if job == nil {
			// No job available
			continue
		}

		fmt.Printf("[Agent] Received job: %s (%s)\n", job.Name, job.ID)

		if err := executeWithHeartbeat(ctx, executor, client, cfg, job); err != nil {
			if err == errAssignmentCancelled {
				log.Printf("[Agent] Job %s cancelled", job.ID)
			} else {
				log.Printf("[Agent] Job %s failed: %v", job.ID, err)
			}
		}
	}
}
