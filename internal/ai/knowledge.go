package ai

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"math"
	"os"
	"sort"
	"strings"
	"time"
)

type internalRule struct {
	RuleID    string
	Layer     string
	Category  string
	Section   string
	Content   string
	SourceURL string
	Score     float64
}

func parseRulesFromMarkdown(markdown, sourceURL, layer string) []internalRule {
	lines := strings.Split(markdown, "\n")
	section := "General"
	rules := make([]internalRule, 0, 128)

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}

		if strings.HasPrefix(trimmed, "#") {
			section = strings.TrimSpace(strings.TrimLeft(trimmed, "#"))
			continue
		}

		if !isRuleLine(trimmed) {
			continue
		}

		content := normalizeRuleContent(trimmed)
		if len(content) < 8 {
			continue
		}

		hash := sha1.Sum([]byte(section + "|" + content))
		ruleID := "rule-" + hex.EncodeToString(hash[:4])
		rules = append(rules, internalRule{
			RuleID:    ruleID,
			Layer:     layer,
			Category:  inferCategory(section, content),
			Section:   section,
			Content:   content,
			SourceURL: sourceURL,
		})
	}

	return dedupeRules(rules)
}

func isRuleLine(line string) bool {
	if strings.HasPrefix(line, "- ") || strings.HasPrefix(line, "* ") {
		return true
	}
	if len(line) > 2 && line[0] >= '0' && line[0] <= '9' {
		for i := 1; i < len(line); i++ {
			if line[i] == '.' || line[i] == ')' {
				return i+1 < len(line) && line[i+1] == ' '
			}
			if line[i] < '0' || line[i] > '9' {
				break
			}
		}
	}
	return false
}

func normalizeRuleContent(line string) string {
	line = strings.TrimSpace(line)
	line = strings.TrimPrefix(line, "- ")
	line = strings.TrimPrefix(line, "* ")
	for i := 0; i < len(line); i++ {
		if (line[i] == '.' || line[i] == ')') && i > 0 {
			prefix := line[:i]
			isNum := true
			for _, ch := range prefix {
				if ch < '0' || ch > '9' {
					isNum = false
					break
				}
			}
			if isNum {
				line = strings.TrimSpace(line[i+1:])
			}
			break
		}
	}
	return strings.Join(strings.Fields(line), " ")
}

func inferCategory(section, content string) string {
	v := strings.ToLower(section + " " + content)
	switch {
	case strings.Contains(v, "admission") || strings.Contains(v, "reject") || strings.Contains(v, "validation"):
		return "admission"
	case strings.Contains(v, "immutability") || strings.Contains(v, "cannot be changed"):
		return "immutability"
	case strings.Contains(v, "overlap") || strings.Contains(v, "vlan"):
		return "network-policy"
	case strings.Contains(v, "reconcile") || strings.Contains(v, "ready") || strings.Contains(v, "status"):
		return "controller"
	case strings.Contains(v, "ippool") || strings.Contains(v, "allocation"):
		return "allocation"
	case strings.Contains(v, "log") || strings.Contains(v, "observability"):
		return "observability"
	default:
		return "general"
	}
}

func dedupeRules(rules []internalRule) []internalRule {
	seen := make(map[string]struct{}, len(rules))
	out := make([]internalRule, 0, len(rules))
	for _, rule := range rules {
		key := rule.Section + "|" + rule.Content
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, rule)
	}
	return out
}

func buildRulesetMetadata(sourceType, sourceRef string, rules []internalRule) RulesetMetadata {
	var material strings.Builder
	for _, rule := range rules {
		material.WriteString(rule.RuleID)
		material.WriteString("|")
		material.WriteString(rule.Section)
		material.WriteString("|")
		material.WriteString(rule.Content)
		material.WriteString("\n")
	}
	h := sha1.Sum([]byte(material.String()))
	version := hex.EncodeToString(h[:])
	id := "ruleset-" + version[:10]

	return RulesetMetadata{
		RulesetID:   id,
		VersionHash: version,
		SourceType:  sourceType,
		SourceRef:   sourceRef,
		GeneratedAt: time.Now().UTC(),
		TotalRules:  len(rules),
	}
}

