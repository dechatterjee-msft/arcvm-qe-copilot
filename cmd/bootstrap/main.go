package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"arcvm-qe-copilot/internal/ai"
	"arcvm-qe-copilot/internal/logging"
	"arcvm-qe-copilot/internal/store"

	"github.com/joho/godotenv"
)

// seedDocsURLs lists Azure Docs pages to pre-seed the embedding cache.
var seedDocsURLs = []struct {
	Label string
	URL   string
}{
	{"Logical Networks", "https://learn.microsoft.com/en-us/azure/azure-local/manage/create-logical-networks?view=azloc-2602&tabs=azurecli"},
	{"Network Interfaces", "https://learn.microsoft.com/en-us/azure/azure-local/manage/create-network-interfaces?view=azloc-2602&tabs=azurecli"},
	{"Network Security Groups", "https://learn.microsoft.com/en-us/azure/azure-local/manage/manage-network-security-groups?view=azloc-2602&tabs=azurecli"},
	{"Network Security Rules", "https://learn.microsoft.com/en-us/azure/azure-local/manage/manage-network-security-groups?view=azloc-2602&tabs=azurecli"},
	{"Storage Paths", "https://learn.microsoft.com/en-us/azure/azure-local/manage/create-storage-path?view=azloc-2602&tabs=azurecli"},
	{"Virtual Machines", "https://learn.microsoft.com/en-us/azure/azure-local/manage/create-arc-virtual-machines?view=azloc-2602&tabs=azurecli"},
	{"Virtual Hard Disks", "https://learn.microsoft.com/en-us/azure/azure-local/manage/virtual-hard-disks?view=azloc-2602&tabs=azurecli"},
	{"Gallery Images", "https://learn.microsoft.com/en-us/azure/azure-local/manage/virtual-machine-image-azure-marketplace?view=azloc-2602&tabs=azurecli"},
}

func main() {
	logger := logging.New()
	bootLog := logging.Tagged(logger, "Bootstrap")
	bootLog.Printf("arcvm-qe-copilot bootstrap — %s/%s", runtime.GOOS, runtime.GOARCH)

	// Step 1: Load or create .env
	if err := ensureEnvFile(bootLog); err != nil {
		bootLog.Fatalf("Env file: %v", err)
	}
	_ = godotenv.Load()

	// Step 2: Validate required env vars
	if err := validateEnv(bootLog); err != nil {
		bootLog.Fatalf("Env validation failed: %v", err)
	}

	// Step 3: Create data directory
	dataDir := envOr("AZURE_OPENAI_EMBEDDING_DB_PATH", "data/embeddings.db")
	dbDir := filepath.Dir(dataDir)
	if err := os.MkdirAll(dbDir, 0o755); err != nil {
		bootLog.Fatalf("Create data directory %s: %v", dbDir, err)
	}
	bootLog.Printf("Data directory ready: %s", dbDir)

	// Step 4: Initialize SQLite — embeddings schema
	embeddingStore, err := ai.NewEmbeddingStore(dataDir)
	if err != nil {
		bootLog.Fatalf("Init embedding store: %v", err)
	}
	defer embeddingStore.Close()
	bootLog.Printf("Embedding store initialized: %s", dataDir)

	// Step 5: Initialize SQLite — saved_plans schema
	db := embeddingStore.DB()
	planStore, err := store.NewSQLitePlanStore(db)
	if err != nil {
		bootLog.Fatalf("Init plan store: %v", err)
	}
	defer planStore.Close()
	bootLog.Printf("Plan store initialized (saved_plans table)")

	// Step 6: Seed embeddings from Azure Docs
	seedLog := logging.Tagged(logger, "EmbeddingSeed")
	if parseBool(os.Getenv("AZURE_OPENAI_ENABLED")) {
		seedEmbeddings(seedLog, embeddingStore)
	} else {
		bootLog.Printf("AZURE_OPENAI_ENABLED is not true — skipping embedding seed")
		bootLog.Printf("Configure .env and re-run 'make bootstrap' to seed embeddings")
	}

	// Step 7: Create artifacts directory
	artifactsDir := envOr("REPORT_BASE_DIR", filepath.Join(".", "artifacts", "longevity"))
	if err := os.MkdirAll(artifactsDir, 0o755); err != nil {
		bootLog.Fatalf("Create artifacts directory: %v", err)
	}
	bootLog.Printf("Artifacts directory ready: %s", artifactsDir)

	bootLog.Printf("Bootstrap complete — run 'make run' or 'go run ./cmd/server' to start")
}

