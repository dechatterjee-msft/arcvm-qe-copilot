package store

import (
	"context"
	"time"
)

// SavedPlan is the domain model persisted for a test plan.
type SavedPlan struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Strategy  string    `json:"strategy,omitempty"`
	Model     string    `json:"model,omitempty"`
	CaseCount int       `json:"caseCount"`
	Cases     []byte    `json:"-"`
	CreatedAt time.Time `json:"createdAt"`
}

// PlanStore is the persistence interface for saved plans.
// Implementations can be swapped (SQLite, Postgres, Cosmos, etc.).
type PlanStore interface {
	Save(ctx context.Context, plan SavedPlan, casesJSON []byte) (*SavedPlan, error)
	List(ctx context.Context) ([]SavedPlan, error)
	Get(ctx context.Context, id string) (*SavedPlan, []byte, error)
	Delete(ctx context.Context, id string) error
	Close() error
}