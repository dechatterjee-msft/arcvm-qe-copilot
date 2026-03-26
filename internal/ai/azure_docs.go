package ai

import (
	"context"
	"fmt"
	"html"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"
)

var (
	reScriptStyle = regexp.MustCompile(`(?is)<(script|style)[^>]*>.*?</(script|style)>`)
	reTags        = regexp.MustCompile(`(?is)<[^>]+>`)
)

func fetchDocumentFromAzureDocs(ctx context.Context, source AzureDocsSource) (string, string, error) {
	url := strings.TrimSpace(source.URL)
	if url == "" {
		return "", "", fmt.Errorf("azureDocs.url is required")
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", "", fmt.Errorf("create azure docs request: %w", err)
	}
	req.Header.Set("User-Agent", "arcvm-qe-copilot/1.0")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", "", fmt.Errorf("fetch azure docs page: %w", err)
	}
	defer func(Body io.ReadCloser) {
		err := Body.Close()
		if err != nil {
			log.Printf("close azure docs response body: %v", err)
		}
	}(resp.Body)

	body, err := io.ReadAll(io.LimitReader(resp.Body, 6<<20))
	if err != nil {
		return "", "", fmt.Errorf("read azure docs response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", "", fmt.Errorf("azure docs returned %d", resp.StatusCode)
	}

	text := extractReadableText(string(body))
	if strings.TrimSpace(text) == "" {
		return "", "", fmt.Errorf("azure docs content extraction produced empty text")
	}

	return text, url, nil
}

func extractReadableText(rawHTML string) string {
	clean := reScriptStyle.ReplaceAllString(rawHTML, "\n")
	clean = strings.ReplaceAll(clean, "<li", "\n<li")
	clean = strings.ReplaceAll(clean, "<h1", "\n<h1")
	clean = strings.ReplaceAll(clean, "<h2", "\n<h2")
	clean = strings.ReplaceAll(clean, "<h3", "\n<h3")
	clean = strings.ReplaceAll(clean, "<p", "\n<p")
	clean = reTags.ReplaceAllString(clean, " ")
	clean = html.UnescapeString(clean)

	lines := strings.Split(clean, "\n")
	out := make([]string, 0, len(lines))
	maxLines := 2000
	for _, line := range lines {
		line = strings.Join(strings.Fields(strings.TrimSpace(line)), " ")
		if line == "" {
			continue
		}
		if len(line) < 4 {
			continue
		}
		out = append(out, "- "+line)
		if len(out) >= maxLines {
			break
		}
	}
	return strings.Join(out, "\n")
}
