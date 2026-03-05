package storage

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"
)

var recordingsPath string

func init() {
	recordingsPath = os.Getenv("RECORDINGS_PATH")
	if recordingsPath == "" {
		recordingsPath = "/recordings"
	}
}

// WriteSegment writes an incoming .ts segment to disk under:
//
//	{recordingsPath}/{agentID}/{YYYY-MM-DD}/segment_{HHMMSS}.ts
//
// Returns the absolute file path and bytes written.
func WriteSegment(agentID string, startTime time.Time, data io.Reader) (string, int64, error) {
	t := startTime.UTC()
	dir := filepath.Join(recordingsPath, agentID, t.Format("2006-01-02"))

	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", 0, fmt.Errorf("create directory %s: %w", dir, err)
	}

	filename := fmt.Sprintf("segment_%s.ts", t.Format("150405"))
	filePath := filepath.Join(dir, filename)

	f, err := os.Create(filePath)
	if err != nil {
		return "", 0, fmt.Errorf("create file %s: %w", filePath, err)
	}
	defer f.Close()

	size, err := io.Copy(f, data)
	if err != nil {
		// Remove partial file on write failure
		os.Remove(filePath)
		return "", 0, fmt.Errorf("write segment: %w", err)
	}

	return filePath, size, nil
}
