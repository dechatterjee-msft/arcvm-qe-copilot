package logs

import (
	"context"
	"fmt"
	"log"
	"time"
)

// Service orchestrates log collection, parsing, and storage.
type Service struct {
	collector *Collector
	store     *Store
	logger    *log.Logger
}

// NewService creates a log analysis service.
func NewService(kubeconfig, logDir string, logger *log.Logger) *Service {
	return &Service{
		collector: NewCollector(kubeconfig, logger),
		store:     NewStore(logDir),
		logger:    logger,
	}
}

// CollectForJob fetches, parses, and stores operator logs for a job.
// resourceTypes should be the resource kinds from the job summary (e.g. ["nic","lnet"]).
// sinceTime/untilTime bracket the collection window (typically job start/finish ± buffer).
func (s *Service) CollectForJob(ctx context.Context, jobID string, resourceTypes []string, sinceTime, untilTime *time.Time) (*JobLogSummary, error) {
	operators := OperatorsForResources(resourceTypes)
	if len(operators) == 0 {
		return nil, fmt.Errorf("no operators mapped for resource types: %v", resourceTypes)
	}

	// Add 30 second buffer on each side to catch initialization/teardown logs
	var since, until *time.Time
	if sinceTime != nil {
		t := sinceTime.Add(-30 * time.Second)
		since = &t
	}
	if untilTime != nil {
		t := untilTime.Add(30 * time.Second)
		until = &t
	}

	results := s.collector.Collect(ctx, CollectRequest{
		Operators: operators,
		SinceTime: since,
		UntilTime: until,
	})

	for _, r := range results {
		if r.Error != "" {
			s.logger.Printf("[LogService] operator %s: collection error: %s", r.Operator, r.Error)
			continue
		}
		if r.RawLog == "" {
			continue
		}

		// Save raw log for debugging
		_ = s.store.SaveRaw(jobID, r.Operator, r.RawLog)

		// Parse and save structured entries
		entries := ParseLogs(r.Operator, r.RawLog)
		if err := s.store.Save(jobID, r.Operator, entries); err != nil {
			s.logger.Printf("[LogService] failed to save %s logs for job %s: %v", r.Operator, jobID, err)
		} else {
			s.logger.Printf("[LogService] saved %d entries for %s (job %s)", len(entries), r.Operator, jobID)
		}
	}

	return s.store.Summary(jobID)
}

// GetJobLogSummary returns the log overview for a job.
func (s *Service) GetJobLogSummary(jobID string) (*JobLogSummary, error) {
	return s.store.Summary(jobID)
}

// GetOperatorLogs returns parsed log entries for one operator in a job.
func (s *Service) GetOperatorLogs(jobID, operator string) ([]LogEntry, error) {
	return s.store.Load(jobID, operator)
}

// GetOperatorLogsFiltered returns log entries matching the given filters.
func (s *Service) GetOperatorLogsFiltered(jobID, operator string, level string, resource string, limit int) ([]LogEntry, error) {
	all, err := s.store.Load(jobID, operator)
	if err != nil {
		return nil, err
	}

	var filtered []LogEntry
	for _, e := range all {
		if level != "" && e.Level != level {
			continue
		}
		if resource != "" && e.Resource != resource && !contains(e.Resource, resource) && !contains(e.Message, resource) {
			continue
		}
		filtered = append(filtered, e)
		if limit > 0 && len(filtered) >= limit {
			break
		}
	}
	return filtered, nil
}

func contains(haystack, needle string) bool {
	return len(needle) > 0 && len(haystack) > 0 &&
		len(needle) <= len(haystack) &&
		stringContains(haystack, needle)
}

func stringContains(s, sub string) bool {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
