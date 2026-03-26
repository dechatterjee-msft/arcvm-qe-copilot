package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"arcvm-qe-copilot/internal/ai"
	"arcvm-qe-copilot/internal/azure"
	"arcvm-qe-copilot/internal/jobs"
	"arcvm-qe-copilot/internal/logging"
	"arcvm-qe-copilot/internal/logs"
	"arcvm-qe-copilot/internal/spec"
	"arcvm-qe-copilot/internal/store"
)

type jobStarter interface {
	StartProvision(request *spec.RunRequest) (*jobs.Job, error)
	StartLongevity(request *spec.RunRequest) (*jobs.Job, error)
	ListJobs() []*jobs.Job
	GetJob(id string) (*jobs.Job, bool)
	CancelJob(id string) bool
}

type planner interface {
	GenerateTestPlan(req ai.TestPlanRequest) (*ai.TestPlanResponse, error)
	PreviewRuleset(req ai.RulesetPreviewRequest) (*ai.RulesetPreviewResponse, error)
}

type chatter interface {
	Chat(ctx context.Context, messages []ai.ChatMessage) (string, error)
}

type discoverer interface {
	ListSubscriptions(ctx context.Context) ([]azure.Subscription, error)
	ListResourceGroups(ctx context.Context, subscriptionID string) ([]azure.ResourceGroup, error)
	ListCustomLocations(ctx context.Context, subscriptionID, resourceGroup string) ([]azure.CustomLocation, error)
}

func NewServer(manager jobStarter, planner planner, plans store.PlanStore, disc discoverer, logSvc *logs.Service, logger *log.Logger) http.Handler {
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

	mux.HandleFunc("POST /api/v1/jobs/{id}/cancel", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if id == "" {
			http.NotFound(w, r)
			return
		}

		if !manager.CancelJob(id) {
			writeError(w, http.StatusNotFound, errors.New("job not found or already finished"))
			return
		}

		writeJSON(w, http.StatusOK, map[string]string{"status": "cancelling", "id": id})
	})

	// --- Azure discovery ---
	mux.HandleFunc("GET /api/v1/azure/subscriptions", func(w http.ResponseWriter, r *http.Request) {
		if disc == nil {
			writeError(w, http.StatusServiceUnavailable, errors.New("azure discovery is not configured"))
			return
		}
		subs, err := disc.ListSubscriptions(r.Context())
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		writeJSON(w, http.StatusOK, subs)
	})

	mux.HandleFunc("GET /api/v1/azure/resource-groups", func(w http.ResponseWriter, r *http.Request) {
		if disc == nil {
			writeError(w, http.StatusServiceUnavailable, errors.New("azure discovery is not configured"))
			return
		}
		subID := r.URL.Query().Get("subscriptionId")
		if subID == "" {
			writeError(w, http.StatusBadRequest, errors.New("subscriptionId query parameter is required"))
			return
		}
		groups, err := disc.ListResourceGroups(r.Context(), subID)
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		writeJSON(w, http.StatusOK, groups)
	})

	mux.HandleFunc("GET /api/v1/azure/custom-locations", func(w http.ResponseWriter, r *http.Request) {
		if disc == nil {
			writeError(w, http.StatusServiceUnavailable, errors.New("azure discovery is not configured"))
			return
		}
		subID := r.URL.Query().Get("subscriptionId")
		rg := r.URL.Query().Get("resourceGroup")
		if subID == "" || rg == "" {
			writeError(w, http.StatusBadRequest, errors.New("subscriptionId and resourceGroup query parameters are required"))
			return
		}
		cls, err := disc.ListCustomLocations(r.Context(), subID, rg)
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		writeJSON(w, http.StatusOK, cls)
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

	// --- AI Chat ---
	mux.HandleFunc("POST /api/v1/ai/chat", func(w http.ResponseWriter, r *http.Request) {
		chatSvc, ok := planner.(chatter)
		if !ok || planner == nil {
			writeError(w, http.StatusServiceUnavailable, errors.New("ai chat is not configured"))
			return
		}

		var body struct {
			Messages []ai.ChatMessage `json:"messages"`
		}
		if err := decodeJSONBody(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if len(body.Messages) == 0 {
			writeError(w, http.StatusBadRequest, errors.New("messages array must not be empty"))
			return
		}

		reply, err := chatSvc.Chat(r.Context(), body.Messages)
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"reply": reply})
	})

	// --- Operator Log Analysis ---
	mux.HandleFunc("GET /api/v1/jobs/{id}/logs", func(w http.ResponseWriter, r *http.Request) {
		if logSvc == nil {
			writeError(w, http.StatusServiceUnavailable, errors.New("log analysis is not configured"))
			return
		}
		id := r.PathValue("id")
		if id == "" {
			http.NotFound(w, r)
			return
		}
		summary, err := logSvc.GetJobLogSummary(id)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, summary)
	})

	mux.HandleFunc("GET /api/v1/jobs/{id}/logs/{operator}", func(w http.ResponseWriter, r *http.Request) {
		if logSvc == nil {
			writeError(w, http.StatusServiceUnavailable, errors.New("log analysis is not configured"))
			return
		}
		id := r.PathValue("id")
		operator := r.PathValue("operator")
		if id == "" || operator == "" {
			http.NotFound(w, r)
			return
		}

		level := r.URL.Query().Get("level")
		resource := r.URL.Query().Get("resource")
		entries, err := logSvc.GetOperatorLogsFiltered(id, operator, level, resource, 0)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		if entries == nil {
			entries = []logs.LogEntry{}
		}
		writeJSON(w, http.StatusOK, entries)
	})

	mux.HandleFunc("POST /api/v1/jobs/{id}/logs/collect", func(w http.ResponseWriter, r *http.Request) {
		if logSvc == nil {
			writeError(w, http.StatusServiceUnavailable, errors.New("log analysis is not configured"))
			return
		}
		id := r.PathValue("id")
		if id == "" {
			http.NotFound(w, r)
			return
		}
		job, ok := manager.GetJob(id)
		if !ok {
			http.NotFound(w, r)
			return
		}

		resourceTypes := job.Summary.ResourceKinds
		if len(resourceTypes) == 0 {
			resourceTypes = []string{"e2e"}
		}

		var sinceTime, untilTime *time.Time
		if job.StartedAt != nil {
			sinceTime = job.StartedAt
		}
		if job.FinishedAt != nil {
			untilTime = job.FinishedAt
		}

		summary, err := logSvc.CollectForJob(r.Context(), id, resourceTypes, sinceTime, untilTime)
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		writeJSON(w, http.StatusOK, summary)
	})

	// --- Operator Registry ---
	mux.HandleFunc("GET /api/v1/operators", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, logs.AllOperators())
	})

	mux.HandleFunc("GET /api/v1/operators/for-resources", func(w http.ResponseWriter, r *http.Request) {
		types := strings.Split(r.URL.Query().Get("types"), ",")
		ops := logs.OperatorsForResources(types)
		if ops == nil {
			ops = []string{}
		}
		writeJSON(w, http.StatusOK, ops)
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