func retrieveRules(query string, rules []internalRule, topK int, lexical string) []internalRule {
	if len(rules) == 0 {
		return nil
	}
	if topK <= 0 {
		topK = 12
	}
	if topK > len(rules) {
		topK = len(rules)
	}

	qTokens := tokenize(query)
	strategy := strings.ToLower(strings.TrimSpace(lexical))
	if strategy == "" {
		strategy = "bm25"
	}

	bm25 := make(map[string]float64, len(rules))
	if strategy == "bm25" {
		bm25 = computeBM25Scores(qTokens, rules)
	}

	scored := make([]internalRule, 0, len(rules))
	for _, rule := range rules {
		if strategy == "bm25" {
			rule.Score = bm25[rule.RuleID]
		} else {
			rule.Score = lexicalScore(qTokens, rule)
		}
		scored = append(scored, rule)
	}

	sort.SliceStable(scored, func(i, j int) bool {
		if scored[i].Score == scored[j].Score {
			return scored[i].RuleID < scored[j].RuleID
		}
		return scored[i].Score > scored[j].Score
	})

	return scored[:topK]
}

func computeBM25Scores(queryTokens []string, rules []internalRule) map[string]float64 {
	out := make(map[string]float64, len(rules))
	if len(rules) == 0 || len(queryTokens) == 0 {
		return out
	}

	tfList := make([]map[string]int, 0, len(rules))
	docLen := make([]int, 0, len(rules))
	df := make(map[string]int)
	avgLen := 0.0

	for _, rule := range rules {
		text := strings.ToLower(rule.Section + " " + rule.Category + " " + rule.Content)
		terms := tokenizeAll(text)
		tf := make(map[string]int, len(terms))
		seen := make(map[string]struct{}, len(terms))
		for _, term := range terms {
			tf[term]++
			if _, ok := seen[term]; !ok {
				seen[term] = struct{}{}
				df[term]++
			}
		}
		tfList = append(tfList, tf)
		docLen = append(docLen, len(terms))
		avgLen += float64(len(terms))
	}

	avgLen /= float64(len(rules))
	if avgLen <= 0 {
		avgLen = 1
	}

	const k1 = 1.2
	const b = 0.75
	N := float64(len(rules))

	for i, rule := range rules {
		tf := tfList[i]
		dl := float64(docLen[i])
		score := 0.0
		for _, tok := range queryTokens {
			dfTok := float64(df[tok])
			if dfTok <= 0 {
				continue
			}
			idf := math.Log(1 + (N-dfTok+0.5)/(dfTok+0.5))
			tfTok := float64(tf[tok])
			if tfTok <= 0 {
				continue
			}
			num := tfTok * (k1 + 1)
			den := tfTok + k1*(1-b+b*(dl/avgLen))
			score += idf * (num / den)
		}

		text := strings.ToLower(rule.Section + " " + rule.Content)
		if strings.Contains(text, "validation") || strings.Contains(text, "admission") {
			score += 0.1
		}
		if strings.Contains(text, "azure local") || strings.Contains(text, "stack-hci") {
			score += 0.1
		}

		out[rule.RuleID] = score
	}

	return out
}

func tokenizeAll(s string) []string {
	s = strings.ToLower(s)
	replacer := strings.NewReplacer(",", " ", ".", " ", ":", " ", ";", " ", "(", " ", ")", " ", "[", " ", "]", " ", "-", " ", "\n", " ", "\t", " ")
	s = replacer.Replace(s)
	parts := strings.Fields(s)
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if len(p) < 2 {
			continue
		}
		out = append(out, p)
	}
	return out
}

