package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"strings"
	"time"
)

// SQLitePlanStore implements PlanStore using a SQLite database.
type SQLitePlanStore struct {
	db *sql.DB
}

// NewSQLitePlanStore creates a PlanStore backed by the given sql.DB.
func NewSQLitePlanStore(db *sql.DB) (*SQLitePlanStore, error) {
	if db == nil {
		return nil, fmt.Errorf("db is nil")
	}
	s := &SQLitePlanStore{db: db}
	if err := s.initSchema(context.Background()); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *SQLitePlanStore) Save(ctx context.Context, plan SavedPlan, casesJSON []byte) (*SavedPlan, error) {
	if strings.TrimSpace(plan.Name) == "" {
		return nil, fmt.Errorf("plan name is required")
	}
	if len(casesJSON) == 0 {
		return nil, fmt.Errorf("plan must have at least one case")
	}

	plan.ID = generatePlanID()
	plan.CreatedAt = time.Now().UTC()

	const stmt = `
INSERT INTO saved_plans(id, name, strategy, model, case_count, cases_json, created_at)
VALUES(?, ?, ?, ?, ?, ?, ?)`

	_, err := s.db.ExecContext(ctx, stmt,
		plan.ID,
		strings.TrimSpace(plan.Name),
		strings.TrimSpace(plan.Strategy),
		strings.TrimSpace(plan.Model),
		plan.CaseCount,
		string(casesJSON),
		plan.CreatedAt.Format(time.RFC3339Nano),
	)
	if err != nil {
		return nil, fmt.Errorf("insert saved plan: %w", err)
	}
	return &plan, nil
}

func (s *SQLitePlanStore) List(ctx context.Context) ([]SavedPlan, error) {
	const q = `SELECT id, name, strategy, model, case_count, created_at FROM saved_plans ORDER BY created_at DESC`

	rows, err := s.db.QueryContext(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("list saved plans: %w", err)
	}
	defer rows.Close()

	var plans []SavedPlan
	for rows.Next() {
		var p SavedPlan
		var ts string
		if err := rows.Scan(&p.ID, &p.Name, &p.Strategy, &p.Model, &p.CaseCount, &ts); err != nil {
			return nil, fmt.Errorf("scan saved plan: %w", err)
		}
		p.CreatedAt, _ = time.Parse(time.RFC3339Nano, ts)
		plans = append(plans, p)
	}
	return plans, rows.Err()
}

func (s *SQLitePlanStore) Get(ctx context.Context, id string) (*SavedPlan, []byte, error) {
	const q = `SELECT id, name, strategy, model, case_count, cases_json, created_at FROM saved_plans WHERE id = ?`

	var p SavedPlan
	var casesRaw, ts string
	err := s.db.QueryRowContext(ctx, q, id).Scan(&p.ID, &p.Name, &p.Strategy, &p.Model, &p.CaseCount, &casesRaw, &ts)
	if err == sql.ErrNoRows {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, fmt.Errorf("get saved plan: %w", err)
	}
	p.CreatedAt, _ = time.Parse(time.RFC3339Nano, ts)
	return &p, []byte(casesRaw), nil
}

func (s *SQLitePlanStore) Delete(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM saved_plans WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete saved plan: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("plan not found")
	}
	return nil
}

func (s *SQLitePlanStore) Close() error {
	return nil // db lifecycle owned by caller
}

func (s *SQLitePlanStore) initSchema(ctx context.Context) error {
	const ddl = `
CREATE TABLE IF NOT EXISTS saved_plans (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	strategy TEXT NOT NULL DEFAULT '',
	model TEXT NOT NULL DEFAULT '',
	case_count INTEGER NOT NULL DEFAULT 0,
	cases_json TEXT NOT NULL,
	created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_saved_plans_created ON saved_plans(created_at DESC);`
	if _, err := s.db.ExecContext(ctx, ddl); err != nil {
		return fmt.Errorf("initialize saved_plans schema: %w", err)
	}
	return nil
}

func generatePlanID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return "plan-" + hex.EncodeToString(b)
}
