package ai

import "testing"

func TestRetrieveRulesBM25PrefersRelevantRule(t *testing.T) {
	t.Parallel()

	rules := []internalRule{
		{RuleID: "rule-1", Section: "Validation", Category: "admission", Content: "Static lnet requires gateway dns and vlan"},
		{RuleID: "rule-2", Section: "Observability", Category: "general", Content: "Controller logs should include correlation id"},
		{RuleID: "rule-3", Section: "Cleanup", Category: "general", Content: "Delete nic before logical network"},
	}

	out := retrieveRules("static lnet validation vlan", rules, 2, "bm25")
	if len(out) == 0 {
		t.Fatalf("expected at least one retrieved rule")
	}
	if out[0].RuleID != "rule-1" {
		t.Fatalf("expected rule-1 to rank first, got %s", out[0].RuleID)
	}
}

func TestRetrieveRulesSimpleStrategyStillWorks(t *testing.T) {
	t.Parallel()

	rules := []internalRule{
		{RuleID: "rule-a", Section: "Validation", Category: "admission", Content: "Reject overlapping ranges"},
		{RuleID: "rule-b", Section: "Status", Category: "controller", Content: "Report ready condition"},
	}

	out := retrieveRules("overlapping validation", rules, 1, "simple")
	if len(out) != 1 {
		t.Fatalf("expected exactly one rule, got %d", len(out))
	}
	if out[0].RuleID != "rule-a" {
		t.Fatalf("expected rule-a first, got %s", out[0].RuleID)
	}
}
