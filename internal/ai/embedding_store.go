package ai

import (
	"context"
	"crypto/sha1"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

type EmbeddingStore struct {
	db *sql.DB
}

func NewEmbeddingStore(dbPath string) (*EmbeddingStore, error) {
	cleanPath := strings.TrimSpace(dbPath)
	if cleanPath == "" {
		return nil, fmt.Errorf("embedding db path cannot be empty")
	}

	dir := filepath.Dir(cleanPath)
	if dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("create embedding db directory: %w", err)
		}
	}

	db, err := sql.Open("sqlite", cleanPath)
	if err != nil {
		return nil, fmt.Errorf("open embedding sqlite db: %w", err)
	}

	store := &EmbeddingStore{db: db}
	if err := store.initSchema(context.Background()); err != nil {
		_ = db.Close()
		return nil, err
	}

	return store, nil
}

func (s *EmbeddingStore) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

// DB returns the underlying *sql.DB so other stores can share it.
func (s *EmbeddingStore) DB() *sql.DB {
	if s == nil {
		return nil
	}
	return s.db
}

func (s *EmbeddingStore) Get(ctx context.Context, deployment, text string) ([]float64, bool, error) {
	if s == nil || s.db == nil {
		return nil, false, nil
	}

	key := embeddingKey(deployment, text)
	const q = `SELECT vector_json FROM embeddings WHERE cache_key = ? LIMIT 1`

	var raw string
	err := s.db.QueryRowContext(ctx, q, key).Scan(&raw)
	if err == sql.ErrNoRows {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("query embedding: %w", err)
	}

	var vec []float64
	if err := json.Unmarshal([]byte(raw), &vec); err != nil {
		return nil, false, fmt.Errorf("decode embedding vector: %w", err)
	}
	if len(vec) == 0 {
		return nil, false, nil
	}

	return vec, true, nil
}

func (s *EmbeddingStore) Put(ctx context.Context, deployment, text string, vector []float64) error {
	if s == nil || s.db == nil {
		return nil
	}
	if len(vector) == 0 {
		return nil
	}

	key := embeddingKey(deployment, text)
	hash := textHash(text)
	raw, err := json.Marshal(vector)
	if err != nil {
		return fmt.Errorf("encode embedding vector: %w", err)
	}

	const stmt = `
INSERT INTO embeddings(cache_key, deployment, text_hash, vector_json, updated_at)
VALUES(?, ?, ?, ?, ?)
ON CONFLICT(cache_key) DO UPDATE SET
	vector_json = excluded.vector_json,
	updated_at = excluded.updated_at
`

	_, err = s.db.ExecContext(ctx, stmt, key, strings.TrimSpace(deployment), hash, string(raw), time.Now().UTC().Format(time.RFC3339Nano))
	if err != nil {
		return fmt.Errorf("upsert embedding vector: %w", err)
	}

	return nil
}

func (s *EmbeddingStore) initSchema(ctx context.Context) error {
	const ddl = `
CREATE TABLE IF NOT EXISTS embeddings (
	cache_key TEXT PRIMARY KEY,
	deployment TEXT NOT NULL,
	text_hash TEXT NOT NULL,
	vector_json TEXT NOT NULL,
	updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_embeddings_deployment ON embeddings(deployment);
`

	if _, err := s.db.ExecContext(ctx, ddl); err != nil {
		return fmt.Errorf("initialize embedding schema: %w", err)
	}
	return nil
}

func embeddingKey(deployment, text string) string {
	normalized := strings.TrimSpace(deployment) + "\n" + strings.TrimSpace(text)
	sum := sha1.Sum([]byte(normalized))
	return hex.EncodeToString(sum[:])
}

func textHash(text string) string {
	sum := sha1.Sum([]byte(strings.TrimSpace(text)))
	return hex.EncodeToString(sum[:])
}
