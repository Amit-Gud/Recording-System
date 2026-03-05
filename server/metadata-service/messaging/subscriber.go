package messaging

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nats-io/nats.go"

	"recording-system/metadata-service/db"
)

// Event types mirror the structs published by ingest-service.
type segmentUploadedEvent struct {
	AgentID   string    `json:"agent_id"`
	StartTime time.Time `json:"start_time"`
	EndTime   time.Time `json:"end_time"`
	FilePath  string    `json:"file_path"`
	FileSize  int64     `json:"file_size"`
}

type agentRegisteredEvent struct {
	AgentID  string `json:"agent_id"`
	Hostname string `json:"hostname"`
	IP       string `json:"ip"`
}

var nc *nats.Conn

func Subscribe(pool *pgxpool.Pool) error {
	url := os.Getenv("NATS_URL")
	if url == "" {
		url = nats.DefaultURL
	}

	var err error
	nc, err = nats.Connect(url,
		nats.MaxReconnects(-1),
		nats.ReconnectWait(2*time.Second),
		nats.DisconnectErrHandler(func(_ *nats.Conn, err error) {
			log.Printf("[metadata/nats] disconnected: %v", err)
		}),
		nats.ReconnectHandler(func(_ *nats.Conn) {
			log.Printf("[metadata/nats] reconnected")
		}),
	)
	if err != nil {
		return fmt.Errorf("connect to NATS at %s: %w", url, err)
	}

	if _, err = nc.Subscribe("segments.uploaded", onSegmentUploaded(pool)); err != nil {
		return fmt.Errorf("subscribe segments.uploaded: %w", err)
	}

	if _, err = nc.Subscribe("agents.registered", onAgentRegistered(pool)); err != nil {
		return fmt.Errorf("subscribe agents.registered: %w", err)
	}

	log.Printf("[metadata/nats] subscribed to segments.uploaded, agents.registered")
	return nil
}

func onSegmentUploaded(pool *pgxpool.Pool) nats.MsgHandler {
	return func(msg *nats.Msg) {
		var evt segmentUploadedEvent
		if err := json.Unmarshal(msg.Data, &evt); err != nil {
			log.Printf("[metadata/nats] bad segments.uploaded payload: %v", err)
			return
		}

		ctx := context.Background()

		if err := db.InsertSegment(ctx, pool, evt.AgentID, evt.StartTime, evt.EndTime, evt.FilePath, evt.FileSize); err != nil {
			log.Printf("[metadata/nats] insert segment for %s: %v", evt.AgentID, err)
			return
		}

		// Keep last_seen fresh whenever a segment arrives
		if err := db.UpdateLastSeen(ctx, pool, evt.AgentID); err != nil {
			log.Printf("[metadata/nats] update last_seen for %s: %v", evt.AgentID, err)
		}

		log.Printf("[metadata/nats] indexed segment %s %s", evt.AgentID, evt.StartTime.Format(time.RFC3339))
	}
}

func onAgentRegistered(pool *pgxpool.Pool) nats.MsgHandler {
	return func(msg *nats.Msg) {
		var evt agentRegisteredEvent
		if err := json.Unmarshal(msg.Data, &evt); err != nil {
			log.Printf("[metadata/nats] bad agents.registered payload: %v", err)
			return
		}

		if err := db.UpsertAgent(context.Background(), pool, evt.AgentID, evt.Hostname, evt.IP); err != nil {
			log.Printf("[metadata/nats] upsert agent %s: %v", evt.AgentID, err)
			return
		}

		log.Printf("[metadata/nats] upserted agent %s (%s / %s)", evt.AgentID, evt.Hostname, evt.IP)
	}
}

func Close() {
	if nc != nil {
		nc.Drain()
	}
}