func lexicalScore(tokens []string, rule internalRule) float64 {
	if len(tokens) == 0 {
		return 0
	}
	text := strings.ToLower(rule.Section + " " + rule.Category + " " + rule.Content)
	score := 0.0
	for _, tok := range tokens {
		if strings.Contains(text, tok) {
			score += 1.0
		}
	}
	if strings.Contains(text, "validation") || strings.Contains(text, "admission") {
		score += 0.2
	}
	if strings.Contains(text, "azure local") || strings.Contains(text, "stack-hci") {
		score += 0.2
	}
	return score
}

func tokenize(s string) []string {
	s = strings.ToLower(s)
	replacer := strings.NewReplacer(",", " ", ".", " ", ":", " ", ";", " ", "(", " ", ")", " ", "[", " ", "]", " ", "-", " ")
	s = replacer.Replace(s)
	parts := strings.Fields(s)
	out := make([]string, 0, len(parts))
	seen := map[string]struct{}{}
	for _, p := range parts {
		if len(p) < 3 {
			continue
		}
		if _, ok := seen[p]; ok {
			continue
		}
		seen[p] = struct{}{}
		out = append(out, p)
	}
	return out
}

func toRuleEntries(rules []internalRule) []RuleEntry {
	out := make([]RuleEntry, 0, len(rules))
	for _, rule := range rules {
		out = append(out, RuleEntry{
			RuleID:    rule.RuleID,
			Layer:     rule.Layer,
			Category:  rule.Category,
			Section:   rule.Section,
			Content:   rule.Content,
			SourceURL: rule.SourceURL,
			Score:     rule.Score,
		})
	}
	return out
}

func loadRulesFromSource(ctx context.Context, source *DocSource) ([]internalRule, RulesetMetadata, error) {
	resolved, err := resolveDocSource(source)
	if err != nil {
		return nil, RulesetMetadata{}, err
	}

	typeValue := strings.ToLower(strings.TrimSpace(resolved.Type))
	switch typeValue {
	case "", "local":
		if strings.TrimSpace(resolved.LocalPath) == "" {
			return nil, RulesetMetadata{}, fmt.Errorf("docSource.localPath is required for local source")
		}
		raw, err := os.ReadFile(resolved.LocalPath)
		if err != nil {
			return nil, RulesetMetadata{}, fmt.Errorf("read local markdown: %w", err)
		}
		rules := parseRulesFromMarkdown(string(raw), resolved.LocalPath, "readme-architecture")
		meta := buildRulesetMetadata("local", resolved.LocalPath, rules)
		return rules, meta, nil
	case "ado":
		content, sourceURL, err := fetchDocumentFromADO(ctx, resolved.ADO)
		if err != nil {
			return nil, RulesetMetadata{}, err
		}
		rules := parseRulesFromMarkdown(content, sourceURL, "readme-architecture")
		meta := buildRulesetMetadata("ado", sourceURL, rules)
		return rules, meta, nil
	case "azure-docs":
		if resolved.AzureDocs == nil {
			return nil, RulesetMetadata{}, fmt.Errorf("docSource.azureDocs is required for azure-docs source")
		}
		content, sourceURL, err := fetchDocumentFromAzureDocs(ctx, *resolved.AzureDocs)
		if err != nil {
			return nil, RulesetMetadata{}, err
		}
		rules := parseRulesFromMarkdown(content, sourceURL, "azure-docs")
		meta := buildRulesetMetadata("azure-docs", sourceURL, rules)
		return rules, meta, nil
	default:
		return nil, RulesetMetadata{}, fmt.Errorf("unsupported docSource.type %q", resolved.Type)
	}
}

func loadRulesFromLayers(ctx context.Context, layers KnowledgeLayers) ([]internalRule, []RulesetMetadata, error) {
	all := make([]internalRule, 0, 256)
	metas := make([]RulesetMetadata, 0, 4)

	for _, src := range layers.AzureDocs {
		rules, meta, err := loadRulesFromSource(ctx, &DocSource{Type: "azure-docs", AzureDocs: &src})
		if err != nil {
			return nil, nil, err
		}
		all = append(all, rules...)
		metas = append(metas, meta)
	}

	if layers.ReadmeArchitecture != nil {
		rules, meta, err := loadRulesFromSource(ctx, layers.ReadmeArchitecture)
		if err != nil {
			return nil, nil, err
		}
		all = append(all, rules...)
		metas = append(metas, meta)
	}

	if len(all) == 0 {
		return nil, nil, fmt.Errorf("no rules loaded from layers")
	}

	return dedupeRules(all), metas, nil
}

