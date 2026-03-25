package ai

import (
	"context"
	"path/filepath"
	"testing"
)

func TestEmbeddingStoreRoundTrip(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "embeddings.db")
	store, err := NewEmbeddingStore(dbPath)
	if err != nil {
		t.Fatalf("NewEmbeddingStore failed: %v", err)
	}
	defer store.Close()

	ctx := context.Background()
	deployment := "text-embedding-3-large"
	text := "static logical network immutability rule"
	vector := []float64{0.1, 0.2, 0.3}

	if err := store.Put(ctx, deployment, text, vector); err != nil {
		t.Fatalf("Put failed: %v", err)
	}

	got, ok, err := store.Get(ctx, deployment, text)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if !ok {
		t.Fatalf("expected cached embedding entry")
	}
	if len(got) != len(vector) {
		t.Fatalf("expected vector length %d, got %d", len(vector), len(got))
	}
	for i := range got {
		if got[i] != vector[i] {
			t.Fatalf("vector mismatch at %d: expected %v got %v", i, vector[i], got[i])
		}
	}
}