func seedEmbeddings(seedLog *log.Logger, embeddingStore *ai.EmbeddingStore) {
	cfg, err := ai.LoadConfigFromEnv()
	if err != nil {
		seedLog.Printf("Skip embedding seed: %v", err)
		return
	}
	if strings.TrimSpace(cfg.EmbeddingDeployment) == "" {
		seedLog.Printf("Skip embedding seed: no embedding deployment configured")
		return
	}

	client := ai.NewClient(cfg, seedLog)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	seeded := 0
	skipped := 0

	for _, doc := range seedDocsURLs {
		seedLog.Printf("Seeding: %s", doc.Label)

		content, _, err := ai.FetchAzureDocsContent(ctx, doc.URL)
		if err != nil {
			seedLog.Printf("  Warning: could not fetch %s: %v", doc.Label, err)
			continue
		}

		rules := ai.ParseRulesPublic(content, doc.URL, "azure-docs")
		if len(rules) == 0 {
			seedLog.Printf("  Warning: no rules extracted for %s", doc.Label)
			continue
		}

		seedLog.Printf("  Extracted %d rules — generating embeddings...", len(rules))

		for _, rule := range rules {
			text := rule.Section + " " + rule.Content

			if _, ok, _ := embeddingStore.Get(ctx, cfg.EmbeddingDeployment, text); ok {
				skipped++
				continue
			}

			vec, err := client.Embedding(ctx, text)
			if err != nil {
				seedLog.Printf("  Warning: embedding failed for rule %s: %v", rule.RuleID, err)
				continue
			}

			if err := embeddingStore.Put(ctx, cfg.EmbeddingDeployment, text, vec); err != nil {
				seedLog.Printf("  Warning: cache write failed for rule %s: %v", rule.RuleID, err)
				continue
			}
			seeded++
		}

		seedLog.Printf("  Done: %s", doc.Label)
	}

	seedLog.Printf("Embedding seed complete: %d new, %d already cached", seeded, skipped)
}

func ensureEnvFile(bootLog *log.Logger) error {
	if _, err := os.Stat(".env"); err == nil {
		bootLog.Printf(".env file found")
		return nil
	}

	if _, err := os.Stat(".env.example"); err == nil {
		bootLog.Printf(".env not found — copying from .env.example")
		src, err := os.ReadFile(".env.example")
		if err != nil {
			return fmt.Errorf("read .env.example: %w", err)
		}
		if err := os.WriteFile(".env", src, 0o600); err != nil {
			return fmt.Errorf("write .env: %w", err)
		}
		bootLog.Printf("Created .env from .env.example — edit it with your credentials")
		return nil
	}

	bootLog.Printf(".env not found and no .env.example — will use environment variables")
	return nil
}

func validateEnv(bootLog *log.Logger) error {
	required := map[string]string{
		"AZURE_OPENAI_ENDPOINT":   "Azure OpenAI endpoint URL",
		"AZURE_OPENAI_API_KEY":    "Azure OpenAI API key",
		"AZURE_OPENAI_DEPLOYMENT": "Azure OpenAI chat deployment name",
	}

	if !parseBool(os.Getenv("AZURE_OPENAI_ENABLED")) {
		bootLog.Printf("AZURE_OPENAI_ENABLED is not true — AI features will be disabled")
		bootLog.Printf("Set AZURE_OPENAI_ENABLED=true in .env and re-run bootstrap to enable")
		return nil
	}

	missing := make([]string, 0)
	for key, desc := range required {
		if strings.TrimSpace(os.Getenv(key)) == "" {
			missing = append(missing, fmt.Sprintf("  %s (%s)", key, desc))
		}
	}

	if len(missing) > 0 {
		return fmt.Errorf("missing required environment variables:\n%s\nedit .env and re-run bootstrap", strings.Join(missing, "\n"))
	}

	bootLog.Printf("Environment validated")
	return nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func parseBool(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes", "y", "on":
		return true
	default:
		return false
	}
}