func resolveDocSource(source *DocSource) (*DocSource, error) {
	if source == nil {
		if fallback := adoSourceFromEnv(); fallback != nil {
			return &DocSource{Type: "ado", ADO: fallback}, nil
		}
		if fallback := azureDocsSourceFromEnv(); fallback != nil {
			return &DocSource{Type: "azure-docs", AzureDocs: fallback}, nil
		}
		return nil, fmt.Errorf("docSource is required")
	}

	resolved := *source
	if strings.TrimSpace(resolved.Type) == "" && resolved.ADO == nil && strings.TrimSpace(resolved.LocalPath) == "" {
		if fallback := adoSourceFromEnv(); fallback != nil {
			resolved.Type = "ado"
			resolved.ADO = fallback
			return &resolved, nil
		}
		if fallback := azureDocsSourceFromEnv(); fallback != nil {
			resolved.Type = "azure-docs"
			resolved.AzureDocs = fallback
			return &resolved, nil
		}
	}

	if strings.EqualFold(strings.TrimSpace(resolved.Type), "ado") {
		fallback := adoSourceFromEnv()
		if resolved.ADO == nil {
			if fallback == nil {
				return nil, fmt.Errorf("docSource.ado is required for ado source")
			}
			resolved.ADO = fallback
			return &resolved, nil
		}

		merged := *resolved.ADO
		if fallback != nil {
			if strings.TrimSpace(merged.OrganizationURL) == "" {
				merged.OrganizationURL = fallback.OrganizationURL
			}
			if strings.TrimSpace(merged.Project) == "" {
				merged.Project = fallback.Project
			}
			if strings.TrimSpace(merged.Repository) == "" {
				merged.Repository = fallback.Repository
			}
			if strings.TrimSpace(merged.FilePath) == "" {
				merged.FilePath = fallback.FilePath
			}
			if strings.TrimSpace(merged.Branch) == "" {
				merged.Branch = fallback.Branch
			}
			if strings.TrimSpace(merged.PAT) == "" {
				merged.PAT = fallback.PAT
			}
		}
		resolved.ADO = &merged
	}

	if strings.EqualFold(strings.TrimSpace(resolved.Type), "azure-docs") {
		if resolved.AzureDocs == nil {
			if fallback := azureDocsSourceFromEnv(); fallback != nil {
				resolved.AzureDocs = fallback
			}
		}
	}

	return &resolved, nil
}

func adoSourceFromEnv() *ADORepositorySource {
	org := strings.TrimSpace(os.Getenv("AZDO_ORGANIZATION_URL"))
	project := strings.TrimSpace(os.Getenv("AZDO_PROJECT"))
	repo := strings.TrimSpace(os.Getenv("AZDO_REPOSITORY"))
	filePath := strings.TrimSpace(os.Getenv("AZDO_FILE_PATH"))
	branch := strings.TrimSpace(os.Getenv("AZDO_BRANCH"))
	pat := strings.TrimSpace(os.Getenv("AZDO_PAT"))

	if org == "" || project == "" || repo == "" || filePath == "" {
		return nil
	}

	return &ADORepositorySource{
		OrganizationURL: org,
		Project:         project,
		Repository:      repo,
		FilePath:        filePath,
		Branch:          branch,
		PAT:             pat,
	}
}

func azureDocsSourceFromEnv() *AzureDocsSource {
	url := strings.TrimSpace(os.Getenv("AZURE_DOCS_URL"))
	if url == "" {
		return nil
	}
	return &AzureDocsSource{URL: url}
}
