package harness

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"os"
	"path/filepath"
	"strings"
	"time"

	"arcvm-qe-copilot/internal/azure"
	"arcvm-qe-copilot/internal/spec"
)

type Harness struct {
	cli           *azure.CLI
	logger        *log.Logger
	rng           *rand.Rand
	OnActionStart func(name string)
	OnActionDone  func(name string, success bool, errMsg string)
}

type ProvisionResult struct {
	CompletedAt time.Time        `json:"completedAt"`
	Resources   spec.ResourceIDs `json:"resources"`
	PrereqSteps []azure.RunEntry `json:"prereqSteps,omitempty"`
}

type ActionResult struct {
	Name       string           `json:"name"`
	StartedAt  time.Time        `json:"startedAt"`
	FinishedAt time.Time        `json:"finishedAt"`
	Success    bool             `json:"success"`
	Error      string           `json:"error,omitempty"`
	Steps      []azure.RunEntry `json:"steps,omitempty"`
}

type IterationResult struct {
	Index      int              `json:"index"`
	StartedAt  time.Time        `json:"startedAt"`
	FinishedAt time.Time        `json:"finishedAt"`
	Success    bool             `json:"success"`
	Error      string           `json:"error,omitempty"`
	Actions    []ActionResult   `json:"actions"`
	Resources  spec.ResourceIDs `json:"resources,omitempty"`
}

type LongevityReport struct {
	StartedAt            time.Time         `json:"startedAt"`
	FinishedAt           time.Time         `json:"finishedAt"`
	IterationsRequested  int               `json:"iterationsRequested,omitempty"`
	DurationLimit        string            `json:"durationLimit,omitempty"`
	Interval             string            `json:"interval"`
	Jitter               string            `json:"jitter,omitempty"`
	MaxFailures          int               `json:"maxFailures"`
	SuccessfulIterations int               `json:"successfulIterations"`
	FailedIterations     int               `json:"failedIterations"`
	Success              bool              `json:"success"`
	Actions              []string          `json:"actions"`
	ReportPath           string            `json:"reportPath"`
	Iterations           []IterationResult `json:"iterations"`
}

func New(cli *azure.CLI, logger *log.Logger) *Harness {
	return &Harness{
		cli:    cli,
		logger: logger,
		rng:    rand.New(rand.NewSource(time.Now().UnixNano())),
	}
}

func (h *Harness) Provision(ctx context.Context, req *spec.RunRequest) (*ProvisionResult, error) {
	h.cli.DrainLog() // clear any stale entries
	if h.OnActionStart != nil {
		h.OnActionStart("prereqs")
	}
	if err := h.cli.EnsurePrereqs(ctx, req); err != nil {
		if h.OnActionDone != nil {
			h.OnActionDone("prereqs", false, err.Error())
		}
		return &ProvisionResult{
			CompletedAt: time.Now().UTC(),
			PrereqSteps: h.cli.DrainLog(),
		}, err
	}
	if h.OnActionDone != nil {
		h.OnActionDone("prereqs", true, "")
	}

	if h.OnActionStart != nil {
		h.OnActionStart("provision")
	}
	resources, err := h.provisionResources(ctx, req)
	if err != nil {
		if h.OnActionDone != nil {
			h.OnActionDone("provision", false, err.Error())
		}
		return nil, err
	}
	if h.OnActionDone != nil {
		h.OnActionDone("provision", true, "")
	}

	return &ProvisionResult{
		CompletedAt: time.Now().UTC(),
		Resources:   resources,
	}, nil
}

