package db

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Agent struct {
	ID           int        `json:"id"`
	AgentID      string     `json:"agent_id"`
	Hostname     string     `json:"hostname"`
	IP           string     `json:"ip"`
	LastSeen     *time.Time `json:"last_seen"`
	RegisteredAt time.Time  `json:"registered_at"`
}

// UpsertAgent inserts a new agent or updates hostname, ip, and last_seen on conflict.
func UpsertAgent(ctx context.Context, pool *pgxpool.Pool, agentID, hostname, ip string) error {
	_, err := pool.Exec(ctx, `
		INSERT INTO metadata.agents (agent_id, hostname, ip, last_seen)
		VALUES ($1, $2, $3, NOW())
		ON CONFLICT (agent_id) DO UPDATE
		SET hostname  = EXCLUDED.hostname,
		    ip        = EXCLUDED.ip,
		    last_seen = NOW()
	`, agentID, hostname, ip)
	return err
}

// UpdateLastSeen refreshes last_seen for an agent without changing other fields.
func UpdateLastSeen(ctx context.Context, pool *pgxpool.Pool, agentID string) error {
	_, err := pool.Exec(ctx, `
		UPDATE metadata.agents SET last_seen = NOW() WHERE agent_id = $1
	`, agentID)
	return err
}

// ListAgents returns all known agents ordered by agent_id.
func ListAgents(ctx context.Context, pool *pgxpool.Pool) ([]Agent, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, agent_id, COALESCE(hostname,''), COALESCE(ip,''), last_seen, registered_at
		FROM metadata.agents
		ORDER BY agent_id
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var agents []Agent
	for rows.Next() {
		var a Agent
		if err := rows.Scan(&a.ID, &a.AgentID, &a.Hostname, &a.IP, &a.LastSeen, &a.RegisteredAt); err != nil {
			return nil, err
		}
		agents = append(agents, a)
	}
	return agents, rows.Err()
}
