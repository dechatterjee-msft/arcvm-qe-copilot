package ai

import (
	"context"
	"encoding/json"
	"math"
	"sort"
	"strings"
	"sync"
	"time"
)

type planModelSpec struct {
	Tier       string
	Deployment string
}

type planCandidateResult struct {
	Spec      planModelSpec
	Raw       string
	Cases     []PlannedTestCase
	Score     float64
	Breakdown []ScoreBreakdownItem
	Error     string
	LatencyMs int64
}

func (p *Planner) maybeRunPlanEnsemble(ctx context.Context, systemPrompt, userPrompt string, caseCount int, hasContext bool) ([]PlannedTestCase, *PlanEnsembleInfo, string, bool, error) {
	specs := uniquePlanModelSpecs(p.cfg)
	if !p.cfg.EnsembleEnabled || len(specs) < 2 {
		return nil, nil, "", false, nil
	}

	results := make([]planCandidateResult, len(specs))
	var wg sync.WaitGroup
	for i, spec := range specs {
		wg.Add(1)
		go func(idx int, model planModelSpec) {
			defer wg.Done()
			candidateCtx, cancel := context.WithTimeout(ctx, timeoutForTier(model.Tier))
			defer cancel()
			results[idx] = p.runSinglePlanCandidate(candidateCtx, model, systemPrompt, userPrompt, caseCount, hasContext)
		}(i, spec)
	}
	wg.Wait()

	bestIdx := -1
	for i := range results {
		if results[i].Error != "" || len(results[i].Cases) == 0 {
			continue
		}
		if bestIdx == -1 || results[i].Score > results[bestIdx].Score {
			bestIdx = i
		}
	}

	if bestIdx == -1 {
		return nil, buildEnsembleInfo(results, -1), "", true, nil
	}

	info := buildEnsembleInfo(results, bestIdx)
	return results[bestIdx].Cases, info, results[bestIdx].Spec.Deployment, true, nil
}

func (p *Planner) runSinglePlanCandidate(ctx context.Context, spec planModelSpec, systemPrompt, userPrompt string, caseCount int, hasContext bool) planCandidateResult {
	start := time.Now()
	result := planCandidateResult{Spec: spec}

	raw, err := p.client.ChatJSONWithDeployment(ctx, spec.Deployment, systemPrompt, userPrompt)
	result.LatencyMs = time.Since(start).Milliseconds()
	if err != nil {
		result.Error = sanitizeCandidateError(err)
		return result
	}
	result.Raw = raw

	var envelope llmPlanEnvelope
	if err := json.Unmarshal([]byte(raw), &envelope); err != nil {
		result.Error = "invalid JSON envelope"
		return result
	}
	if len(envelope.Cases) == 0 {
		result.Error = "no test cases returned"
		return result
	}

	result.Cases = envelope.Cases
	result.Score, result.Breakdown = scorePlanCandidate(envelope.Cases, caseCount, hasContext)
	return result
}

func buildEnsembleInfo(results []planCandidateResult, selected int) *PlanEnsembleInfo {
	out := &PlanEnsembleInfo{Enabled: true, Candidates: make([]PlanEnsembleCandidate, 0, len(results))}

	for _, r := range results {
		out.Candidates = append(out.Candidates, PlanEnsembleCandidate{
			Tier:      r.Spec.Tier,
			Model:     r.Spec.Deployment,
			Score:     round2(r.Score),
			LatencyMs: r.LatencyMs,
			CaseCount: len(r.Cases),
			Error:     r.Error,
			Breakdown: r.Breakdown,
		})
	}

	sort.SliceStable(out.Candidates, func(i, j int) bool {
		if out.Candidates[i].Score == out.Candidates[j].Score {
			return out.Candidates[i].LatencyMs < out.Candidates[j].LatencyMs
		}
		return out.Candidates[i].Score > out.Candidates[j].Score
	})

	if selected >= 0 {
		out.SelectedTier = results[selected].Spec.Tier
		out.SelectedModel = results[selected].Spec.Deployment
		out.Reason = "highest aggregate quality score"
	} else {
		out.Reason = "all ensemble candidates failed; fell back to default model"
	}

	return out
}

