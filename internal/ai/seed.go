package ai

import "context"

// SeedRule is a public view of an extracted rule, used by the bootstrap command.
type SeedRule struct {
	RuleID  string
	Section string
	Content string
}

// FetchAzureDocsContent fetches and extracts readable text from an Azure Docs URL.
func FetchAzureDocsContent(ctx context.Context, url string) (string, string, error) {
	return fetchDocumentFromAzureDocs(ctx, AzureDocsSource{URL: url})
}

// ParseRulesPublic extracts rules from Markdown content and returns them as SeedRules.
func ParseRulesPublic(markdown, sourceURL, layer string) []SeedRule {
	rules := parseRulesFromMarkdown(markdown, sourceURL, layer)
	out := make([]SeedRule, len(rules))
	for i, r := range rules {
		out[i] = SeedRule{
			RuleID:  r.RuleID,
			Section: r.Section,
			Content: r.Content,
		}
	}
	return out
}
