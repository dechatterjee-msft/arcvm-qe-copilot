package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"arcvm-qe-copilot/internal/ai"
	"arcvm-qe-copilot/internal/jobs"
	"arcvm-qe-copilot/internal/spec"
)

type stubManager struct {
	job *jobs.Job
}

type stubPlanner struct {
	response        *ai.TestPlanResponse
	previewResponse *ai.RulesetPreviewResponse
	err             error
}

func (s *stubPlanner) GenerateTestPlan(_ ai.TestPlanRequest) (*ai.TestPlanResponse, error) {
	return s.response, s.err
}

func (s *stubPlanner) PreviewRuleset(_ ai.RulesetPreviewRequest) (*ai.RulesetPreviewResponse, error) {
	return s.previewResponse, s.err
}

func (s *stubManager) StartProvision(_ *spec.RunRequest) (*jobs.Job, error) {
	return s.job, nil
}

func (s *stubManager) StartLongevity(_ *spec.RunRequest) (*jobs.Job, error) {
	return s.job, nil
}

func (s *stubManager) ListJobs() []*jobs.Job {
	return []*jobs.Job{s.job}
}

func (s *stubManager) GetJob(id string) (*jobs.Job, bool) {
	if s.job != nil && s.job.ID == id {
		return s.job, true
	}
	return nil, false
}

func (s *stubManager) CancelJob(_ string) bool {
	return false
}

func TestHealthz(t *testing.T) {
	server := NewServer(&stubManager{}, nil, nil, nil, nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()

	server.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}

func TestProvisionEndpointAcceptsRequest(t *testing.T) {
	job := &jobs.Job{
		ID:          "job-1",
		Type:        "provision",
		Status:      "queued",
		SubmittedAt: time.Now().UTC(),
	}
	server := NewServer(&stubManager{job: job}, nil, nil, nil, nil, nil)

	payload := spec.RunRequest{
		SubscriptionID:   "sub",
		ResourceGroup:    "rg",
		Location:         "eastus2",
		CustomLocationID: "cl",
		Resources: spec.Resources{
			LogicalNetwork: &spec.LogicalNetworkSpec{
				Name:          "lnet",
				AddressPrefix: "10.0.0.0/24",
				IPPoolStart:   "10.0.0.10",
				IPPoolEnd:     "10.0.0.20",
				VMSwitchName:  "ConvergedSwitch",
			},
		},
	}

	raw, _ := json.Marshal(payload)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/provision-jobs", bytes.NewReader(raw))
	rec := httptest.NewRecorder()

	server.ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d", rec.Code)
	}
}

func TestTestPlanEndpoint(t *testing.T) {
	planner := &stubPlanner{response: &ai.TestPlanResponse{
		GeneratedAt: time.Now().UTC(),
		Model:       "gpt-5-chat",
		Cases: []ai.PlannedTestCase{
			{
				CaseID:          "case-1",
				Objective:       "happy path",
				Mutation:        "none",
				ExpectedOutcome: "success",
				Citations:       []string{"ms-static-lnet-001"},
				RunRequest:      *validRequest(),
			},
		},
	}}

	server := NewServer(&stubManager{}, planner, nil, nil, nil, nil)

	payload := ai.TestPlanRequest{Baseline: *validRequest(), CaseCount: 1}
	raw, _ := json.Marshal(payload)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/test-plan", bytes.NewReader(raw))
	rec := httptest.NewRecorder()

	server.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}

func TestRulesetPreviewEndpoint(t *testing.T) {
	planner := &stubPlanner{previewResponse: &ai.RulesetPreviewResponse{
		Ruleset: ai.RulesetMetadata{
			RulesetID:   "ruleset-abc123",
			VersionHash: "abc123",
			SourceType:  "ado",
			SourceRef:   "https://dev.azure.com/org/project/_git/repo",
			GeneratedAt: time.Now().UTC(),
			TotalRules:  2,
		},
		RetrievedRules: []ai.RuleEntry{{RuleID: "rule-1", Category: "admission", Section: "Validation", Content: "VLAN in range"}},
	}}

	server := NewServer(&stubManager{}, planner, nil, nil, nil, nil)

	payload := ai.RulesetPreviewRequest{
		DocSource: &ai.DocSource{Type: "local", LocalPath: "./docs/lnet.md"},
		Retrieval: ai.RetrievalOptions{Query: "static lnet", TopK: 5},
	}
	raw, _ := json.Marshal(payload)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/rulesets/preview", bytes.NewReader(raw))
	rec := httptest.NewRecorder()

	server.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}

func validRequest() *spec.RunRequest {
	return &spec.RunRequest{
		SubscriptionID:   "00000000-0000-0000-0000-000000000000",
		ResourceGroup:    "rg-test",
		Location:         "eastus2",
		CustomLocationID: "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-test/providers/Microsoft.ExtendedLocation/customLocations/test-cl",
		Resources: spec.Resources{
			LogicalNetwork: &spec.LogicalNetworkSpec{
				Name:               "test-static-lnet",
				AddressPrefix:      "192.168.201.0/24",
				IPAllocationMethod: "Static",
				IPPoolStart:        "192.168.201.20",
				IPPoolEnd:          "192.168.201.40",
				Gateway:            "192.168.201.1",
				DNSServers:         []string{"192.168.201.10"},
				VLAN:               201,
				VMSwitchName:       "ConvergedSwitch",
			},
		},
		Longevity: spec.LongevitySpec{
			Iterations: 1,
			Actions:    []string{"provision", "show"},
		},
	}
}
