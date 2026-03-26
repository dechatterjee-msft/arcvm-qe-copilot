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
	cancels        map[string]context.CancelFunc
	progress       map[string]*LiveProgress
	azureConfigDir string
	reportBaseDir  string
	logger         *log.Logger
}

type Job struct {
	ID          string       `json:"id"`
	Type        string       `json:"type"`
	CaseID      string       `json:"caseId,omitempty"`
	Description string       `json:"description,omitempty"`
	Status      string       `json:"status"`
	SubmittedAt time.Time    `json:"submittedAt"`
	StartedAt   *time.Time   `json:"startedAt,omitempty"`
	FinishedAt  *time.Time   `json:"finishedAt,omitempty"`
	Error       string       `json:"error,omitempty"`
	Summary     Summary      `json:"summary"`
	Result      any          `json:"result,omitempty"`
	Progress    *JobProgress `json:"progress,omitempty"`
}

type Summary struct {
	SubscriptionID   string   `json:"subscriptionId"`
	ResourceGroup    string   `json:"resourceGroup"`
	CustomLocationID string   `json:"customLocationId"`
	Location         string   `json:"location"`
	ResourceKinds    []string `json:"resourceKinds"`
	LongevityActions []string `json:"longevityActions,omitempty"`
}

// --- Live Progress ---

type JobProgress struct {
	Actions []ProgressAction `json:"actions"`
}

type ProgressAction struct {
	Name    string           `json:"name"`
	Started time.Time        `json:"started"`
	Steps   []azure.RunEntry `json:"steps"`
	Done    bool             `json:"done"`
	Success bool             `json:"success"`
	Error   string           `json:"error,omitempty"`
}

type LiveProgress struct {
	mu      sync.Mutex
	actions []liveAction
}

type liveAction struct {
	name    string
	started time.Time
	steps   []azure.RunEntry
	done    bool
	success bool
	errMsg  string
}

func (lp *LiveProgress) StartAction(name string) {
	lp.mu.Lock()
	defer lp.mu.Unlock()
	lp.actions = append(lp.actions, liveAction{
		name:    name,
		started: time.Now().UTC(),
	})
}

func (lp *LiveProgress) AddStep(entry azure.RunEntry) {
	lp.mu.Lock()
	defer lp.mu.Unlock()
	if len(lp.actions) == 0 {
		return
	}
	last := &lp.actions[len(lp.actions)-1]
	last.steps = append(last.steps, entry)
}

func (lp *LiveProgress) FinishAction(name string, success bool, errMsg string) {
	lp.mu.Lock()
	defer lp.mu.Unlock()
	for i := len(lp.actions) - 1; i >= 0; i-- {
		if lp.actions[i].name == name && !lp.actions[i].done {
			lp.actions[i].done = true
			lp.actions[i].success = success
			lp.actions[i].errMsg = errMsg
			return
		}
	}
}

func (lp *LiveProgress) Snapshot() *JobProgress {
	lp.mu.Lock()
	defer lp.mu.Unlock()
	if len(lp.actions) == 0 {
		return nil
	}
	out := &JobProgress{Actions: make([]ProgressAction, len(lp.actions))}
	for i, a := range lp.actions {
		steps := make([]azure.RunEntry, len(a.steps))
		copy(steps, a.steps)
		out.Actions[i] = ProgressAction{
			Name:    a.name,
			Started: a.started,
			Steps:   steps,
			Done:    a.done,
			Success: a.success,
			Error:   a.errMsg,
		}
	}
	return out
}

func NewManager(azureConfigDir, reportBaseDir string, logger *log.Logger) *Manager {
	return &Manager{
		jobs:           make(map[string]*Job),
		cancels:        make(map[string]context.CancelFunc),
		progress:       make(map[string]*LiveProgress),
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
	job, ok := m.jobs[id]
	lp := m.progress[id]
	m.mu.RUnlock()

	if !ok {
		return nil, false
	}
	clone := cloneJob(job)
	if lp != nil && (clone.Status == "running" || clone.Status == "queued") {
		clone.Progress = lp.Snapshot()
	}
	return clone, true
}

func (m *Manager) newJob(jobType string, request *spec.RunRequest) *Job {
	job := &Job{
		ID:          randomID(),
		Type:        jobType,
		CaseID:      request.CaseID,
		Description: request.Description,
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

	ctx, cancel := context.WithCancel(context.Background())
	m.mu.Lock()
	m.cancels[id] = cancel
	m.mu.Unlock()

	go func() {
		defer func() {
			m.mu.Lock()
			delete(m.cancels, id)
			delete(m.progress, id)
			m.mu.Unlock()
		}()

		startedAt := time.Now().UTC()
		m.markStarted(id, startedAt)

		lp := &LiveProgress{}
		m.mu.Lock()
		m.progress[id] = lp
		m.mu.Unlock()

		azureConfigDir := req.ResolveAzureConfigDir(m.azureConfigDir)
		cli := azure.NewCLI(azureConfigDir, logging.Tagged(m.logger, "Azure CLI"))
		cli.OnStep = func(e azure.RunEntry) { lp.AddStep(e) }

		engine := harness.New(cli, logging.Tagged(m.logger, "Harness"))
		engine.OnActionStart = func(name string) { lp.StartAction(name) }
		engine.OnActionDone = func(name string, ok bool, errMsg string) { lp.FinishAction(name, ok, errMsg) }

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
		if ctx.Err() != nil && err != nil {
			m.markCancelled(id, finishedAt, result)
		} else {
			m.markFinished(id, finishedAt, result, err)
		}
	}()
}

// CancelJob cancels a running job. Returns true if the job was found and cancelled.
func (m *Manager) CancelJob(id string) bool {
	m.mu.RLock()
	cancel, ok := m.cancels[id]
	m.mu.RUnlock()
	if !ok {
		return false
	}
	cancel()
	return true
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

func (m *Manager) markCancelled(id string, finishedAt time.Time, result any) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if job, ok := m.jobs[id]; ok {
		job.FinishedAt = &finishedAt
		job.Result = result
		job.Status = "cancelled"
		job.Error = "job was cancelled by user"
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