func (h *Harness) RunLongevity(ctx context.Context, req *spec.RunRequest) (*LongevityReport, error) {
	h.cli.DrainLog() // clear any stale entries
	now := time.Now().UTC()
	if h.OnActionStart != nil {
		h.OnActionStart("prereqs")
	}
	if err := h.cli.EnsurePrereqs(ctx, req); err != nil {
		if h.OnActionDone != nil {
			h.OnActionDone("prereqs", false, err.Error())
		}
		prereqSteps := h.cli.DrainLog()
		fin := time.Now().UTC()
		return &LongevityReport{
			StartedAt:  now,
			FinishedAt: fin,
			Actions:    req.ActionsOrDefault(),
			ReportPath: req.Longevity.ReportPath,
			Iterations: []IterationResult{{
				Index:      0,
				StartedAt:  now,
				FinishedAt: fin,
				Success:    false,
				Error:      err.Error(),
				Actions: []ActionResult{{
					Name:       "prereqs",
					StartedAt:  now,
					FinishedAt: fin,
					Success:    false,
					Error:      err.Error(),
					Steps:      prereqSteps,
				}},
			}},
			FailedIterations: 1,
			Success:          false,
		}, err
	}
	if h.OnActionDone != nil {
		h.OnActionDone("prereqs", true, "")
	}

	report := &LongevityReport{
		StartedAt:           time.Now().UTC(),
		IterationsRequested: req.EffectiveLongevityIterations(),
		DurationLimit:       req.EffectiveLongevityDuration().String(),
		Interval:            req.EffectiveLongevityInterval().String(),
		Jitter:              req.EffectiveLongevityJitter().String(),
		MaxFailures:         req.EffectiveLongevityMaxFailures(),
		Actions:             req.ActionsOrDefault(),
		ReportPath:          req.Longevity.ReportPath,
	}

	if report.DurationLimit == "0s" {
		report.DurationLimit = ""
	}
	if report.Jitter == "0s" {
		report.Jitter = ""
	}

	durationLimit := req.EffectiveLongevityDuration()
	interval := req.EffectiveLongevityInterval()
	jitter := req.EffectiveLongevityJitter()
	maxFailures := req.EffectiveLongevityMaxFailures()

	for iteration := 1; h.shouldContinue(iteration, report.StartedAt, durationLimit, report.IterationsRequested); iteration++ {
		result := IterationResult{
			Index:     iteration,
			StartedAt: time.Now().UTC(),
		}

		resources, err := h.runIteration(ctx, req, report.Actions, &result)
		result.FinishedAt = time.Now().UTC()
		result.Resources = resources

		if err != nil {
			result.Success = false
			result.Error = err.Error()
			report.FailedIterations++
		} else {
			result.Success = true
			report.SuccessfulIterations++
		}

		report.Iterations = append(report.Iterations, result)

		if writeErr := writeReport(report.ReportPath, report); writeErr != nil && h.logger != nil {
			h.logger.Printf("Failed to write longevity report: %v", writeErr)
		}

		if report.FailedIterations >= maxFailures {
			break
		}

		if !h.shouldContinue(iteration+1, report.StartedAt, durationLimit, report.IterationsRequested) {
			break
		}

		if err := h.sleepWithJitter(ctx, interval, jitter); err != nil {
			report.FinishedAt = time.Now().UTC()
			report.Success = false
			_ = writeReport(report.ReportPath, report)
			return report, err
		}
	}

	report.FinishedAt = time.Now().UTC()
	report.Success = report.FailedIterations == 0
	_ = writeReport(report.ReportPath, report)

	if report.FailedIterations > 0 {
		return report, fmt.Errorf("%d longevity iteration(s) failed", report.FailedIterations)
	}

	return report, nil
}

func (h *Harness) provisionResources(ctx context.Context, req *spec.RunRequest) (spec.ResourceIDs, error) {
	ids := spec.ResourceIDs{
		LogicalNetworks:   map[string]string{},
		NetworkInterfaces: map[string]string{},
	}

	for _, logicalNetwork := range req.Resources.AllLogicalNetworks() {
		lnetID, err := h.cli.EnsureLogicalNetwork(ctx, req, logicalNetwork)
		if err != nil {
			return spec.ResourceIDs{}, fmt.Errorf("ensure logical network %q: %w", logicalNetwork.Name, err)
		}
		ids.LogicalNetworks[logicalNetwork.Name] = lnetID
	}

	for _, networkInterface := range req.Resources.AllNetworkInterfaces() {
		networkRef, err := resolveNetworkRef(req, networkInterface, ids.LogicalNetworks)
		if err != nil {
			return spec.ResourceIDs{}, err
		}
		nicID, err := h.cli.EnsureNetworkInterface(ctx, req, networkInterface, networkRef)
		if err != nil {
			return spec.ResourceIDs{}, fmt.Errorf("ensure network interface %q: %w", networkInterface.Name, err)
		}
		ids.NetworkInterfaces[networkInterface.Name] = nicID
	}

	return ids, nil
}

