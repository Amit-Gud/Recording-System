package db

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Segment struct {
	ID        int       `json:"id"`
	AgentID   string    `json:"agent_id"`
	StartTime time.Time `json:"start_time"`
	EndTime   time.Time `json:"end_time"`
	FilePath  string    `json:"file_path"`
	FileSize  int64     `json:"file_size"`
	CreatedAt time.Time `json:"created_at"`
}

// InsertSegment records a newly uploaded segment.
func InsertSegment(ctx context.Context, pool *pgxpool.Pool, agentID string, startTime, endTime time.Time, filePath string, fileSize int64) error {
	_, err := pool.Exec(ctx, `
		INSERT INTO metadata.segments (agent_id, start_time, end_time, file_path, file_size)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT DO NOTHING
	`, agentID, startTime, endTime, filePath, fileSize)
	return err
}

// ListDates returns distinct recording dates (YYYY-MM-DD) for an agent, newest first.
func ListDates(ctx context.Context, pool *pgxpool.Pool, agentID string) ([]string, error) {
	rows, err := pool.Query(ctx, `
		SELECT DISTINCT TO_CHAR(start_time AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date
		FROM metadata.segments
		WHERE agent_id = $1
		ORDER BY date DESC
	`, agentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var dates []string
	for rows.Next() {
		var d string
		if err := rows.Scan(&d); err != nil {
			return nil, err
		}
		dates = append(dates, d)
	}
	return dates, rows.Err()
}

// ListSegments returns segments for an agent within [start, end], ordered by start_time.
func ListSegments(ctx context.Context, pool *pgxpool.Pool, agentID string, start, end time.Time) ([]Segment, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, agent_id, start_time, end_time, file_path, file_size, created_at
		FROM metadata.segments
		WHERE agent_id  = $1
		  AND start_time >= $2
		  AND end_time   <= $3
		ORDER BY start_time
	`, agentID, start, end)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var segments []Segment
	for rows.Next() {
		var s Segment
		if err := rows.Scan(&s.ID, &s.AgentID, &s.StartTime, &s.EndTime, &s.FilePath, &s.FileSize, &s.CreatedAt); err != nil {
			return nil, err
		}
		segments = append(segments, s)
	}
	return segments, rows.Err()
}

// ListOldSegments returns segments whose start_time is older than the given cutoff.
// Used by cleanup-service via the REST API.
func ListOldSegments(ctx context.Context, pool *pgxpool.Pool, before time.Time) ([]Segment, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, agent_id, start_time, end_time, file_path, file_size, created_at
		FROM metadata.segments
		WHERE start_time < $1
		ORDER BY start_time
	`, before)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var segments []Segment
	for rows.Next() {
		var s Segment
		if err := rows.Scan(&s.ID, &s.AgentID, &s.StartTime, &s.EndTime, &s.FilePath, &s.FileSize, &s.CreatedAt); err != nil {
			return nil, err
		}
		segments = append(segments, s)
	}
	return segments, rows.Err()
}

// DeleteSegment removes a segment record by ID.
func DeleteSegment(ctx context.Context, pool *pgxpool.Pool, id int) error {
	_, err := pool.Exec(ctx, `DELETE FROM metadata.segments WHERE id = $1`, id)
	return err
}