func uniquePlanModelSpecs(cfg Config) []planModelSpec {
	candidates := []planModelSpec{
		{Tier: "balanced", Deployment: strings.TrimSpace(cfg.Deployment)},
		{Tier: "fast", Deployment: strings.TrimSpace(cfg.FastDeployment)},
	}
	seen := make(map[string]struct{}, len(candidates))
	out := make([]planModelSpec, 0, len(candidates))
	for _, c := range candidates {
		if c.Deployment == "" {
			continue
		}
		if _, ok := seen[c.Deployment]; ok {
			continue
		}
		seen[c.Deployment] = struct{}{}
		out = append(out, c)
	}
	return out
}

func scorePlanCandidate(cases []PlannedTestCase, target int, hasContext bool) (float64, []ScoreBreakdownItem) {
	if len(cases) == 0 {
		return 0, []ScoreBreakdownItem{{Name: "empty", Value: 0}}
	}

	completeness := scoreCompleteness(cases)
	countFit := scoreCountFit(len(cases), target)
	citations := 1.0
	if hasContext {
		citations = scoreCitations(cases)
	}
	diversity := scoreCaseIDUniqueness(cases)

	weighted := 0.45*completeness + 0.25*countFit + 0.2*citations + 0.1*diversity
	return weighted, []ScoreBreakdownItem{
		{Name: "completeness", Value: round2(completeness)},
		{Name: "countFit", Value: round2(countFit)},
		{Name: "citations", Value: round2(citations)},
		{Name: "diversity", Value: round2(diversity)},
	}
}

func scoreCompleteness(cases []PlannedTestCase) float64 {
	if len(cases) == 0 {
		return 0
	}
	ok := 0.0
	for _, tc := range cases {
		fields := 0.0
		if strings.TrimSpace(tc.Objective) != "" {
			fields += 1
		}
		if strings.TrimSpace(tc.Mutation) != "" {
			fields += 1
		}
		if strings.TrimSpace(tc.ExpectedOutcome) != "" {
			fields += 1
		}
		if tc.RunRequest.Resources.LogicalNetwork != nil || tc.RunRequest.Resources.NetworkInterface != nil || len(tc.RunRequest.Resources.LogicalNetworks) > 0 || len(tc.RunRequest.Resources.NetworkInterfaces) > 0 {
			fields += 1
		}
		ok += fields / 4.0
	}
	return ok / float64(len(cases))
}

func scoreCountFit(actual, target int) float64 {
	if target <= 0 {
		return 1
	}
	delta := math.Abs(float64(actual - target))
	maxDelta := math.Max(1, float64(target))
	score := 1 - (delta / maxDelta)
	if score < 0 {
		return 0
	}
	return score
}

func scoreCitations(cases []PlannedTestCase) float64 {
	if len(cases) == 0 {
		return 0
	}
	withCitations := 0
	for _, tc := range cases {
		if len(tc.Citations) > 0 {
			withCitations++
		}
	}
	return float64(withCitations) / float64(len(cases))
}

func scoreCaseIDUniqueness(cases []PlannedTestCase) float64 {
	if len(cases) == 0 {
		return 0
	}
	seen := make(map[string]struct{}, len(cases))
	for _, tc := range cases {
		id := strings.TrimSpace(tc.CaseID)
		if id == "" {
			continue
		}
		seen[id] = struct{}{}
	}
	return float64(len(seen)) / float64(len(cases))
}

func round2(v float64) float64 {
	return math.Round(v*100) / 100
}

func timeoutForTier(tier string) time.Duration {
	switch strings.ToLower(strings.TrimSpace(tier)) {
	case "fast":
		return 20 * time.Second
	default:
		return 45 * time.Second
	}
}

func sanitizeCandidateError(err error) string {
	if err == nil {
		return ""
	}
	msg := err.Error()
	lower := strings.ToLower(msg)

	if strings.Contains(lower, "context deadline exceeded") || strings.Contains(lower, "client.timeout") {
		return "request timed out waiting for model response"
	}
	if strings.Contains(lower, "returned 404") || strings.Contains(lower, "deploymentnotfound") {
		return "deployment not found or unavailable"
	}
	if strings.Contains(lower, "returned 429") {
		return "rate limited by Azure OpenAI"
	}

	return msg
}
