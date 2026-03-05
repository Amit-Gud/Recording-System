package main

import (
	"log"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"recording-system/ingest-service/handlers"
	"recording-system/ingest-service/messaging"
)

func main() {
	if err := messaging.Connect(); err != nil {
		log.Fatalf("[ingest] failed to connect to NATS: %v", err)
	}
	defer messaging.Close()

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	r.Post("/ingest/segment", handlers.HandleSegment)
	r.Post("/ingest/register", handlers.HandleRegister)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8001"
	}

	log.Printf("[ingest] listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}
