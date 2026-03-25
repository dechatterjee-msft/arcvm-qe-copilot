package ai

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"sort"
	"strings"
	"time"

	"arcvm-qe-copilot/internal/logging"
	"arcvm-qe-copilot/internal/spec"
)

type Planner struct {
	client  *Client
	cfg     Config
	logger  *log.Logger
	planLog *log.Logger
	store   *EmbeddingStore
}

type llmPlanEnvelope struct {
	Cases []PlannedTestCase `json:"cases"`
}

func NewServiceFromEnv(logger *log.Logger) (Service, error) {
	cfg, err := LoadConfigFromEnv()
	if err != nil {
		return nil, err
	}
	if !cfg.Enabled {
		return nil, nil
	}

	var planLog *log.Logger
	if logger != nil {
		planLog = logging.Tagged(logger, "Planner")
	}

	var store *EmbeddingStore
	if cfg.EmbeddingStoreOn && strings.TrimSpace(cfg.EmbeddingDeployment) != "" {
		store, err = NewEmbeddingStore(cfg.EmbeddingStorePath)
		if err != nil {
			return nil, err
		}
		if planLog != nil {
			planLog.Printf("Embedding SQLite cache enabled path=%s", cfg.EmbeddingStorePath)
		}
	}

	return &Planner{
		client:  NewClient(cfg, logger),
		cfg:     cfg,
		logger:  logger,
		planLog: planLog,
		store:   store,
	}, nil
}

func (p *Planner) PreviewRuleset(req RulesetPreviewRequest) (*RulesetPreviewResponse, error) {
	rules, meta, selected, err := p.buildRulesContext(context.Background(), req.DocSource, req.Layers, req.Retrieval, nil)
	if err != nil {
		return nil, err
	}
	if len(selected) == 0 {
		selected = rules
	}

	return &RulesetPreviewResponse{
		Ruleset:        meta,
		RetrievedRules: toRuleEntries(selected),
	}, nil
}

