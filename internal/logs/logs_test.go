package logs

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestOperatorsForResource(t *testing.T) {
	tests := []struct {
		resource string
		wantMin  int
	}{
		{"lnet", 2},
		{"nic", 3},
		{"nsg", 1},
		{"storagepath", 1},
		{"vm", 5},
		{"e2e", 6},
		{"nonexistent", 0},
	}
	for _, tc := range tests {
		ops := OperatorsForResource(tc.resource)
		if len(ops) < tc.wantMin {
			t.Errorf("OperatorsForResource(%q): got %d, want >= %d", tc.resource, len(ops), tc.wantMin)
		}
	}
}

func TestOperatorsForResources_Dedup(t *testing.T) {
	ops := OperatorsForResources([]string{"lnet", "nic"})
	seen := map[string]int{}
	for _, op := range ops {
		seen[op]++
		if seen[op] > 1 {
			t.Errorf("duplicate operator %q in result", op)
		}
	}
}

func TestGetOperator(t *testing.T) {
	op, ok := GetOperator("network-operator")
	if !ok {
		t.Fatal("expected network-operator to exist")
	}
	if op.Namespace == "" {
		t.Error("expected non-empty namespace")
	}
	_, ok = GetOperator("does-not-exist")
	if ok {
		t.Error("expected false for unknown operator")
	}
}

func TestAllOperators(t *testing.T) {
	all := AllOperators()
	if len(all) != len(operatorCatalog) {
		t.Errorf("AllOperators: got %d, want %d", len(all), len(operatorCatalog))
	}
}

func TestParseJSON(t *testing.T) {
	raw := "2026-03-25T20:45:07.123456Z {\"level\":\"error\",\"msg\":\"reconcile failed\",\"controller\":\"nic-controller\",\"reconcileID\":\"abc-123\",\"namespace\":\"default\",\"name\":\"qe-nic-test\"}\n2026-03-25T20:45:08.000000Z {\"level\":\"info\",\"msg\":\"reconcile succeeded\",\"controller\":\"nic-controller\",\"namespace\":\"default\",\"name\":\"qe-nic-test\"}"
	entries := ParseLogs("network-operator", raw)
	if len(entries) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(entries))
	}
	e := entries[0]
	if e.Level != "error" {
		t.Errorf("level: got %q, want error", e.Level)
	}
	if e.Controller != "nic-controller" {
		t.Errorf("controller: got %q", e.Controller)
	}
	if e.ReconcileID != "abc-123" {
		t.Errorf("reconcileID: got %q", e.ReconcileID)
	}
	if e.Resource != "default/qe-nic-test" {
		t.Errorf("resource: got %q", e.Resource)
	}
}

func TestParseKlog(t *testing.T) {
	raw := "I0325 20:45:07.123456 12345 controller.go:42] Reconcile succeeded for controller=\"nic-controller\" resource=\"default/qe-nic-test\"\nE0325 20:45:08.000000 12345 controller.go:99] Error reconciling controller=\"nic-controller\""
	entries := ParseLogs("network-operator", raw)
	if len(entries) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(entries))
	}
	if entries[0].Level != "info" {
		t.Errorf("first level: got %q", entries[0].Level)
	}
	if entries[1].Level != "error" {
		t.Errorf("second level: got %q", entries[1].Level)
	}
}

func TestParsePlainText(t *testing.T) {
	raw := "some plain text error message"
	entries := ParseLogs("test-op", raw)
	if len(entries) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(entries))
	}
	if entries[0].Level != "error" {
		t.Errorf("level: got %q, want error", entries[0].Level)
	}
}

func TestStoreRoundTrip(t *testing.T) {
	dir := t.TempDir()
	s := NewStore(dir)
	entries := []LogEntry{
		{Timestamp: time.Now().UTC(), Level: "error", Message: "fail", Operator: "network-operator"},
		{Timestamp: time.Now().UTC(), Level: "info", Message: "ok", Operator: "network-operator"},
	}
	if err := s.Save("job-1", "network-operator", entries); err != nil {
		t.Fatalf("Save: %v", err)
	}
	loaded, err := s.Load("job-1", "network-operator")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(loaded) != 2 {
		t.Fatalf("Load: got %d entries, want 2", len(loaded))
	}
	ops, err := s.ListOperators("job-1")
	if err != nil {
		t.Fatalf("ListOperators: %v", err)
	}
	if len(ops) != 1 || ops[0] != "network-operator" {
		t.Errorf("ListOperators: got %v", ops)
	}
	summary, err := s.Summary("job-1")
	if err != nil {
		t.Fatalf("Summary: %v", err)
	}
	if len(summary.Operators) != 1 {
		t.Fatalf("Summary operators: got %d", len(summary.Operators))
	}
	if summary.Operators[0].ErrorCount != 1 {
		t.Errorf("ErrorCount: got %d, want 1", summary.Operators[0].ErrorCount)
	}
}

func TestStoreLoadEmpty(t *testing.T) {
	dir := t.TempDir()
	s := NewStore(dir)
	entries, err := s.Load("nonexistent", "op")
	if err != nil {
		t.Fatalf("Load nonexistent: %v", err)
	}
	if entries != nil {
		t.Errorf("expected nil, got %v", entries)
	}
}

func TestStoreSaveRaw(t *testing.T) {
	dir := t.TempDir()
	s := NewStore(dir)
	if err := s.SaveRaw("job-1", "network-operator", "raw log content"); err != nil {
		t.Fatalf("SaveRaw: %v", err)
	}
	path := filepath.Join(dir, "job-1", "network-operator.raw.log")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read raw: %v", err)
	}
	if string(data) != "raw log content" {
		t.Errorf("raw: got %q", string(data))
	}
}
