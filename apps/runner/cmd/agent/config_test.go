package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRegistrationConfigAndCredentialPersistence(t *testing.T) {
	t.Setenv("SIGMAGIT_CONFIG_PATH", filepath.Join(t.TempDir(), "config.json"))
	t.Setenv("SIGMAGIT_RUNNER_REGISTRATION_SECRET", "registration-only-test-secret")
	t.Setenv("SIGMAGIT_RUNNER_IMAGE", "test-image:latest")
	t.Setenv("SIGMAGIT_RUNNER_TOKEN", "issued-test-token")
	t.Setenv("SIGMAGIT_RUNNER_ID", "issued-test-id")
	cfg := loadConfig()
	if cfg.RegistrationSecret != "registration-only-test-secret" || cfg.JobImage != "test-image:latest" {
		t.Fatal("registration secret or job image ignored")
	}
	if err := saveConfig(cfg); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(cfg.ConfigPath)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), cfg.RegistrationSecret) {
		t.Fatal("registration secret persisted")
	}
	t.Setenv("SIGMAGIT_RUNNER_ID", "")
	t.Setenv("SIGMAGIT_RUNNER_TOKEN", "")
	loaded := loadConfig()
	if loaded.RunnerID != cfg.RunnerID || loaded.Token != cfg.Token {
		t.Fatal("issued credentials were not restored")
	}
}
