package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"strings"
)

func fetchDocumentFromADO(ctx context.Context, source *ADORepositorySource) (string, string, error) {
	if source == nil {
		return "", "", fmt.Errorf("ado source is required")
	}
	if strings.TrimSpace(source.OrganizationURL) == "" {
		return "", "", fmt.Errorf("ado.organizationUrl is required")
	}
	if strings.TrimSpace(source.Project) == "" {
		return "", "", fmt.Errorf("ado.project is required")
	}
	if strings.TrimSpace(source.Repository) == "" {
		return "", "", fmt.Errorf("ado.repository is required")
	}
	if strings.TrimSpace(source.FilePath) == "" {
		return "", "", fmt.Errorf("ado.filePath is required")
	}

	branch := strings.TrimSpace(source.Branch)
	if branch == "" {
		branch = "main"
	}

	base := strings.TrimRight(strings.TrimSpace(source.OrganizationURL), "/")
	projectEscaped := url.PathEscape(source.Project)
	apiURL := fmt.Sprintf("%s/%s/_apis/git/repositories/%s/items", base, projectEscaped, url.PathEscape(source.Repository))
	if strings.HasSuffix(strings.ToLower(base), "/"+strings.ToLower(source.Project)) {
		apiURL = fmt.Sprintf("%s/_apis/git/repositories/%s/items", base, url.PathEscape(source.Repository))
	}

	u, err := url.Parse(apiURL)
	if err != nil {
		return "", "", fmt.Errorf("build ado url: %w", err)
	}

	q := u.Query()
	q.Set("path", source.FilePath)
	q.Set("versionDescriptor.version", branch)
	q.Set("includeContent", "true")
	q.Set("api-version", "7.1")
	u.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return "", "", fmt.Errorf("create ado request: %w", err)
	}

	pat := strings.TrimSpace(source.PAT)
	if pat == "" {
		pat = strings.TrimSpace(os.Getenv("AZDO_PAT"))
	}
	if pat == "" {
		return "", "", fmt.Errorf("ado PAT is required via docSource.ado.pat or AZDO_PAT")
	}

	auth := base64.StdEncoding.EncodeToString([]byte(":" + pat))
	req.Header.Set("Authorization", "Basic "+auth)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", "", fmt.Errorf("call ado api: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return "", "", fmt.Errorf("read ado response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", "", fmt.Errorf("ado api returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	content := ""
	trimmed := strings.TrimSpace(string(body))
	if strings.HasPrefix(trimmed, "{") {
		var payload struct {
			Content string `json:"content"`
		}
		if err := json.Unmarshal(body, &payload); err != nil {
			return "", "", fmt.Errorf("decode ado response: %w", err)
		}
		content = payload.Content
	} else {
		content = string(body)
	}
	if strings.TrimSpace(content) == "" {
		return "", "", fmt.Errorf("ado file content is empty")
	}

	sourceURL := buildAdoSourceURL(base, source.Project, source.Repository, source.FilePath, branch)
	return content, sourceURL, nil
}

func buildAdoSourceURL(base, project, repo, filePath, branch string) string {
	if branch == "" {
		branch = "main"
	}
	safePath := path.Clean("/" + strings.TrimSpace(filePath))
	return fmt.Sprintf("%s/%s/_git/%s?path=%s&version=GB%s", strings.TrimRight(base, "/"), url.PathEscape(project), url.PathEscape(repo), url.QueryEscape(safePath), url.QueryEscape(branch))
}
