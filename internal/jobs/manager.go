package jobs

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"arcvm-qe-copilot/internal/azure"
	"arcvm-qe-copilot/internal/harness"
	"arcvm-qe-copilot/internal/logging"
	"arcvm-qe-copilot/internal/spec"
)

type Manager struct {
	mu             sync.RWMutex
	jobs           map[string]*Job
	azureConfigDir string
	reportBaseDir  string
	logger         *log.Logger
}

type Job struct {
	ID          string     `json:"id"`
	Type        string     `json:"type"`
	Status      string     `json:"status"`
	SubmittedAt time.Time  `json:"submittedAt"`
	StartedAt   *time.Time `json:"startedAt,omitempty"`
	FinishedAt  *time.Time `json:"finishedAt,omitempty"`
	Error       string     `json:"error,omitempty"`
	Summary     Summary    `json:"summary"`
	Result      any        `json:"result,omitempty"`
}

type Summary struct {
	SubscriptionID   string   `json:"subscriptionId"`
	ResourceGroup    string   `json:"resourceGroup"`
	CustomLocationID string   `json:"customLocationId"`
	Location         string   `json:"location"`
	ResourceKinds    []string `json:"resourceKinds"`
	LongevityActions []string `json:"longevityActions,omitempty"`
}

func NewManager(azureConfigDir, reportBaseDir string, logger *log.Logger) *Manager {
	return &Manager{
		jobs:           make(map[string]*Job),
		azureConfigDir: azureConfigDir,
		reportBaseDir:  reportBaseDir,
		logger:         logger,
	}
}

func (m *Manager) StartProvision(request *spec.RunRequest) (*Job, error) {
	if err := request.Validate("provision"); err != nil {
		return nil, err
	}

	job := m.newJob("provision", request)
	m.runAsync(job.ID, request, false)
	return job, nil
}

func (m *Manager) StartLongevity(request *spec.RunRequest) (*Job, error) {
	if err := request.Validate("longevity"); err != nil {
		return nil, err
	}

	job := m.newJob("longevity", request)
	m.runAsync(job.ID, request, true)
	return job, nil
}

func (m *Manager) ListJobs() []*Job {
	m.mu.RLock()
	defer m.mu.RUnlock()

	ids := make([]string, 0, len(m.jobs))
	for id := range m.jobs {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	out := make([]*Job, 0, len(ids))
	for _, id := range ids {
		out = append(out, cloneJob(m.jobs[id]))
	}
	return out
}

func (m *Manager) GetJob(id string) (*Job, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	job, ok := m.jobs[id]
	if !ok {
		return nil, false
	}
	return cloneJob(job), true
}

func (m *Manager) newJob(jobType string, request *spec.RunRequest) *Job {
	job := &Job{
		ID:          randomID(),
		Type:        jobType,
		Status:      "queued",
		SubmittedAt: time.Now().UTC(),
		Summary: Summary{
			SubscriptionID:   request.SubscriptionID,
			ResourceGroup:    request.ResourceGroup,
			CustomLocationID: request.CustomLocationID,
			Location:         request.Location,
			ResourceKinds:    resourceKinds(request),
			LongevityActions: request.ActionsOrDefault(),
		},
	}

	m.mu.Lock()
	m.jobs[job.ID] = job
	m.mu.Unlock()
	return cloneJob(job)
}

func (m *Manager) runAsync(id string, request *spec.RunRequest, longevity bool) {
	req := *request
	if longevity {
		req.Longevity.ReportPath = req.ResolveReportPath(m.reportBaseDir, id)
	}

	go func() {
		startedAt := time.Now().UTC()
		m.markStarted(id, startedAt)

		azureConfigDir := req.ResolveAzureConfigDir(m.azureConfigDir)
		cli := azure.NewCLI(azureConfigDir, logging.Tagged(m.logger, "Azure CLI"))
		engine := harness.New(cli, logging.Tagged(m.logger, "Harness"))

		ctx := context.Background()
		var (
			result any
			err    error
		)
		if longevity {
			result, err = engine.RunLongevity(ctx, &req)
		} else {
			result, err = engine.Provision(ctx, &req)
		}

		finishedAt := time.Now().UTC()
		m.markFinished(id, finishedAt, result, err)
	}()
}

func (m *Manager) markStarted(id string, startedAt time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if job, ok := m.jobs[id]; ok {
		job.Status = "running"
		job.StartedAt = &startedAt
	}
}

func (m *Manager) markFinished(id string, finishedAt time.Time, result any, err error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if job, ok := m.jobs[id]; ok {
		job.FinishedAt = &finishedAt
		job.Result = result
		if err != nil {
			job.Status = "failed"
			job.Error = err.Error()
			return
		}
		job.Status = "succeeded"
	}
}

func cloneJob(job *Job) *Job {
	if job == nil {
		return nil
	}
	copy := *job
	return &copy
}

func resourceKinds(request *spec.RunRequest) []string {
	var kinds []string
	if len(request.Resources.AllLogicalNetworks()) > 0 {
		kinds = append(kinds, "logicalNetwork")
	}
	if len(request.Resources.AllNetworkInterfaces()) > 0 {
		kinds = append(kinds, "networkInterface")
	}
	return kinds
}

func randomID() string {
	var buf [8]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return strings.ReplaceAll(filepath.Base(time.Now().UTC().Format(time.RFC3339Nano)), ":", "")
	}
	return hex.EncodeToString(buf[:])
}
