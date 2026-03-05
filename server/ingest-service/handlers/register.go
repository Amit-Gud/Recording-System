package handlers

import (
	"encoding/json"
	"log"
	"net/http"

	"recording-system/ingest-service/messaging"
)

type registerRequest struct {
	AgentID  string `json:"agent_id"`
	Hostname string `json:"hostname"`
	IP       string `json:"ip"`
}

// HandleRegister accepts a JSON POST from an agent on startup or heartbeat.
// It publishes an agents.registered event consumed by metadata-service.
func HandleRegister(w http.ResponseWriter, r *http.Request) {
	var req registerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	if req.AgentID == "" {
		http.Error(w, "agent_id is required", http.StatusBadRequest)
		return
	}

	event := messaging.AgentRegisteredEvent{
		AgentID:  req.AgentID,
		Hostname: req.Hostname,
		IP:       req.IP,
	}

	if err := messaging.Publish("agents.registered", event); err != nil {
		log.Printf("[ingest] WARNING: failed to publish agents.registered for %s: %v", req.AgentID, err)
	}

	log.Printf("[ingest] registered agent %s (%s / %s)", req.AgentID, req.Hostname, req.IP)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}
