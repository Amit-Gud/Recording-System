package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

var recordingsPath string

func main() {
	recordingsPath = os.Getenv("RECORDINGS_PATH")
	if recordingsPath == "" {
		recordingsPath = "/recordings"
	}

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	// GET /hls/{agent_id}/{date}/playlist.m3u8
	// GET /hls/{agent_id}/{date}/{segment}.ts
	r.Get("/hls/{agentID}/{date}/{filename}", serveHLS)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8003"
	}

	log.Printf("[replay] listening on :%s  recordings: %s", port, recordingsPath)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

func serveHLS(w http.ResponseWriter, r *http.Request) {
	agentID := chi.URLParam(r, "agentID")
	date := chi.URLParam(r, "date")
	filename := chi.URLParam(r, "filename")

	// Prevent path traversal
	if strings.Contains(agentID, "..") || strings.Contains(date, "..") || strings.Contains(filename, "..") {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}

	fullPath := filepath.Join(recordingsPath, agentID, date, filename)

	switch {
	case strings.HasSuffix(filename, ".m3u8"):
		w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
	case strings.HasSuffix(filename, ".ts"):
		w.Header().Set("Content-Type", "video/mp2t")
	default:
		http.Error(w, "unsupported file type", http.StatusBadRequest)
		return
	}

	// Allow React client to fetch HLS from a different origin
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Cache-Control", "no-cache")

	http.ServeFile(w, r, fullPath)
}
