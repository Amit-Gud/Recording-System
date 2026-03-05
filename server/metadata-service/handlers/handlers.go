package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"recording-system/metadata-service/db"
)

type Handler struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Handler {
	return &Handler{pool: pool}
}

// ListAgents godoc
// GET /api/agents
func (h *Handler) ListAgents(w http.ResponseWriter, r *http.Request) {
	agents, err := db.ListAgents(r.Context(), h.pool)
	if err != nil {
		log.Printf("[metadata] list agents: %v", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if agents == nil {
		agents = []db.Agent{}
	}
	writeJSON(w, agents)
}

// ListSessions godoc
// GET /api/sessions?agent_id=DESKTOP-04
// Returns list of dates (YYYY-MM-DD) that have at least one recorded segment.
func (h *Handler) ListSessions(w http.ResponseWriter, r *http.Request) {
	agentID := r.URL.Query().Get("agent_id")
	if agentID == "" {
		http.Error(w, "agent_id is required", http.StatusBadRequest)
		return
	}

	dates, err := db.ListDates(r.Context(), h.pool, agentID)
	if err != nil {
		log.Printf("[metadata] list dates for %s: %v", agentID, err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if dates == nil {
		dates = []string{}
	}
	writeJSON(w, dates)
}

// ListSegments godoc
// GET /api/segments?agent_id=DESKTOP-04&start=2026-03-05T00:00:00Z&end=2026-03-05T23:59:59Z
func (h *Handler) ListSegments(w http.ResponseWriter, r *http.Request) {
	agentID := r.URL.Query().Get("agent_id")
	if agentID == "" {
		http.Error(w, "agent_id is required", http.StatusBadRequest)
		return
	}

	start, err := time.Parse(time.RFC3339, r.URL.Query().Get("start"))
	if err != nil {
		http.Error(w, "invalid start — use RFC3339 format", http.StatusBadRequest)
		return
	}

	end, err := time.Parse(time.RFC3339, r.URL.Query().Get("end"))
	if err != nil {
		http.Error(w, "invalid end — use RFC3339 format", http.StatusBadRequest)
		return
	}

	segments, err := db.ListSegments(r.Context(), h.pool, agentID, start, end)
	if err != nil {
		log.Printf("[metadata] list segments for %s: %v", agentID, err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if segments == nil {
		segments = []db.Segment{}
	}
	writeJSON(w, segments)
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}
