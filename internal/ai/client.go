package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"time"

	"arcvm-qe-copilot/internal/logging"
)

type Client struct {
	httpClient *http.Client
	cfg        Config
	logger     *log.Logger
	aiLog      *log.Logger
}

type chatCompletionsRequest struct {
	Messages []chatMessage `json:"messages"`
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatCompletionsResponse struct {
	Choices []struct {
		Message chatMessage `json:"message"`
	} `json:"choices"`
}

type embeddingsRequest struct {
	Input string `json:"input"`
}

type embeddingsResponse struct {
	Data []struct {
		Embedding []float64 `json:"embedding"`
	} `json:"data"`
}

func NewClient(cfg Config, logger *log.Logger) *Client {
	var aiLog *log.Logger
	if logger != nil {
		aiLog = logging.Tagged(logger, "Azure OpenAI")
	}
	return &Client{
		httpClient: &http.Client{Timeout: 85 * time.Second},
		cfg:        cfg,
		logger:     logger,
		aiLog:      aiLog,
	}
}

func (c *Client) ChatJSON(ctx context.Context, systemPrompt, userPrompt string) (string, error) {
	return c.ChatJSONWithDeployment(ctx, c.cfg.Deployment, systemPrompt, userPrompt)
}

func (c *Client) ChatJSONWithDeployment(ctx context.Context, deployment, systemPrompt, userPrompt string) (string, error) {
	deployment = strings.TrimSpace(deployment)
	if deployment == "" {
		deployment = c.cfg.Deployment
	}
	url := fmt.Sprintf("%s/openai/deployments/%s/chat/completions?api-version=%s", c.cfg.Endpoint, deployment, c.cfg.APIVersion)

	payload := chatCompletionsRequest{
		Messages: []chatMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userPrompt},
		},
	}

	raw, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("marshal azure openai request: %w", err)
	}

	if c.aiLog != nil {
		c.aiLog.Printf("Request deployment: %s", deployment)
		c.aiLog.Printf("Request body size: %d bytes", len(raw))
		c.aiLog.Printf("Request structure: {\"messages\":[{\"role\":\"system\",\"content_length\":%d},{\"role\":\"user\",\"content_length\":%d}]}", len(systemPrompt), len(userPrompt))
		c.aiLog.Printf("Request headers: Content-Type=application/json, api-key=%s", logging.MaskKey(c.cfg.APIKey))
		c.aiLog.Printf("Sending request to: %s", url)
	}

	const maxAttempts = 2
	var body []byte
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(raw))
		if err != nil {
			return "", fmt.Errorf("create azure openai request: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("api-key", c.cfg.APIKey)

		if c.aiLog != nil && attempt > 1 {
			c.aiLog.Printf("Retry attempt %d/%d for deployment %s", attempt, maxAttempts, deployment)
		}

		start := time.Now()
		resp, err := c.httpClient.Do(req)
		elapsed := time.Since(start)
		if err != nil {
			if c.aiLog != nil {
				c.aiLog.Printf("Request failed after %s: %v", elapsed, err)
			}
			if attempt < maxAttempts && isTimeoutErr(err) {
				select {
				case <-time.After(750 * time.Millisecond):
					continue
				case <-ctx.Done():
					return "", fmt.Errorf("call azure openai: %w", ctx.Err())
				}
			}
			return "", fmt.Errorf("call azure openai: %w", err)
		}

		body, err = io.ReadAll(io.LimitReader(resp.Body, 2<<20))
		resp.Body.Close()
		if err != nil {
			return "", fmt.Errorf("read azure openai response: %w", err)
		}

		if c.aiLog != nil {
			c.aiLog.Printf("Response status: %d %s (%.2fs)", resp.StatusCode, resp.Status, elapsed.Seconds())
			c.aiLog.Printf("Response headers: Content-Type=%s, Content-Length=%d", resp.Header.Get("Content-Type"), len(body))
			c.aiLog.Printf("Response body size: %d bytes", len(body))
		}

		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			break
		}

		statusErr := fmt.Errorf("azure openai returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
		if c.aiLog != nil {
			c.aiLog.Printf("Error response: %s", logging.Preview(string(body), 200))
		}
		if attempt < maxAttempts && (resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500) {
			select {
			case <-time.After(750 * time.Millisecond):
				continue
			case <-ctx.Done():
				return "", fmt.Errorf("call azure openai: %w", ctx.Err())
			}
		}

		return "", statusErr
	}

	var out chatCompletionsResponse
	if err := json.Unmarshal(body, &out); err != nil {
		return "", fmt.Errorf("decode azure openai response: %w", err)
	}

	if len(out.Choices) == 0 {
		return "", fmt.Errorf("azure openai returned no choices")
	}

	content := strings.TrimSpace(out.Choices[0].Message.Content)
	if content == "" {
		return "", fmt.Errorf("azure openai returned empty content")
	}

	if c.aiLog != nil {
		c.aiLog.Printf("Successfully received response with %d choice(s), content length: %d chars", len(out.Choices), len(content))
		c.aiLog.Printf("Content preview: %s", logging.Preview(content, 200))
	}

	return stripMarkdownCodeFence(content), nil
}

