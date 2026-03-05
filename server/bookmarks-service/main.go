package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Bookmark struct {
	ID        int       `json:"id"`
	AgentID   string    `json:"agent_id"`
	Timestamp time.Time `json:"timestamp"`
	Label     string    `json:"label"`
	CreatedAt time.Time `json:"created_at"`
}

var pool *pgxpool.Pool

func main() {
	ctx := context.Background()

	var err error
	pool, err = connectDB(ctx)
	if err != nil {
		log.Fatalf("[bookmarks] %v", err)
	}
	defer pool.Close()

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	r.Post("/api/bookmarks", createBookmark)
	r.Get("/api/bookmarks", listBookmarks)
	r.Delete("/api/bookmarks/{id}", deleteBookmark)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8004"
	}

	log.Printf("[bookmarks] listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

// POST /api/bookmarks
// Body: { "agent_id": "...", "timestamp": "RFC3339", "label": "..." }
func createBookmark(w http.ResponseWriter, r *http.Request) {
	var req struct {
		AgentID   string    `json:"agent_id"`
		Timestamp time.Time `json:"timestamp"`
		Label     string    `json:"label"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}
	if req.AgentID == "" || req.Label == "" {
		http.Error(w, "agent_id and label are required", http.StatusBadRequest)
		return
	}

	var bm Bookmark
	err := pool.QueryRow(r.Context(), `
		INSERT INTO bookmarks.bookmarks (agent_id, timestamp, label)
		VALUES ($1, $2, $3)
		RETURNING id, agent_id, timestamp, label, created_at
	`, req.AgentID, req.Timestamp, req.Label).Scan(&bm.ID, &bm.AgentID, &bm.Timestamp, &bm.Label, &bm.CreatedAt)
	if err != nil {
		log.Printf("[bookmarks] insert: %v", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(bm)
}

// GET /api/bookmarks?agent_id=DESKTOP-04&start=RFC3339&end=RFC3339
// start and end are optional; omitting them returns all bookmarks for the agent.
func listBookmarks(w http.ResponseWriter, r *http.Request) {
	agentID := r.URL.Query().Get("agent_id")
	if agentID == "" {
		http.Error(w, "agent_id is required", http.StatusBadRequest)
		return
	}

	query := `
		SELECT id, agent_id, timestamp, label, created_at
		FROM bookmarks.bookmarks
		WHERE agent_id = $1
	`
	args := []any{agentID}

	if startStr := r.URL.Query().Get("start"); startStr != "" {
		start, err := time.Parse(time.RFC3339, startStr)
		if err != nil {
			http.Error(w, "invalid start — use RFC3339 format", http.StatusBadRequest)
			return
		}
		args = append(args, start)
		query += fmt.Sprintf(" AND timestamp >= $%d", len(args))
	}

	if endStr := r.URL.Query().Get("end"); endStr != "" {
		end, err := time.Parse(time.RFC3339, endStr)
		if err != nil {
			http.Error(w, "invalid end — use RFC3339 format", http.StatusBadRequest)
			return
		}
		args = append(args, end)
		query += fmt.Sprintf(" AND timestamp <= $%d", len(args))
	}

	query += " ORDER BY timestamp"

	rows, err := pool.Query(r.Context(), query, args...)
	if err != nil {
		log.Printf("[bookmarks] query: %v", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	bookmarks := []Bookmark{}
	for rows.Next() {
		var bm Bookmark
		if err := rows.Scan(&bm.ID, &bm.AgentID, &bm.Timestamp, &bm.Label, &bm.CreatedAt); err != nil {
			log.Printf("[bookmarks] scan: %v", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		bookmarks = append(bookmarks, bm)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(bookmarks)
}

// DELETE /api/bookmarks/{id}
func deleteBookmark(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	ct, err := pool.Exec(r.Context(), `DELETE FROM bookmarks.bookmarks WHERE id = $1`, id)
	if err != nil {
		log.Printf("[bookmarks] delete %d: %v", id, err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if ct.RowsAffected() == 0 {
		http.Error(w, "bookmark not found", http.StatusNotFound)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func connectDB(ctx context.Context) (*pgxpool.Pool, error) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		return nil, fmt.Errorf("DATABASE_URL is not set")
	}
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("parse DATABASE_URL: %w", err)
	}
	var p *pgxpool.Pool
	for attempt := 1; attempt <= 10; attempt++ {
		p, err = pgxpool.NewWithConfig(ctx, cfg)
		if err == nil {
			if pingErr := p.Ping(ctx); pingErr == nil {
				log.Printf("[bookmarks/db] connected to postgres")
				return p, nil
			} else {
				p.Close()
				err = pingErr
			}
		}
		log.Printf("[bookmarks/db] waiting for postgres, attempt %d/10: %v", attempt, err)
		time.Sleep(2 * time.Second)
	}
	return nil, fmt.Errorf("connect to postgres after 10 attempts: %w", err)
}
