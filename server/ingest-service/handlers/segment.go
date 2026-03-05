package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"recording-system/ingest-service/messaging"
	"recording-system/ingest-service/storage"
)

// HandleSegment accepts a multipart POST with:
//
//	agent_id   string      — unique identifier of the agent
//	start_time RFC3339     — segment start timestamp (UTC)
//	end_time   RFC3339     — segment end timestamp (UTC)
//	segment    file (.ts)  — H.264 MPEG-TS video chunk
func HandleSegment(w http.ResponseWriter, r *http.Request) {
	// 10 MB memory buffer; larger parts spill to temp files
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		http.Error(w, "failed to parse multipart form", http.StatusBadRequest)
		return
	}

	agentID := r.FormValue("agent_id")
	if agentID == "" {
		http.Error(w, "agent_id is required", http.StatusBadRequest)
		return
	}

	startTime, err := time.Parse(time.RFC3339, r.FormValue("start_time"))
	if err != nil {
		http.Error(w, "invalid start_time — use RFC3339 format", http.StatusBadRequest)
		return
	}

	endTime, err := time.Parse(time.RFC3339, r.FormValue("end_time"))
	if err != nil {
		http.Error(w, "invalid end_time — use RFC3339 format", http.StatusBadRequest)
		return
	}

	file, _, err := r.FormFile("segment")
	if err != nil {
		http.Error(w, "segment file is required", http.StatusBadRequest)
		return
	}
	defer file.Close()

	filePath, fileSize, err := storage.WriteSegment(agentID, startTime, file)
	if err != nil {
		log.Printf("[ingest] failed to store segment for %s: %v", agentID, err)
		http.Error(w, "failed to store segment", http.StatusInternalServerError)
		return
	}

	event := messaging.SegmentUploadedEvent{
		AgentID:   agentID,
		StartTime: startTime,
		EndTime:   endTime,
		FilePath:  filePath,
		FileSize:  fileSize,
	}

	if err := messaging.Publish("segments.uploaded", event); err != nil {
		// Segment is already safe on disk — log and continue
		log.Printf("[ingest] WARNING: failed to publish segments.uploaded for %s: %v", agentID, err)
	}

	log.Printf("[ingest] stored segment for %s: %s (%d bytes)", agentID, filePath, fileSize)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]any{
		"status":    "ok",
		"file_path": filePath,
		"file_size": fileSize,
	})
}
