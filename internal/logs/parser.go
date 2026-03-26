package logs

import (
	"encoding/json"
	"strings"
	"time"
)

// LogEntry is a single parsed log line from a Kubernetes operator.
type LogEntry struct {
	Timestamp   time.Time `json:"timestamp"`
	Level       string    `json:"level"`   // info, error, warn, debug
	Message     string    `json:"message"` // log message body
	Controller  string    `json:"controller,omitempty"`
	ReconcileID string    `json:"reconcileId,omitempty"`
	Resource    string    `json:"resource,omitempty"` // namespace/name
	Operator    string    `json:"operator"`
	Pod         string    `json:"pod,omitempty"`
	Raw         string    `json:"raw,omitempty"` // original line (only kept on parse failure)
}

// ParseLogs takes raw kubectl output for one operator and returns structured entries.
// It handles two formats:
//  1. Structured JSON (controller-runtime / klog JSON) — the common case for Azure Local operators.
//  2. Plain text with timestamps from kubectl --timestamps --prefix.
func ParseLogs(operator, raw string) []LogEntry {
	lines := strings.Split(raw, "\n")
	entries := make([]LogEntry, 0, len(lines))

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		entry := parseLine(operator, line)
		entries = append(entries, entry)
	}
	return entries
}

// parseLine handles a single raw log line.
func parseLine(operator, line string) LogEntry {
	entry := LogEntry{Operator: operator}

	// Extract optional kubectl prefix: "[pod-name/container-name]"
	rest := line
	if strings.HasPrefix(rest, "[") {
		if idx := strings.Index(rest, "]"); idx > 0 {
			entry.Pod = rest[1:idx]
			rest = strings.TrimSpace(rest[idx+1:])
		}
	}

	// Extract kubectl --timestamps timestamp prefix
	if ts, after, ok := splitTimestamp(rest); ok {
		entry.Timestamp = ts
		rest = after
	}

	// Attempt JSON parse (structured log)
	if idx := strings.IndexByte(rest, '{'); idx >= 0 {
		jsonPart := rest[idx:]
		if tryParseJSON(&entry, jsonPart) {
			if entry.Message == "" && idx > 0 {
				entry.Message = strings.TrimSpace(rest[:idx])
			}
			return entry
		}
	}

	// Fall back to klog-style: I0325 20:45:07.123456  12345 controller.go:42] message
	if tryParseKlog(&entry, rest) {
		return entry
	}

	// Plain text fallback
	entry.Message = rest
	entry.Level = guessLevel(rest)
	entry.Raw = line
	return entry
}

// splitTimestamp extracts an ISO 8601 timestamp from the start of s.
func splitTimestamp(s string) (time.Time, string, bool) {
	end := strings.IndexByte(s, ' ')
	if end < 0 || end > 40 {
		return time.Time{}, s, false
	}
	token := s[:end]
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339} {
		if t, err := time.Parse(layout, token); err == nil {
			return t, strings.TrimSpace(s[end+1:]), true
		}
	}
	return time.Time{}, s, false
}

// tryParseJSON attempts to parse a structured JSON log line.
func tryParseJSON(entry *LogEntry, s string) bool {
	var obj map[string]any
	if err := json.Unmarshal([]byte(s), &obj); err != nil {
		return false
	}

	entry.Level = normalizeLevel(strVal(obj, "level", "L", "severity"))
	entry.Message = strVal(obj, "msg", "message", "M")
	entry.Controller = strVal(obj, "controller", "ctrl")
	entry.ReconcileID = strVal(obj, "reconcileID", "reconcile_id", "requestID")

	// Resource: typically "namespace/name" or just "name"
	if ns := strVal(obj, "namespace"); ns != "" {
		if name := strVal(obj, "name"); name != "" {
			entry.Resource = ns + "/" + name
		}
	}
	if entry.Resource == "" {
		entry.Resource = strVal(obj, "resource", "object")
	}

	// Timestamp from JSON if not already set by kubectl prefix
	if entry.Timestamp.IsZero() {
		if tsStr := strVal(obj, "ts", "timestamp", "time", "T"); tsStr != "" {
			for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02T15:04:05.999999999"} {
				if t, err := time.Parse(layout, tsStr); err == nil {
					entry.Timestamp = t
					break
				}
			}
		}
	}

	if entry.Level == "" {
		entry.Level = "info"
	}

	return true
}

// tryParseKlog parses klog-style lines: I0325 20:45:07.123456 12345 file.go:42] message
func tryParseKlog(entry *LogEntry, s string) bool {
	if len(s) < 5 {
		return false
	}

	// First char is severity: I=info, W=warning, E=error, F=fatal
	severity := s[0]
	switch severity {
	case 'I':
		entry.Level = "info"
	case 'W':
		entry.Level = "warn"
	case 'E':
		entry.Level = "error"
	case 'F':
		entry.Level = "fatal"
	default:
		return false
	}

	// Look for "] " which separates the klog header from the message
	bracketIdx := strings.Index(s, "] ")
	if bracketIdx < 0 {
		return false
	}

	entry.Message = s[bracketIdx+2:]

	// Try to extract controller/resource from the message
	entry.Controller = extractQuotedField(entry.Message, "controller")
	entry.Resource = extractQuotedField(entry.Message, "resource")
	if entry.Resource == "" {
		entry.Resource = extractQuotedField(entry.Message, "name")
	}
	entry.ReconcileID = extractQuotedField(entry.Message, "reconcileID")

	return true
}

// --- helpers ---

func strVal(obj map[string]any, keys ...string) string {
	for _, k := range keys {
		if v, ok := obj[k]; ok {
			if s, ok := v.(string); ok {
				return s
			}
			// Handle numeric values (e.g. ts as epoch)
			if f, ok := v.(float64); ok {
				return strings.TrimRight(strings.TrimRight(
					time.Unix(int64(f), int64((f-float64(int64(f)))*1e9)).UTC().Format(time.RFC3339Nano),
					"0"), ".")
			}
		}
	}
	return ""
}

func normalizeLevel(level string) string {
	switch strings.ToLower(level) {
	case "info", "information":
		return "info"
	case "warn", "warning":
		return "warn"
	case "error", "err":
		return "error"
	case "debug", "trace":
		return "debug"
	case "fatal", "critical", "panic":
		return "fatal"
	default:
		return strings.ToLower(level)
	}
}

func guessLevel(msg string) string {
	lower := strings.ToLower(msg)
	switch {
	case strings.Contains(lower, "error") || strings.Contains(lower, "fail"):
		return "error"
	case strings.Contains(lower, "warn"):
		return "warn"
	case strings.Contains(lower, "debug"):
		return "debug"
	default:
		return "info"
	}
}

// extractQuotedField extracts key="value" patterns from a klog message string.
func extractQuotedField(msg, key string) string {
	patterns := []string{
		key + `="`,
		key + `=`,
	}
	for _, pat := range patterns {
		idx := strings.Index(msg, pat)
		if idx < 0 {
			continue
		}
		start := idx + len(pat)
		if strings.HasSuffix(pat, `="`) {
			end := strings.IndexByte(msg[start:], '"')
			if end >= 0 {
				return msg[start : start+end]
			}
		} else {
			end := strings.IndexAny(msg[start:], " \t\n,")
			if end < 0 {
				return msg[start:]
			}
			return msg[start : start+end]
		}
	}
	return ""
}
