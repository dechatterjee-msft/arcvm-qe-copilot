package main

import (
	"net/http"
	"os"
	"path/filepath"
	"time"

	"arcvm-qe-copilot/internal/ai"
	"arcvm-qe-copilot/internal/api"
	"arcvm-qe-copilot/internal/azure"
	"arcvm-qe-copilot/internal/jobs"
	"arcvm-qe-copilot/internal/logging"
	"arcvm-qe-copilot/internal/store"

	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load()

	logger := logging.New()
	srvLog := logging.Tagged(logger, "Server")

	host := getenv("HOST", "0.0.0.0")
	port := getenv("PORT", "8080")
	azureConfigDir := getenv("AZURE_CONFIG_DIR", filepath.Join(".", ".azure"))
	reportBaseDir := getenv("REPORT_BASE_DIR", filepath.Join(".", "artifacts", "longevity"))

	jobManager := jobs.NewManager(azureConfigDir, reportBaseDir, logger)
	discovery := azure.NewCLI("", logging.Tagged(logger, "Azure CLI"))
	planner, err := ai.NewServiceFromEnv(logger)
	if err != nil {
		srvLog.Printf("AI planner disabled: %v", err)
	}

	var planStore store.PlanStore
	if planner != nil {
		if db := planner.EmbeddingDB(); db != nil {
			ps, err := store.NewSQLitePlanStore(db)
			if err != nil {
				srvLog.Printf("Plan store disabled: %v", err)
			} else {
				planStore = ps
				srvLog.Printf("Plan store enabled (SQLite)")
			}
		}
	}

	server := &http.Server{
		Addr:              host + ":" + port,
		Handler:           api.NewServer(jobManager, planner, planStore, discovery, logger),
		ReadHeaderTimeout: 10 * time.Second,
	}

	srvLog.Printf("Listening on %s", server.Addr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		srvLog.Fatalf("Server failed: %v", err)
	}
}

func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