// Chat sends a multi-turn conversation to Azure OpenAI and returns the
// assistant's reply as plain text.
func (c *Client) Chat(ctx context.Context, messages []chatMessage) (string, error) {
	deployment := c.cfg.Deployment
	url := fmt.Sprintf("%s/openai/deployments/%s/chat/completions?api-version=%s", c.cfg.Endpoint, deployment, c.cfg.APIVersion)

	payload := chatCompletionsRequest{Messages: messages}
	raw, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("marshal chat request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(raw))
	if err != nil {
		return "", fmt.Errorf("create chat request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("api-key", c.cfg.APIKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("call azure openai: %w", err)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	resp.Body.Close()
	if err != nil {
		return "", fmt.Errorf("read chat response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("azure openai returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var out chatCompletionsResponse
	if err := json.Unmarshal(body, &out); err != nil {
		return "", fmt.Errorf("decode chat response: %w", err)
	}
	if len(out.Choices) == 0 {
		return "", fmt.Errorf("azure openai returned no choices")
	}
	return strings.TrimSpace(out.Choices[0].Message.Content), nil
}

func isTimeoutErr(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	var netErr net.Error
	return errors.As(err, &netErr) && netErr.Timeout()
}

func stripMarkdownCodeFence(s string) string {
	s = strings.TrimSpace(s)
	if !strings.HasPrefix(s, "```") {
		return s
	}

	s = strings.TrimPrefix(s, "```")
	s = strings.TrimLeft(s, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ\n")
	if idx := strings.LastIndex(s, "```"); idx >= 0 {
		s = s[:idx]
	}
	return strings.TrimSpace(s)
}

func (c *Client) Embedding(ctx context.Context, input string) ([]float64, error) {
	if strings.TrimSpace(c.cfg.EmbeddingDeployment) == "" {
		return nil, fmt.Errorf("embedding deployment is not configured")
	}

	url := fmt.Sprintf("%s/openai/deployments/%s/embeddings?api-version=%s", c.cfg.Endpoint, c.cfg.EmbeddingDeployment, c.cfg.APIVersion)
	payload := embeddingsRequest{Input: input}

	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal embedding request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(raw))
	if err != nil {
		return nil, fmt.Errorf("create embedding request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("api-key", c.cfg.APIKey)

	start := time.Now()
	resp, err := c.httpClient.Do(req)
	elapsed := time.Since(start)
	if err != nil {
		if c.aiLog != nil {
			c.aiLog.Printf("Embedding request failed after %s: %v", elapsed, err)
		}
		return nil, fmt.Errorf("call embeddings api: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return nil, fmt.Errorf("read embeddings response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		if c.aiLog != nil {
			c.aiLog.Printf("Embedding response %d (%s) for deployment %s", resp.StatusCode, resp.Status, c.cfg.EmbeddingDeployment)
		}
		return nil, fmt.Errorf("embeddings api returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var out embeddingsResponse
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, fmt.Errorf("decode embeddings response: %w", err)
	}
	if len(out.Data) == 0 || len(out.Data[0].Embedding) == 0 {
		return nil, fmt.Errorf("embeddings api returned no vectors")
	}

	return out.Data[0].Embedding, nil
}
