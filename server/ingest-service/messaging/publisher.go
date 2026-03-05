package messaging

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/nats-io/nats.go"
)

var nc *nats.Conn

type SegmentUploadedEvent struct {
	AgentID   string    `json:"agent_id"`
	StartTime time.Time `json:"start_time"`
	EndTime   time.Time `json:"end_time"`
	FilePath  string    `json:"file_path"`
	FileSize  int64     `json:"file_size"`
}

type AgentRegisteredEvent struct {
	AgentID  string `json:"agent_id"`
	Hostname string `json:"hostname"`
	IP       string `json:"ip"`
}

func Connect() error {
	url := os.Getenv("NATS_URL")
	if url == "" {
		url = nats.DefaultURL
	}

	var err error
	nc, err = nats.Connect(url,
		nats.MaxReconnects(-1),
		nats.ReconnectWait(2*time.Second),
		nats.DisconnectErrHandler(func(_ *nats.Conn, err error) {
			log.Printf("[ingest/nats] disconnected: %v", err)
		}),
		nats.ReconnectHandler(func(_ *nats.Conn) {
			log.Printf("[ingest/nats] reconnected")
		}),
	)
	if err != nil {
		return fmt.Errorf("connect to NATS at %s: %w", url, err)
	}

	log.Printf("[ingest/nats] connected to %s", url)
	return nil
}

func Publish(subject string, payload interface{}) error {
	if nc == nil {
		return fmt.Errorf("NATS not connected")
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}

	return nc.Publish(subject, data)
}

func Close() {
	if nc != nil {
		nc.Drain()
	}
}
