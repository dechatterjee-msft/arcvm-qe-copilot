package ai

import (
	"fmt"
	"os"
	"strings"
)

type Config struct {
	Enabled             bool
	Endpoint            string
	APIKey              string
	APIVersion          string
	Deployment          string
	FastDeployment      string
	DeepDeployment      string
	EnsembleEnabled     bool
	EmbeddingDeployment string
	EmbeddingStorePath  string
	EmbeddingStoreOn    bool
}

func LoadConfigFromEnv() (Config, error) {
	cfg := Config{
		Enabled:             parseBoolEnv("AZURE_OPENAI_ENABLED"),
		Endpoint:            strings.TrimRight(strings.TrimSpace(os.Getenv("AZURE_OPENAI_ENDPOINT")), "/"),
		APIKey:              strings.TrimSpace(strings.Trim(os.Getenv("AZURE_OPENAI_API_KEY"), "\"")),
		APIVersion:          strings.TrimSpace(os.Getenv("AZURE_OPENAI_API_VERSION")),
		Deployment:          strings.TrimSpace(os.Getenv("AZURE_OPENAI_DEPLOYMENT")),
		FastDeployment:      strings.TrimSpace(os.Getenv("AZURE_OPENAI_DEPLOYMENT_FAST")),
		DeepDeployment:      strings.TrimSpace(os.Getenv("AZURE_OPENAI_DEPLOYMENT_DEEP")),
		EnsembleEnabled:     parseBoolDefaultEnv("AZURE_OPENAI_ADVISOR_ENSEMBLE_ENABLED", false),
		EmbeddingDeployment: strings.TrimSpace(os.Getenv("AZURE_OPENAI_EMBEDDING_DEPLOYMENT")),
		EmbeddingStorePath:  strings.TrimSpace(os.Getenv("AZURE_OPENAI_EMBEDDING_DB_PATH")),
		EmbeddingStoreOn:    parseBoolDefaultEnv("AZURE_OPENAI_EMBEDDING_DB_ENABLED", true),
	}

	if cfg.EmbeddingStorePath == "" {
		cfg.EmbeddingStorePath = "data/embeddings.db"
	}
	if cfg.FastDeployment == "" {
		cfg.FastDeployment = cfg.Deployment
	}
	if cfg.DeepDeployment == "" {
		cfg.DeepDeployment = cfg.Deployment
	}

	if !cfg.Enabled {
		return cfg, nil
	}

	if cfg.Endpoint == "" {
		return cfg, fmt.Errorf("AZURE_OPENAI_ENDPOINT is required when AZURE_OPENAI_ENABLED=true")
	}
	if cfg.APIKey == "" {
		return cfg, fmt.Errorf("AZURE_OPENAI_API_KEY is required when AZURE_OPENAI_ENABLED=true")
	}
	if cfg.APIVersion == "" {
		return cfg, fmt.Errorf("AZURE_OPENAI_API_VERSION is required when AZURE_OPENAI_ENABLED=true")
	}
	if cfg.Deployment == "" {
		return cfg, fmt.Errorf("AZURE_OPENAI_DEPLOYMENT is required when AZURE_OPENAI_ENABLED=true")
	}

	return cfg, nil
}

func parseBoolEnv(key string) bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	switch v {
	case "1", "true", "yes", "y", "on":
		return true
	default:
		return false
	}
}

func parseBoolDefaultEnv(key string, defaultValue bool) bool {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return defaultValue
	}
	return parseBoolEnv(key)
}
