package main

import (
	"context"
	"log"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"recording-system/metadata-service/db"
	"recording-system/metadata-service/handlers"
	"recording-system/metadata-service/messaging"
)

func main() {
	ctx := context.Background()

	pool, err := db.Connect(ctx)
	if err != nil {
		log.Fatalf("[metadata] %v", err)
	}
	defer pool.Close()

	if err := messaging.Subscribe(pool); err != nil {
		log.Fatalf("[metadata] %v", err)
	}
	defer messaging.Close()

	h := handlers.New(pool)

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	r.Get("/api/agents", h.ListAgents)
	r.Get("/api/sessions", h.ListSessions)
	r.Get("/api/segments", h.ListSegments)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8002"
	}

	log.Printf("[metadata] listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}
