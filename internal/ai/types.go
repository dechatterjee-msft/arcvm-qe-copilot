package ai

import (
	"database/sql"
	"time"

	"arcvm-qe-copilot/internal/spec"
)

type TestPlanRequest struct {
	Baseline        spec.RunRequest   `json:"baseline"`
	CaseCount       int               `json:"caseCount,omitempty"`
	Strategy        string            `json:"strategy,omitempty"`
	EnsembleEnabled *bool             `json:"ensembleEnabled,omitempty"`
	ContextChunks   []DocContextChunk `json:"contextChunks,omitempty"`
	DocSource       *DocSource        `json:"docSource,omitempty"`
	Layers          KnowledgeLayers   `json:"layers,omitempty"`
	Retrieval       RetrievalOptions  `json:"retrieval,omitempty"`
	FileContext     []FileContextItem `json:"fileContext,omitempty"`
}

type FileContextItem struct {
	FileName string `json:"fileName"`
	Content  string `json:"content"`
}

type DocSource struct {
	Type      string               `json:"type,omitempty"`
	LocalPath string               `json:"localPath,omitempty"`
	ADO       *ADORepositorySource `json:"ado,omitempty"`
	AzureDocs *AzureDocsSource     `json:"azureDocs,omitempty"`
}

type KnowledgeLayers struct {
	AzureDocs          []AzureDocsSource `json:"azureDocs,omitempty"`
	ReadmeArchitecture *DocSource        `json:"readmeArchitecture,omitempty"`
}

type AzureDocsSource struct {
	URL         string `json:"url"`
	LastUpdated string `json:"lastUpdated,omitempty"`
}

type ADORepositorySource struct {
	OrganizationURL string `json:"organizationUrl"`
	Project         string `json:"project"`
	Repository      string `json:"repository"`
	FilePath        string `json:"filePath"`
	Branch          string `json:"branch,omitempty"`
	PAT             string `json:"pat,omitempty"`
}

type RetrievalOptions struct {
	Query         string `json:"query,omitempty"`
	TopK          int    `json:"topK,omitempty"`
	UseEmbeddings bool   `json:"useEmbeddings,omitempty"`
	Lexical       string `json:"lexical,omitempty"`
}

type DocContextChunk struct {
	ChunkID     string `json:"chunkId"`
	SourceURL   string `json:"sourceUrl,omitempty"`
	Section     string `json:"section,omitempty"`
	Content     string `json:"content"`
	LastUpdated string `json:"lastUpdated,omitempty"`
}

type PlannedTestCase struct {
	CaseID          string          `json:"caseId"`
	Objective       string          `json:"objective"`
	Mutation        string          `json:"mutation"`
	ExpectedOutcome string          `json:"expectedOutcome"`
	Citations       []string        `json:"citations,omitempty"`
	RunRequest      spec.RunRequest `json:"runRequest"`
}

type TestPlanResponse struct {
	GeneratedAt    time.Time         `json:"generatedAt"`
	Model          string            `json:"model"`
	Ensemble       *PlanEnsembleInfo `json:"ensemble,omitempty"`
	Ruleset        *RulesetMetadata  `json:"ruleset,omitempty"`
	RetrievedRules []RuleEntry       `json:"retrievedRules,omitempty"`
	Cases          []PlannedTestCase `json:"cases"`
}

type PlanEnsembleInfo struct {
	Enabled       bool                    `json:"enabled"`
	SelectedTier  string                  `json:"selectedTier,omitempty"`
	SelectedModel string                  `json:"selectedModel,omitempty"`
	Reason        string                  `json:"reason,omitempty"`
	Candidates    []PlanEnsembleCandidate `json:"candidates,omitempty"`
}

type PlanEnsembleCandidate struct {
	Tier      string               `json:"tier"`
	Model     string               `json:"model"`
	Score     float64              `json:"score"`
	LatencyMs int64                `json:"latencyMs,omitempty"`
	CaseCount int                  `json:"caseCount,omitempty"`
	Error     string               `json:"error,omitempty"`
	Breakdown []ScoreBreakdownItem `json:"breakdown,omitempty"`
}

type ScoreBreakdownItem struct {
	Name  string  `json:"name"`
	Value float64 `json:"value"`
}

type RulesetMetadata struct {
	RulesetID   string    `json:"rulesetId"`
	VersionHash string    `json:"versionHash"`
	SourceType  string    `json:"sourceType"`
	SourceRef   string    `json:"sourceRef"`
	GeneratedAt time.Time `json:"generatedAt"`
	TotalRules  int       `json:"totalRules"`
}

type RuleEntry struct {
	RuleID    string  `json:"ruleId"`
	Layer     string  `json:"layer,omitempty"`
	Category  string  `json:"category"`
	Section   string  `json:"section"`
	Content   string  `json:"content"`
	SourceURL string  `json:"sourceUrl,omitempty"`
	Score     float64 `json:"score,omitempty"`
}

type RulesetPreviewRequest struct {
	DocSource *DocSource       `json:"docSource"`
	Layers    KnowledgeLayers  `json:"layers,omitempty"`
	Retrieval RetrievalOptions `json:"retrieval,omitempty"`
}

type RulesetPreviewResponse struct {
	Ruleset        RulesetMetadata `json:"ruleset"`
	RetrievedRules []RuleEntry     `json:"retrievedRules"`
}

type Service interface {
	GenerateTestPlan(req TestPlanRequest) (*TestPlanResponse, error)
	PreviewRuleset(req RulesetPreviewRequest) (*RulesetPreviewResponse, error)
	EmbeddingDB() *sql.DB
}
