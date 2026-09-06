// cmd/agent/client.go — HTTP client for Sigmagit API communication

package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// JobPayload is the job assignment returned by the heartbeat endpoint.
type JobPayload struct {
	ID                 string                 `json:"id"`
	RunID              string                 `json:"runId"`
	Name               string                 `json:"name"`
	WorkflowDefinition map[string]interface{} `json:"workflowDefinition"`
	CommitSha          string                 `json:"commitSha"`
	Branch             string                 `json:"branch"`
	EventName          string                 `json:"eventName"`
	EventPayload       map[string]interface{} `json:"eventPayload"`
	RepoOwner          string                 `json:"repoOwner"`
	RepoName           string                 `json:"repoName"`
}

// StepResult captures the outcome of a single step for the completion report.
type StepResult struct {
	Name      string `json:"name"`
	Number    int    `json:"number"`
	Status    string `json:"status"`
	ExitCode  int    `json:"exitCode"`
	LogOutput string `json:"logOutput,omitempty"`
}

// APIClient handles all communication with the Sigmagit API.
type APIClient struct {
	baseURL    string
	token      string
	httpClient *http.Client
}

func NewAPIClient(baseURL string) *APIClient {
	return &APIClient{
		baseURL: strings.TrimRight(baseURL, "/"),
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (c *APIClient) SetToken(token string) {
	c.token = token
}

func (c *APIClient) do(method, path string, body interface{}) ([]byte, int, error) {
	var reqBody io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, 0, err
		}
		reqBody = bytes.NewReader(data)
	}

	req, err := http.NewRequest(method, c.baseURL+path, reqBody)
	if err != nil {
		return nil, 0, err
	}

	req.Header.Set("Content-Type", "application/json")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 16*1024*1024))
	if err != nil {
		return nil, resp.StatusCode, err
	}

	return respBody, resp.StatusCode, nil
}

// Register a new runner and return its id and token.
func (c *APIClient) Register(name string, labels []string, os, arch, version string) (id, token string, err error) {
	payload := map[string]interface{}{
		"name":    name,
		"labels":  labels,
		"os":      os,
		"arch":    arch,
		"version": version,
	}

	body, status, err := c.do("POST", "/api/runners/register", payload)
	if err != nil {
		return "", "", err
	}
	if status != 200 {
		return "", "", fmt.Errorf("register: unexpected status %d: %s", status, body)
	}

	var result struct {
		ID    string `json:"id"`
		Token string `json:"token"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", "", err
	}

	return result.ID, result.Token, nil
}

// Heartbeat sends a heartbeat and returns the next job (or nil).
func (c *APIClient) Heartbeat(runnerID string) (*JobPayload, error) {
	body, status, err := c.do("POST", "/api/runners/"+runnerID+"/heartbeat", nil)
	if err != nil {
		return nil, err
	}
	if status == 401 {
		return nil, fmt.Errorf("unauthorized: runner token rejected")
	}
	if status != 200 {
		return nil, fmt.Errorf("heartbeat: unexpected status %d: %s", status, body)
	}

	var result struct {
		Job *JobPayload `json:"job"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, err
	}

	return result.Job, nil
}

// ReportProgress sends a step log chunk to the API.
func (c *APIClient) ReportProgress(runnerID, jobID, stepName string, stepNumber int, status, logChunk string, exitCode *int) error {
	payload := map[string]interface{}{
		"stepName":   stepName,
		"stepNumber": stepNumber,
		"status":     status,
		"logChunk":   logChunk,
	}
	if exitCode != nil {
		payload["exitCode"] = *exitCode
	}

	_, statusCode, err := c.do("POST", "/api/runners/"+runnerID+"/jobs/"+jobID+"/progress", payload)
	if err != nil {
		return err
	}
	if statusCode != 200 {
		return fmt.Errorf("progress: unexpected status %d", statusCode)
	}
	return nil
}

// ReportCompletion reports final job status to the API.
func (c *APIClient) ReportCompletion(runnerID, jobID, status, conclusion string, steps []StepResult) error {
	if steps == nil {
		steps = []StepResult{}
	}
	payload := map[string]interface{}{
		"status":     status,
		"conclusion": conclusion,
		"steps":      steps,
	}

	for attempt := 0; ; attempt++ {
		_, statusCode, err := c.do("POST", "/api/runners/"+runnerID+"/jobs/"+jobID+"/complete", payload)
		if err == nil && statusCode == http.StatusOK {
			return nil
		}
		// The API accepts identical terminal reports, so retry transport/server
		// failures without executing the workflow a second time.
		if attempt >= 2 || (err == nil && statusCode < 500) {
			if err != nil {
				return err
			}
			return fmt.Errorf("complete: unexpected status %d", statusCode)
		}
		time.Sleep(time.Duration(attempt+1) * time.Second)
	}
}
