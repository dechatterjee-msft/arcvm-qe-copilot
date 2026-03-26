package logs

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// Store persists and retrieves operator logs per job.
// Logs are stored as JSON files under <baseDir>/<jobId>/<operator>.json.
type Store struct {
	baseDir string
	mu      sync.RWMutex
}

// NewStore creates a log store rooted at the given directory.
func NewStore(baseDir string) *Store {
	return &Store{baseDir: baseDir}
}

// JobLogSummary describes which operators have collected logs for a job.
type JobLogSummary struct {
	JobID     string            `json:"jobId"`
	Operators []OperatorSummary `json:"operators"`
}

// OperatorSummary is the per-operator metadata in a job summary.
type OperatorSummary struct {
	Operator   string `json:"operator"`
	EntryCount int    `json:"entryCount"`
	ErrorCount int    `json:"errorCount"`
	WarnCount  int    `json:"warnCount"`
	HasError   bool   `json:"hasError"`
}

// Save persists parsed log entries for one operator under a job ID.
func (s *Store) Save(jobID, operator string, entries []LogEntry) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	dir := filepath.Join(s.baseDir, jobID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create log dir: %w", err)
	}

	data, err := json.MarshalIndent(entries, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal logs: %w", err)
	}

	path := filepath.Join(dir, operator+".json")
	return os.WriteFile(path, data, 0o644)
}

// SaveRaw persists the raw log string for one operator (for debugging/archive).
func (s *Store) SaveRaw(jobID, operator, raw string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	dir := filepath.Join(s.baseDir, jobID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create log dir: %w", err)
	}

	path := filepath.Join(dir, operator+".raw.log")
	return os.WriteFile(path, []byte(raw), 0o644)
}

// Load reads parsed log entries for one operator.
func (s *Store) Load(jobID, operator string) ([]LogEntry, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	path := filepath.Join(s.baseDir, jobID, operator+".json")
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	var entries []LogEntry
	if err := json.Unmarshal(data, &entries); err != nil {
		return nil, err
	}
	return entries, nil
}

// ListOperators returns the operators that have stored logs for a given job.
func (s *Store) ListOperators(jobID string) ([]string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	dir := filepath.Join(s.baseDir, jobID)
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	var operators []string
	for _, e := range entries {
		name := e.Name()
		if strings.HasSuffix(name, ".json") && !strings.HasSuffix(name, ".raw.log") {
			operators = append(operators, strings.TrimSuffix(name, ".json"))
		}
	}
	sort.Strings(operators)
	return operators, nil
}

// Summary returns a job-level log overview.
func (s *Store) Summary(jobID string) (*JobLogSummary, error) {
	operators, err := s.ListOperators(jobID)
	if err != nil {
		return nil, err
	}

	summary := &JobLogSummary{JobID: jobID}
	for _, op := range operators {
		entries, err := s.Load(jobID, op)
		if err != nil {
			continue
		}
		os := OperatorSummary{Operator: op, EntryCount: len(entries)}
		for _, e := range entries {
			switch e.Level {
			case "error", "fatal":
				os.ErrorCount++
			case "warn":
				os.WarnCount++
			}
		}
		os.HasError = os.ErrorCount > 0
		summary.Operators = append(summary.Operators, os)
	}
	return summary, nil
}
