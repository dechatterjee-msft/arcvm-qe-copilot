package logs

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"os/exec"
	"strings"
	"time"
)

// Collector fetches operator pod logs from a Kubernetes cluster via kubectl.
type Collector struct {
	kubeconfig string // path to kubeconfig (empty = default)
	logger     *log.Logger
}

// NewCollector creates a log collector.
// kubeconfig may be empty to use the default kubectl config.
func NewCollector(kubeconfig string, logger *log.Logger) *Collector {
	return &Collector{kubeconfig: kubeconfig, logger: logger}
}

// CollectRequest describes what to collect.
type CollectRequest struct {
	// Operators to collect logs from (by name key, e.g. "network-operator").
	Operators []string
	// SinceTime filters logs to entries on or after this time (optional).
	SinceTime *time.Time
	// UntilTime is used for client-side filtering after fetch (kubectl has
	// --since-time but no --until-time). Optional.
	UntilTime *time.Time
}

// CollectResult holds the raw log output per operator.
type CollectResult struct {
	Operator string `json:"operator"`
	RawLog   string `json:"rawLog"`
	Error    string `json:"error,omitempty"`
}

// Collect fetches logs for the requested operators.
func (c *Collector) Collect(ctx context.Context, req CollectRequest) []CollectResult {
	var results []CollectResult
	for _, opName := range req.Operators {
		op, ok := GetOperator(opName)
		if !ok {
			results = append(results, CollectResult{Operator: opName, Error: "unknown operator"})
			continue
		}
		raw, err := c.fetchPodLogs(ctx, op, req.SinceTime)
		if err != nil {
			c.logger.Printf("[LogCollector] error fetching %s logs: %v", opName, err)
			results = append(results, CollectResult{Operator: opName, Error: err.Error()})
			continue
		}

		// Client-side until-time filtering
		if req.UntilTime != nil {
			raw = filterUntil(raw, *req.UntilTime)
		}

		results = append(results, CollectResult{Operator: opName, RawLog: raw})
		c.logger.Printf("[LogCollector] collected %d bytes from %s", len(raw), opName)
	}
	return results
}

// fetchPodLogs runs kubectl logs with the operator's label selector.
func (c *Collector) fetchPodLogs(ctx context.Context, op Operator, sinceTime *time.Time) (string, error) {
	args := []string{
		"logs",
		"-n", op.Namespace,
		"-l", op.LabelSelector,
		"--all-containers=true",
		"--prefix=true",     // include pod/container prefix
		"--timestamps=true", // ISO timestamps in output
		"--tail=10000",      // cap to last 10 000 lines
	}

	if op.ContainerName != "" {
		args = append(args, "-c", op.ContainerName)
	}

	if sinceTime != nil {
		args = append(args, "--since-time="+sinceTime.UTC().Format(time.RFC3339))
	}

	if c.kubeconfig != "" {
		args = append(args, "--kubeconfig="+c.kubeconfig)
	}

	cmd := exec.CommandContext(ctx, "kubectl", args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("kubectl logs failed for %s: %w: %s", op.Name, err, strings.TrimSpace(stderr.String()))
	}

	return stdout.String(), nil
}

// filterUntil removes log lines whose timestamp is after the given cutoff.
// Expects lines prefixed with an RFC3339 or RFC3339Nano timestamp (kubectl --timestamps).
func filterUntil(raw string, until time.Time) string {
	lines := strings.Split(raw, "\n")
	var kept []string
	for _, line := range lines {
		ts := extractTimestamp(line)
		if ts.IsZero() || !ts.After(until) {
			kept = append(kept, line)
		}
	}
	return strings.Join(kept, "\n")
}

// extractTimestamp tries to parse an ISO timestamp from the beginning of a log line.
// kubectl --timestamps produces lines like:
//
//	[pod/container] 2026-03-25T20:45:07.123456Z {"level":"info",...}
func extractTimestamp(line string) time.Time {
	// Skip optional pod prefix in brackets
	s := line
	if idx := strings.Index(s, "]"); idx >= 0 && idx < 80 {
		s = strings.TrimSpace(s[idx+1:])
	}

	// Try first whitespace-delimited token as timestamp
	end := strings.IndexByte(s, ' ')
	if end < 0 {
		end = len(s)
	}
	token := s[:end]

	for _, layout := range []string{time.RFC3339Nano, time.RFC3339} {
		if t, err := time.Parse(layout, token); err == nil {
			return t
		}
	}
	return time.Time{}
}