func (p *Planner) GenerateTestPlan(req TestPlanRequest) (*TestPlanResponse, error) {
	if !p.cfg.Enabled {
		return nil, fmt.Errorf("azure openai planner is disabled")
	}

	caseCount := req.CaseCount
	if caseCount <= 0 {
		caseCount = 10
	}
	if caseCount > 50 {
		caseCount = 50
	}

	if req.Baseline.Resources.IsEmpty() {
		return nil, fmt.Errorf("baseline.resources must define at least one resource")
	}

	baselineJSON, err := json.MarshalIndent(req.Baseline, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("marshal baseline request: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	workingChunks := req.ContextChunks
	var (
		rulesetMeta   *RulesetMetadata
		retrievedList []RuleEntry
	)
	if req.DocSource != nil || len(req.ContextChunks) == 0 {
		_, meta, selected, err := p.buildRulesContext(ctx, req.DocSource, req.Layers, req.Retrieval, req.ContextChunks)
		if err != nil {
			if req.DocSource != nil {
				return nil, err
			}
		} else {
			rulesetMeta = &meta
			retrievedList = toRuleEntries(selected)
			if len(selected) > 0 {
				workingChunks = mergeChunksWithRules(req.ContextChunks, selected)
			}
		}
	}

	systemPrompt := `You are a senior QE engineer for Azure Local resources.
Return STRICT JSON only with this schema:
{
  "cases": [
    {
      "caseId": "string",
      "objective": "string",
      "mutation": "string",
      "expectedOutcome": "string",
			"citations": ["chunk-id"],
      "runRequest": { ... }
    }
  ]
}
Rules:
- Generate test cases targeting the resource types present in the baseline.
- Use generic case IDs like "TC-001", "TC-002" (do not use resource-specific prefixes).
- CRITICAL: Every runRequest MUST include a "resources" object populated with the concrete resource specs needed for that test case. Copy the relevant resource definitions from the baseline and mutate them per the test objective. Never return an empty resources object.
- When the baseline contains multiple resource types (e.g. logicalNetwork, networkInterface, virtualHardDisk, virtualMachine), each runRequest MUST include ALL resource types that the test case exercises. For dependency-order or E2E tests, include the full set of resources.
- Keep each runRequest compatible with backend fields used in the baseline.
- Preserve top-level subscription/resourceGroup/location/customLocationId unless the case objective requires a negative scenario.
- Use only actions supported by backend: provision, show, cleanup.
- Prefer evidence-backed cases from the provided documentation context chunks.
- Every case should include citations when context chunks are provided.
- Keep JSON valid and do not include markdown.`

	strategy := strings.TrimSpace(req.Strategy)
	if strategy == "" {
		strategy = "balanced coverage of happy-path, idempotency, and negative scenarios"
	}

	userPrompt := fmt.Sprintf("Generate %d test cases using this strategy: %s\n\nBaseline request:\n%s", caseCount, strategy, string(baselineJSON))

	contextBlock := buildContextBlock(workingChunks)
	if contextBlock != "" {
		userPrompt += "\n\nDocumentation context chunks:\n" + contextBlock
	}

	if len(req.FileContext) > 0 {
		userPrompt += "\n\nUser-uploaded file context:"
		for _, f := range req.FileContext {
			userPrompt += fmt.Sprintf("\n\n--- File: %s ---\n%s", f.FileName, f.Content)
		}
	}

	var (
		ensembleInfo *PlanEnsembleInfo
		modelUsed    string
		cases        []PlannedTestCase
	)

	ensembleEnabled := p.cfg.EnsembleEnabled
	if req.EnsembleEnabled != nil {
		ensembleEnabled = *req.EnsembleEnabled
	}

	if ensembleEnabled {
		ensembleCases, info, deployment, attempted, err := p.maybeRunPlanEnsemble(ctx, systemPrompt, userPrompt, caseCount, len(workingChunks) > 0)
		if err != nil {
			return nil, err
		}
		if attempted {
			ensembleInfo = info
			if len(ensembleCases) > 0 {
				cases = ensembleCases
				modelUsed = deployment
			}
		}
	}

	if len(cases) == 0 {
		raw, err := p.client.ChatJSON(ctx, systemPrompt, userPrompt)
		if err != nil {
			return nil, err
		}

		var envelope llmPlanEnvelope
		if err := json.Unmarshal([]byte(raw), &envelope); err != nil {
			return nil, fmt.Errorf("parse planner response as JSON: %w", err)
		}

		if len(envelope.Cases) == 0 {
			return nil, fmt.Errorf("planner returned no test cases")
		}
		cases = envelope.Cases
		modelUsed = p.cfg.Deployment
	}

	if len(workingChunks) > 0 {
		cases = normalizeCitations(cases, workingChunks)
	}
	cases = normalizeCaseIDs(cases)
	cases = backfillEmptyResources(cases, req.Baseline)

	if p.planLog != nil {
		p.planLog.Printf("Generated %d test cases using model=%s strategy=%s", len(cases), modelUsed, logging.Preview(strategy, 80))
		logPlannedCases(p.planLog, cases)
	}

	return &TestPlanResponse{
		GeneratedAt:    time.Now().UTC(),
		Model:          modelUsed,
		Ensemble:       ensembleInfo,
		Ruleset:        rulesetMeta,
		RetrievedRules: retrievedList,
		Cases:          cases,
	}, nil
}

func (p *Planner) buildRulesContext(ctx context.Context, source *DocSource, layers KnowledgeLayers, retrieval RetrievalOptions, userChunks []DocContextChunk) ([]internalRule, RulesetMetadata, []internalRule, error) {
	var (
		rules []internalRule
		meta  RulesetMetadata
		err   error
	)

	if hasConfiguredLayers(layers) {
		var metas []RulesetMetadata
		rules, metas, err = loadRulesFromLayers(ctx, layers)
		if err != nil {
			return nil, RulesetMetadata{}, nil, err
		}
		meta = mergeRulesetMetadata(metas, rules)
	} else {
		rules, meta, err = loadRulesFromSource(ctx, source)
		if err != nil {
			return nil, RulesetMetadata{}, nil, err
		}
	}

	if len(rules) == 0 {
		return nil, RulesetMetadata{}, nil, fmt.Errorf("no rules extracted from document source")
	}

	query := strings.TrimSpace(retrieval.Query)
	if query == "" {
		query = "admission validation immutability overlap lifecycle"
	}
	topK := retrieval.TopK
	if topK <= 0 {
		topK = 18
	}

	selected := retrieveRules(query, rules, topK, retrieval.Lexical)
	if retrieval.UseEmbeddings && p.client != nil && p.cfg.EmbeddingDeployment != "" {
		reranked, err := p.rerankWithEmbeddings(ctx, query, selected)
		if err == nil && len(reranked) > 0 {
			selected = reranked
		}
	}

	if len(userChunks) > 0 {
		selected = mergeRetrievedWithUserChunks(selected, userChunks)
	}

	return rules, meta, selected, nil
}

func hasConfiguredLayers(layers KnowledgeLayers) bool {
	if len(layers.AzureDocs) > 0 {
		return true
	}
	return layers.ReadmeArchitecture != nil
}

func mergeRulesetMetadata(metas []RulesetMetadata, rules []internalRule) RulesetMetadata {
	if len(metas) == 0 {
		return buildRulesetMetadata("layered", "layered", rules)
	}
	if len(metas) == 1 {
		return metas[0]
	}

	refs := make([]string, 0, len(metas))
	for _, meta := range metas {
		refs = append(refs, meta.SourceType+":"+meta.SourceRef)
	}
	sort.Strings(refs)
	return buildRulesetMetadata("layered", strings.Join(refs, "|"), rules)
}

func (p *Planner) rerankWithEmbeddings(ctx context.Context, query string, rules []internalRule) ([]internalRule, error) {
	if len(rules) == 0 {
		return rules, nil
	}

	qv, err := p.embeddingVector(ctx, query)
	if err != nil {
		return nil, err
	}

	out := make([]internalRule, 0, len(rules))
	for _, rule := range rules {
		rv, err := p.embeddingVector(ctx, rule.Section+" "+rule.Content)
		if err != nil {
			continue
		}
		rule.Score = cosineSimilarity(qv, rv)
		out = append(out, rule)
	}
	if len(out) == 0 {
		return rules, nil
	}

	sort.SliceStable(out, func(i, j int) bool { return out[i].Score > out[j].Score })
	return out, nil
}

func (p *Planner) embeddingVector(ctx context.Context, text string) ([]float64, error) {
	if p.store != nil {
		if vec, ok, err := p.store.Get(ctx, p.cfg.EmbeddingDeployment, text); err == nil && ok {
			return vec, nil
		}
	}

	vec, err := p.client.Embedding(ctx, text)
	if err != nil {
		return nil, err
	}

	if p.store != nil {
		if err := p.store.Put(ctx, p.cfg.EmbeddingDeployment, text, vec); err != nil && p.planLog != nil {
			p.planLog.Printf("Embedding cache write failed: %v", err)
		}
	}

	return vec, nil
}

func cosineSimilarity(a, b []float64) float64 {
	if len(a) == 0 || len(b) == 0 {
		return 0
	}
	n := len(a)
	if len(b) < n {
		n = len(b)
	}
	var dot, na, nb float64
	for i := 0; i < n; i++ {
		dot += a[i] * b[i]
		na += a[i] * a[i]
		nb += b[i] * b[i]
	}
	if na == 0 || nb == 0 {
		return 0
	}
	return dot / (math.Sqrt(na) * math.Sqrt(nb))
}

func mergeChunksWithRules(chunks []DocContextChunk, rules []internalRule) []DocContextChunk {
	out := make([]DocContextChunk, 0, len(chunks)+len(rules))
	seen := map[string]struct{}{}
	for _, chunk := range chunks {
		id := strings.TrimSpace(chunk.ChunkID)
		if id == "" {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, chunk)
	}
	for _, rule := range rules {
		if _, ok := seen[rule.RuleID]; ok {
			continue
		}
		seen[rule.RuleID] = struct{}{}
		out = append(out, DocContextChunk{
			ChunkID:   rule.RuleID,
			SourceURL: rule.SourceURL,
			Section:   rule.Section,
			Content:   rule.Content,
		})
	}
	return out
}

func mergeRetrievedWithUserChunks(retrieved []internalRule, chunks []DocContextChunk) []internalRule {
	if len(chunks) == 0 {
		return retrieved
	}
	seen := make(map[string]struct{}, len(retrieved)+len(chunks))
	out := make([]internalRule, 0, len(retrieved)+len(chunks))
	for _, rule := range retrieved {
		seen[rule.RuleID] = struct{}{}
		out = append(out, rule)
	}
	for _, chunk := range chunks {
		id := strings.TrimSpace(chunk.ChunkID)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, internalRule{
			RuleID:    id,
			Category:  inferCategory(chunk.Section, chunk.Content),
			Section:   chunk.Section,
			Content:   chunk.Content,
			SourceURL: chunk.SourceURL,
			Score:     0.2,
		})
	}
	return out
}

func buildContextBlock(chunks []DocContextChunk) string {
	if len(chunks) == 0 {
		return ""
	}

	var b strings.Builder
	for _, chunk := range chunks {
		id := strings.TrimSpace(chunk.ChunkID)
		if id == "" {
			continue
		}

		b.WriteString("[DOC ")
		b.WriteString(id)
		if section := strings.TrimSpace(chunk.Section); section != "" {
			b.WriteString(" | section=")
			b.WriteString(section)
		}
		if source := strings.TrimSpace(chunk.SourceURL); source != "" {
			b.WriteString(" | source=")
			b.WriteString(source)
		}
		if updated := strings.TrimSpace(chunk.LastUpdated); updated != "" {
			b.WriteString(" | lastUpdated=")
			b.WriteString(updated)
		}
		b.WriteString("]\n")
		b.WriteString(strings.TrimSpace(chunk.Content))
		b.WriteString("\n\n")
	}

	return strings.TrimSpace(b.String())
}

func normalizeCitations(cases []PlannedTestCase, chunks []DocContextChunk) []PlannedTestCase {
	if len(cases) == 0 || len(chunks) == 0 {
		return cases
	}

	valid := make(map[string]struct{}, len(chunks))
	ordered := make([]string, 0, len(chunks))
	for _, chunk := range chunks {
		id := strings.TrimSpace(chunk.ChunkID)
		if id == "" {
			continue
		}
		if _, ok := valid[id]; ok {
			continue
		}
		valid[id] = struct{}{}
		ordered = append(ordered, id)
	}

	if len(ordered) == 0 {
		return cases
	}

	for i := range cases {
		if len(cases[i].Citations) == 0 {
			cases[i].Citations = []string{ordered[0]}
			continue
		}

		unique := make(map[string]struct{}, len(cases[i].Citations))
		filtered := make([]string, 0, len(cases[i].Citations))
		for _, citation := range cases[i].Citations {
			citation = strings.TrimSpace(citation)
			if citation == "" {
				continue
			}
			if _, ok := valid[citation]; !ok {
				continue
			}
			if _, seen := unique[citation]; seen {
				continue
			}
			unique[citation] = struct{}{}
			filtered = append(filtered, citation)
		}

		if len(filtered) == 0 {
			filtered = []string{ordered[0]}
		}
		sort.Strings(filtered)
		cases[i].Citations = filtered
	}

	return cases
}

func normalizeCaseIDs(cases []PlannedTestCase) []PlannedTestCase {
	if len(cases) == 0 {
		return cases
	}

	for i := range cases {
		cases[i].CaseID = fmt.Sprintf("TC-%03d", i+1)
	}

	return cases
}

// backfillEmptyResources copies the baseline resources into any case whose
// resources block was left empty by the LLM. This prevents the UI from
// rendering the JSON fallback when the LLM produces structurally correct
// cases but omits the concrete resource definitions.
func backfillEmptyResources(cases []PlannedTestCase, baseline spec.RunRequest) []PlannedTestCase {
	for i := range cases {
		if cases[i].RunRequest.Resources.IsEmpty() {
			cases[i].RunRequest.Resources = baseline.Resources
		}
		// Also backfill envelope fields if the LLM dropped them
		if cases[i].RunRequest.SubscriptionID == "" {
			cases[i].RunRequest.SubscriptionID = baseline.SubscriptionID
		}
		if cases[i].RunRequest.ResourceGroup == "" {
			cases[i].RunRequest.ResourceGroup = baseline.ResourceGroup
		}
		if cases[i].RunRequest.Location == "" {
			cases[i].RunRequest.Location = baseline.Location
		}
		if cases[i].RunRequest.CustomLocationID == "" {
			cases[i].RunRequest.CustomLocationID = baseline.CustomLocationID
		}
	}
	return cases
}

func logPlannedCases(planLog *log.Logger, cases []PlannedTestCase) {
	if planLog == nil || len(cases) == 0 {
		return
	}

	planLog.Printf("Test plan details (%d cases):", len(cases))
	for i, tc := range cases {
		resourceName := ""
		if tc.RunRequest.Resources.LogicalNetwork != nil {
			resourceName = "lnet:" + tc.RunRequest.Resources.LogicalNetwork.Name
		} else if tc.RunRequest.Resources.NetworkInterface != nil {
			resourceName = "nic:" + tc.RunRequest.Resources.NetworkInterface.Name
		} else if tc.RunRequest.Resources.VirtualMachine != nil {
			resourceName = "vm:" + tc.RunRequest.Resources.VirtualMachine.Name
		} else if tc.RunRequest.Resources.VirtualHardDisk != nil {
			resourceName = "vhd:" + tc.RunRequest.Resources.VirtualHardDisk.Name
		}

		planLog.Printf(
			"  [%02d] %s | objective=%s | expected=%s | citations=%s",
			i+1,
			tc.CaseID,
			normalizeLogText(tc.Objective),
			normalizeLogText(tc.ExpectedOutcome),
			formatCitations(tc.Citations),
		)
		planLog.Printf(
			"       mutation=%s | resource=%s",
			normalizeLogText(tc.Mutation),
			normalizeLogText(resourceName),
		)
	}
}

func formatCitations(citations []string) string {
	if len(citations) == 0 {
		return "none"
	}
	return strings.Join(citations, ",")
}

func normalizeLogText(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return "-"
	}
	return s
}

// EmbeddingDB returns the underlying *sql.DB from the embedding store
// so other stores (e.g. PlanStore) can share the same connection.
func (p *Planner) EmbeddingDB() *sql.DB {
	if p.store == nil {
		return nil
	}
	return p.store.DB()
}