func (h *Harness) runIteration(ctx context.Context, req *spec.RunRequest, actions []string, result *IterationResult) (spec.ResourceIDs, error) {
	var resources spec.ResourceIDs

	for _, action := range actions {
		action = strings.ToLower(strings.TrimSpace(action))

		// Drain any stale log entries before this action.
		h.cli.DrainLog()

		if h.OnActionStart != nil {
			h.OnActionStart(action)
		}

		step := ActionResult{
			Name:      action,
			StartedAt: time.Now().UTC(),
		}

		var err error
		switch action {
		case "provision":
			resources, err = h.provisionResources(ctx, req)
		case "show":
			var found spec.ResourceIDs
			found, err = h.cli.ShowResources(ctx, req)
			if err == nil {
				resources = mergeResourceIDs(resources, found)
			}
		case "cleanup":
			err = h.cli.CleanupResources(ctx, req)
		default:
			err = fmt.Errorf("unsupported action %q", action)
		}

		step.FinishedAt = time.Now().UTC()
		step.Steps = h.cli.DrainLog()
		if err != nil {
			step.Success = false
			step.Error = err.Error()
			result.Actions = append(result.Actions, step)
			if h.OnActionDone != nil {
				h.OnActionDone(action, false, err.Error())
			}
			return resources, fmt.Errorf("%s failed: %w", action, err)
		}

		step.Success = true
		result.Actions = append(result.Actions, step)
		if h.OnActionDone != nil {
			h.OnActionDone(action, true, "")
		}
	}

	return resources, nil
}

func (h *Harness) shouldContinue(nextIteration int, startedAt time.Time, durationLimit time.Duration, iterationLimit int) bool {
	if iterationLimit > 0 && nextIteration > iterationLimit {
		return false
	}
	if durationLimit > 0 && time.Since(startedAt) >= durationLimit {
		return false
	}
	return true
}

func (h *Harness) sleepWithJitter(ctx context.Context, interval, jitter time.Duration) error {
	if interval <= 0 {
		return nil
	}

	wait := interval
	if jitter > 0 {
		wait += time.Duration(h.rng.Int63n(int64(jitter)))
	}

	timer := time.NewTimer(wait)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func writeReport(path string, report *LongevityReport) error {
	if path == "" {
		return nil
	}

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create report directory: %w", err)
	}

	data, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal report: %w", err)
	}

	if err := os.WriteFile(path, data, 0o644); err != nil {
		return fmt.Errorf("write report: %w", err)
	}

	return nil
}

func mergeResourceIDs(existing, found spec.ResourceIDs) spec.ResourceIDs {
	if existing.LogicalNetworks == nil {
		existing.LogicalNetworks = map[string]string{}
	}
	if existing.NetworkInterfaces == nil {
		existing.NetworkInterfaces = map[string]string{}
	}
	for name, id := range found.LogicalNetworks {
		existing.LogicalNetworks[name] = id
	}
	for name, id := range found.NetworkInterfaces {
		existing.NetworkInterfaces[name] = id
	}
	return existing
}

func resolveNetworkRef(req *spec.RunRequest, networkInterface spec.NetworkInterfaceSpec, logicalNetworkIDs map[string]string) (string, error) {
	if networkInterface.NetworkRef != "" {
		if lnetID, ok := logicalNetworkIDs[networkInterface.NetworkRef]; ok {
			return lnetID, nil
		}
		return networkInterface.NetworkRef, nil
	}

	logicalNetworks := req.Resources.AllLogicalNetworks()
	if len(logicalNetworks) == 1 {
		return logicalNetworkIDs[logicalNetworks[0].Name], nil
	}

	return "", fmt.Errorf("network interface %q is missing networkRef in a multi-logical-network request", networkInterface.Name)
}
