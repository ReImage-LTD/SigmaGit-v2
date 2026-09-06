package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"unicode/utf8"

	go_log "github.com/sirupsen/logrus"
)

func TestLogStreamPreservesInterleavedStepsAndBoundsChunks(t *testing.T) {
	var chunks []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			LogChunk string `json:"logChunk"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if len(body.LogChunk) > maxChunkBytes || !utf8.ValidString(body.LogChunk) {
			t.Error("invalid chunk")
		}
		chunks = append(chunks, body.LogChunk)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	client := NewAPIClient(server.URL)
	client.SetToken("test-private-token")
	hook := &logStreamHook{client: client}
	fire := func(job, result, message string) {
		t.Helper()
		if err := hook.Fire(&go_log.Entry{Data: go_log.Fields{"jobID": job, "step": "build", "stepResult": result}, Message: message}); err != nil {
			t.Fatal(err)
		}
	}
	fire("one", "", strings.Repeat("\u754c", 30_000))
	fire("two", "failure", "failed")
	fire("one", "success", "test-private-token")
	if err := hook.Flush(); err != nil {
		t.Fatal(err)
	}
	if len(chunks) < 3 {
		t.Fatal("large step was not split")
	}
	joined := strings.Join(chunks, "")
	if strings.Contains(joined, client.token) || !strings.Contains(joined, "[REDACTED]") {
		t.Fatal("credential leaked")
	}
	results := hook.Results(errors.New("second job failed"))
	if len(results) != 2 || results[0].Status != "completed" || results[1].Status != "failed" || results[0].Number == results[1].Number {
		t.Fatalf("wrong results: %+v", results)
	}
	if err := hook.Flush(); err != nil {
		t.Fatal(err)
	}
	if len(chunks) != 3 {
		t.Fatal("flush duplicated logs")
	}
}

func TestLogStreamConcurrentWritersAndRetry(t *testing.T) {
	attempts := 0
	var received string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		if attempts == 1 {
			w.WriteHeader(503)
			return
		}
		var body struct {
			LogChunk string `json:"logChunk"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		received += body.LogChunk
	}))
	defer server.Close()
	hook := &logStreamHook{client: NewAPIClient(server.URL)}
	var writers sync.WaitGroup
	for i := 0; i < 32; i++ {
		writers.Add(1)
		go func() {
			defer writers.Done()
			_ = hook.Fire(&go_log.Entry{Data: go_log.Fields{"step": "parallel"}, Message: "line"})
		}()
	}
	writers.Wait()
	if err := hook.Flush(); err == nil {
		t.Fatal("expected transient failure")
	}
	if err := hook.Flush(); err != nil {
		t.Fatal(err)
	}
	if received != strings.Repeat("line\n", 32) {
		t.Fatal("concurrent log data was lost")
	}
	_ = hook.Fire(&go_log.Entry{Data: go_log.Fields{"step": "parallel"}, Message: strings.Repeat("x", 2*maxStepBytes)})
	if hook.steps[0].bytes != maxStepBytes {
		t.Fatal("step buffer is not bounded")
	}
}

func TestCompletionUsesAnEmptyArrayForNoSteps(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if string(body["steps"]) != "[]" {
			t.Errorf("steps=%s", body["steps"])
		}
	}))
	defer server.Close()
	if err := NewAPIClient(server.URL).ReportCompletion("runner", "job", "completed", "success", nil); err != nil {
		t.Fatal(err)
	}
}

func TestCompletionRetriesServerFailuresButNotConflicts(t *testing.T) {
	attempts := 0
	conflict := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		if conflict {
			w.WriteHeader(http.StatusConflict)
			return
		}
		if attempts == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
		}
	}))
	defer server.Close()
	client := NewAPIClient(server.URL)
	if err := client.ReportCompletion("runner", "job", "completed", "success", nil); err != nil {
		t.Fatal(err)
	}
	if attempts != 2 {
		t.Fatalf("got %d attempts", attempts)
	}
	conflict = true
	if err := client.ReportCompletion("runner", "job", "completed", "success", nil); err == nil {
		t.Fatal("conflict accepted")
	}
	if attempts != 3 {
		t.Fatal("conflict should not be retried")
	}
}
