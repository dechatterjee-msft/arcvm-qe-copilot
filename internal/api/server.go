package api

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"arcvm-qe-copilot/internal/ai"
	"arcvm-qe-copilot/internal/jobs"
	"arcvm-qe-copilot/internal/logging"
	"arcvm-qe-copilot/internal/spec"
	"arcvm-qe-copilot/internal/store"
)

type jobStarter interface {
	StartProvision(request *spec.RunRequest) (*jobs.Job, error)
	StartLongevity(request *spec.RunRequest) (*jobs.Job, error)
	ListJobs() []*jobs.Job
	GetJob(id string) (*jobs.Job, bool)
}

type planner interface {
	GenerateTestPlan(req ai.TestPlanRequest) (*ai.TestPlanResponse, error)
	PreviewRuleset(req ai.RulesetPreviewRequest) (*ai.RulesetPreviewResponse, error)
}

func NewServer(manager jobStarter, planner planner, plans store.PlanStore, logger *log.Logger) http.Handler {
	mux := http.NewServeMux()
	registerUIRoutes(mux)

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	mux.HandleFunc("POST /api/v1/provision-jobs", func(w http.ResponseWriter, r *http.Request) {
		request, err := decodeRequest(r)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}

		job, err := manager.StartProvision(request)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}

		writeJSON(w, http.StatusAccepted, job)
	})

	mux.HandleFunc("POST /api/v1/longevity-jobs", func(w http.ResponseWriter, r *http.Request) {
		request, err := decodeRequest(r)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}

		job, err := manager.StartLongevity(request)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}

		writeJSON(w, http.StatusAccepted, job)
	})

	mux.HandleFunc("POST /api/v1/ai/test-plan", func(w http.ResponseWriter, r *http.Request) {
		if planner == nil {
			writeError(w, http.StatusServiceUnavailable, errors.New("ai planner is not configured"))
			return
		}

		request, err := decodeTestPlanRequest(r)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}

		plan, err := planner.GenerateTestPlan(request)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}

		writeJSON(w, http.StatusOK, plan)
	})

	mux.HandleFunc("POST /api/v1/ai/rulesets/preview", func(w http.ResponseWriter, r *http.Request) {
		if planner == nil {
			writeError(w, http.StatusServiceUnavailable, errors.New("ai planner is not configured"))
			return
		}

		request, err := decodeRulesetPreviewRequest(r)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}

		preview, err := planner.PreviewRuleset(request)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}

		writeJSON(w, http.StatusOK, preview)
	})

	mux.HandleFunc("GET /api/v1/jobs", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, manager.ListJobs())
	})

	mux.HandleFunc("GET /api/v1/jobs/", func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimPrefix(r.URL.Path, "/api/v1/jobs/")
		if id == "" || strings.Contains(id, "/") {
			http.NotFound(w, r)
			return
		}

		job, ok := manager.GetJob(id)
		if !ok {
			http.NotFound(w, r)
			return
		}

		writeJSON(w, http.StatusOK, job)
	})

	// --- Saved plans CRUD ---
	mux.HandleFunc("POST /api/v1/plans", func(w http.ResponseWriter, r *http.Request) {
		if plans == nil {
			writeError(w, http.StatusServiceUnavailable, errors.New("plan storage is not configured"))
			return
		}
		var body struct {
			Name     string          `json:"name"`
			Strategy string          `json:"strategy"`
			Model    string          `json:"model"`
			Cases    json.RawMessage `json:"cases"`
		}
		if err := decodeJSONBody(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		plan := store.SavedPlan{
			Name:      body.Name,
			Strategy:  body.Strategy,
			Model:     body.Model,
			CaseCount: countJSONArray(body.Cases),
		}
		saved, err := plans.Save(r.Context(), plan, body.Cases)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		writeJSON(w, http.StatusCreated, saved)
	})

	mux.HandleFunc("GET /api/v1/plans", func(w http.ResponseWriter, r *http.Request) {
		if plans == nil {
			writeJSON(w, http.StatusOK, []any{})
			return
		}
		list, err := plans.List(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		if list == nil {
			list = []store.SavedPlan{}
		}
		writeJSON(w, http.StatusOK, list)
	})

	mux.HandleFunc("GET /api/v1/plans/", func(w http.ResponseWriter, r *http.Request) {
		if plans == nil {
			http.NotFound(w, r)
			return
		}
		id := strings.TrimPrefix(r.URL.Path, "/api/v1/plans/")
		if id == "" || strings.Contains(id, "/") {
			http.NotFound(w, r)
			return
		}
		plan, casesJSON, err := plans.Get(r.Context(), id)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		if plan == nil {
			http.NotFound(w, r)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"id":        plan.ID,
			"name":      plan.Name,
			"strategy":  plan.Strategy,
			"model":     plan.Model,
			"caseCount": plan.CaseCount,
			"createdAt": plan.CreatedAt,
			"cases":     json.RawMessage(casesJSON),
		})
	})

	mux.HandleFunc("DELETE /api/v1/plans/", func(w http.ResponseWriter, r *http.Request) {
		if plans == nil {
			http.NotFound(w, r)
			return
		}
		id := strings.TrimPrefix(r.URL.Path, "/api/v1/plans/")
		if id == "" || strings.Contains(id, "/") {
			http.NotFound(w, r)
			return
		}
		if err := plans.Delete(r.Context(), id); err != nil {
			writeError(w, http.StatusNotFound, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"deleted": id})
	})

	if logger != nil {
		return requestLogger(logger, mux)
	}

	return mux
}

func decodeRequest(r *http.Request) (*spec.RunRequest, error) {
	var request spec.RunRequest
	if err := decodeJSONBody(r, &request); err != nil {
		return nil, err
	}

	return &request, nil
}

func decodeTestPlanRequest(r *http.Request) (ai.TestPlanRequest, error) {
	var request ai.TestPlanRequest
	if err := decodeJSONBody(r, &request); err != nil {
		return ai.TestPlanRequest{}, err
	}
	return request, nil
}

func decodeRulesetPreviewRequest(r *http.Request) (ai.RulesetPreviewRequest, error) {
	var request ai.RulesetPreviewRequest
	if err := decodeJSONBody(r, &request); err != nil {
		return ai.RulesetPreviewRequest{}, err
	}
	return request, nil
}

func decodeJSONBody(r *http.Request, target any) error {
	defer r.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		return errors.New("failed to read request body")
	}

	if err := json.Unmarshal(raw, target); err != nil {
		return errors.New("request body must be valid JSON")
	}

	return nil
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func countJSONArray(raw json.RawMessage) int {
	var arr []json.RawMessage
	if json.Unmarshal(raw, &arr) == nil {
		return len(arr)
	}
	return 0
}

func writeError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

func requestLogger(logger *log.Logger, next http.Handler) http.Handler {
	httpLog := logging.Tagged(logger, "Server")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(sw, r)
		httpLog.Printf("%d | %12s | %s %s", sw.status, time.Since(start), r.Method, r.URL.Path)
	})
}

// statusWriter wraps http.ResponseWriter to capture the status code.
type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Write(b []byte) (int, error) {
	return w.ResponseWriter.Write(b)
}

// Unwrap returns the underlying ResponseWriter (required for http.Flusher etc.).
func (w *statusWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}
