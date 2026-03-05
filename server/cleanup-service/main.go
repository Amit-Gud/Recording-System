package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type segment struct {
	ID       int
	AgentID  string
	FilePath string
}

func main() {
	ctx := context.Background()

	pool, err := connectDB(ctx)
	if err != nil {
		log.Fatalf("[cleanup] %v", err)
	}
	defer pool.Close()

	retentionDays := 30
	if v := os.Getenv("RETENTION_DAYS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			retentionDays = n
		}
	}

	log.Printf("[cleanup] started — retention: %d days, running every hour", retentionDays)

	// Run once immediately, then every hour.
	runCleanup(ctx, pool, retentionDays)

	ticker := time.NewTicker(1 * time.Hour)
	defer ticker.Stop()
	for range ticker.C {
		runCleanup(ctx, pool, retentionDays)
	}
}

func runCleanup(ctx context.Context, pool *pgxpool.Pool, retentionDays int) {
	cutoff := time.Now().UTC().AddDate(0, 0, -retentionDays)
	log.Printf("[cleanup] deleting segments older than %s", cutoff.Format(time.RFC3339))

	rows, err := pool.Query(ctx, `
		SELECT id, agent_id, file_path
		FROM metadata.segments
		WHERE start_time < $1
		ORDER BY start_time
	`, cutoff)
	if err != nil {
		log.Printf("[cleanup] query old segments: %v", err)
		return
	}

	var stale []segment
	for rows.Next() {
		var s segment
		if err := rows.Scan(&s.ID, &s.AgentID, &s.FilePath); err != nil {
			log.Printf("[cleanup] scan row: %v", err)
			rows.Close()
			return
		}
		stale = append(stale, s)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		log.Printf("[cleanup] rows error: %v", err)
		return
	}

	if len(stale) == 0 {
		log.Printf("[cleanup] nothing to delete")
		return
	}

	deleted, failed := 0, 0
	for _, s := range stale {
		if err := os.Remove(s.FilePath); err != nil && !os.IsNotExist(err) {
			log.Printf("[cleanup] remove file %s: %v", s.FilePath, err)
			failed++
			continue
		}

		if _, err := pool.Exec(ctx, `DELETE FROM metadata.segments WHERE id = $1`, s.ID); err != nil {
			log.Printf("[cleanup] delete segment row %d: %v", s.ID, err)
			failed++
			continue
		}

		deleted++
	}

	log.Printf("[cleanup] done — deleted: %d, failed: %d", deleted, failed)
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
	var pool *pgxpool.Pool
	for attempt := 1; attempt <= 10; attempt++ {
		pool, err = pgxpool.NewWithConfig(ctx, cfg)
		if err == nil {
			if pingErr := pool.Ping(ctx); pingErr == nil {
				log.Printf("[cleanup/db] connected to postgres")
				return pool, nil
			} else {
				pool.Close()
				err = pingErr
			}
		}
		log.Printf("[cleanup/db] waiting for postgres, attempt %d/10: %v", attempt, err)
		time.Sleep(2 * time.Second)
	}
	return nil, fmt.Errorf("connect to postgres after 10 attempts: %w", err)
}
