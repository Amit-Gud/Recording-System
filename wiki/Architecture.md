# Architecture

## Component Map

```
┌──────────────────────────────────────────────────────────────────────┐
│  Windows Endpoint (C# .NET 8 Windows Service)                        │
│                                                                      │
│  ┌─────────────┐   raw frames   ┌──────────────────┐                │
│  │ DXGI Capture│ ─────────────→ │ FFmpeg H.264 Pipe│                │
│  │  10fps HD   │                └────────┬─────────┘                │
│  └─────────────┘                         │                           │
│                             ┌────────────┴──────────┐               │
│                             ▼                        ▼               │
│                    RTSP stream (real-time)    60s .ts segments        │
│                             │                        │               │
│                    ┌────────▼────────┐    ┌──────────▼──────────┐   │
│                    │  mediamtx       │    │  Local Buffer        │   │
│                    │  :8554 RTSP     │    │  SQLite index        │   │
│                    │  :8889 WebRTC   │    │  24h circular        │   │
│                    └────────┬────────┘    └──────────┬──────────┘   │
│                             │                        │               │
└─────────────────────────────│────────────────────────│───────────────┘
                              │  WebRTC                │  HTTP POST
                              ▼                        ▼
                    ┌─────────────────────────────────────────────────┐
                    │  Docker Compose                                  │
                    │                                                  │
                    │  Traefik :80 ────────────────────────────────   │
                    │     /ingest/*     → ingest-service    :8001      │
                    │     /api/agents   → metadata-service  :8002      │
                    │     /api/sessions → metadata-service  :8002      │
                    │     /api/segments → metadata-service  :8002      │
                    │     /hls/*        → replay-service    :8003      │
                    │     /api/bookmarks→ bookmarks-service :8004      │
                    │                                                  │
                    │  NATS :4222 ←→ ingest / metadata / cleanup       │
                    │  PostgreSQL :5432                                 │
                    │  /recordings (shared volume)                     │
                    └─────────────────────────────────────────────────┘
                              │ HLS / WebRTC
                              ▼
                    ┌─────────────────────────────────────────────────┐
                    │  React + Tauri (Windows desktop client)          │
                    └─────────────────────────────────────────────────┘
```

---

## Windows Agent

### Video Pipeline

```
DXGI Desktop Duplication API
  └─ 10 fps, 1920×1080, BGRA frames written to stdin pipe
       └─ FFmpeg process
            ├─ output 1: RTSP → rtsp://mediamtx/{agent_id}
            └─ output 2: segment muxer → segment_%Y%m%d_%H%M%S.ts (60s each)
                              └─ Encoder Thread writes to buffer dir
```

FFmpeg uses the **tee muxer** so a single encode feeds both outputs simultaneously. This avoids double-encoding.

### Three Background Threads

| Thread | Trigger | Action |
|--------|---------|--------|
| **Encoder** | Every 60 s | Writes `.ts` file, inserts row to SQLite with `uploaded = false` |
| **Upload** | Polls SQLite every 5 s | POSTs unuploaded segments to `/ingest/segment`; marks `uploaded = true`; retries ×4 with exponential backoff (2 s, 4 s, 8 s, 16 s) |
| **Cleanup** | Every 60 s | If total buffered duration > 24 h: deletes oldest `.ts` + SQLite row; logs WARNING if segment was not yet uploaded |

### Local Buffer Layout

```
C:\ProgramData\RecordingAgent\buffer\
  index.db                    ← SQLite: filename, start_time, end_time, uploaded
  segments\
    20260305_143000.ts        ← 60-second MPEG-TS segment
    20260305_143100.ts
    ...                       ← up to ~1440 files (24 h × 60)
```

Buffer capacity: 1440 segments × ~3.75 MB ≈ **5.4 GB** per endpoint.

### Agent Configuration (`appsettings.json`)

```json
{
  "Agent": {
    "AgentId":               "",               // empty → uses machine hostname
    "ServerUrl":             "http://...",     // patched by installer
    "MediaServerUrl":        "rtsp://...:8554",
    "BufferPath":            "C:\\ProgramData\\RecordingAgent\\buffer",
    "FfmpegPath":            "C:\\...\\ffmpeg.exe", // patched by installer
    "TargetFps":             10,
    "BufferHours":           24,
    "SegmentDurationSeconds": 60,
    "VideoBitrateKbps":      500
  }
}
```

---

## Server Stack

### Services

| Service | Port | Language | Responsibility |
|---------|------|----------|----------------|
| **Traefik** | 80 | — | API gateway, path-based routing, no auth config needed |
| **ingest-service** | 8001 | Go | Receive multipart segment upload, write `.ts` to shared volume, publish `segments.uploaded` NATS event |
| **metadata-service** | 8002 | Go | Subscribe to `segments.uploaded`, INSERT to PostgreSQL; expose `/api/agents`, `/api/sessions`, `/api/segments` |
| **replay-service** | 8003 | Go | Read `.ts` files from shared volume, generate and serve HLS playlists (`.m3u8`) |
| **bookmarks-service** | 8004 | Go | CRUD bookmarks in PostgreSQL |
| **cleanup-service** | — | Go | Cron: every hour delete segments older than 30 days from disk + DB |
| **mediamtx** | 8554 / 8889 | — | RTSP ingest from agents, WebRTC WHEP output to clients |
| **NATS** | 4222 | — | Async event bus |
| **PostgreSQL** | 5432 | — | Persistent storage for metadata and bookmarks |

### NATS Event Flow

```
Agent
  → POST /ingest/segment
    → ingest-service
        writes segment_HHMMSS.ts to /recordings/{agent_id}/{date}/
        publishes → segments.uploaded {
          agent_id, start_time, end_time, file_path, file_size
        }
          → metadata-service: INSERT INTO metadata.segments
          → cleanup-service:  update retention tracking
```

### Shared Volume Layout

```
/recordings/
  {agent_id}/
    2026-03-05/
      segment_143000.ts
      segment_143100.ts
      ...
    2026-03-06/
      ...
```

### Database Schema

```sql
-- schema: metadata
CREATE TABLE agents (
    id            SERIAL PRIMARY KEY,
    agent_id      VARCHAR(255) UNIQUE NOT NULL,
    hostname      VARCHAR(255),
    ip            VARCHAR(50),
    last_seen     TIMESTAMPTZ,
    registered_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE segments (
    id         SERIAL PRIMARY KEY,
    agent_id   VARCHAR(255) NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time   TIMESTAMPTZ NOT NULL,
    file_path  VARCHAR(1024) NOT NULL,
    file_size  BIGINT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_segments_agent_time ON segments(agent_id, start_time);

-- schema: bookmarks
CREATE TABLE bookmarks (
    id         SERIAL PRIMARY KEY,
    agent_id   VARCHAR(255) NOT NULL,
    timestamp  TIMESTAMPTZ NOT NULL,
    label      VARCHAR(1024) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bookmarks_agent_time ON bookmarks(agent_id, timestamp);
```

---

## Web Client

### Screen Flow

```
Dashboard (agent grid, live thumbnails)
  │
  ├─ click thumbnail ──→ Live View
  │                        WebRTC WHEP player (full-screen)
  │                        Press B → Add Bookmark dialog
  │                        "Go to Replay" ──→ Replay Player
  │
  ├─ "Sessions" ──────→ Session Browser
  │                        Calendar with recording-day dots
  │                        Day timeline: segment bars + bookmark pins
  │                        Click segment / bookmark → Replay Player
  │
  └─ "Bookmarks" ─────→ All Bookmarks
                           List across all agents, newest first
                           Click → Replay Player at exact timestamp
```

### Replay Player

The HLS player uses **hls.js** for browser-native playback without plugins. Key features:

- Scrubber over full day duration
- **Bookmark markers** overlaid directly on the scrubber track (yellow dots); click to jump
- Playback speeds: 0.5×, 1×, 1.5×, 2×, 4×, 8×
- URL parameter `?t=<ISO timestamp>` for deep-linking to exact moments
- Keyboard: `Space` = play/pause, `B` = add bookmark

### Tauri Shell

The Rust/Tauri shell adds:

- **System tray icon** — the app minimises to tray instead of closing, allowing background presence
- Right-click tray menu: Show / Quit
- Auto-starts with Windows via the agent installer (or independently)

---

## Design Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Screen capture | DXGI Desktop Duplication | Best performance on Windows, captures cursor, hardware-accelerated |
| Encode once | FFmpeg tee muxer | Single H.264 encode feeds both RTSP and file outputs |
| Live streaming | WebRTC via mediamtx | Sub-second latency, browser-native (no plugin), mediamtx handles RTSP→WebRTC conversion |
| Replay | HLS (.m3u8 + .ts) | File-based, natural seeking, speed control, standard |
| Agent→Server (storage) | HTTP multipart POST | Simple, retry-friendly, works through firewalls |
| Message broker | NATS | Lightweight, Go-native, low latency, zero configuration |
| API gateway | Traefik | Docker-native service discovery, zero SSL-termination config |
| Language (server) | Go | Excellent I/O concurrency, fast compile, small Docker images |
| Local buffer index | SQLite | Zero-config embedded DB, ideal for single-process use |
| Client shell | Tauri (Rust) | ~10 MB overhead vs ~150 MB Electron, native Windows tray |
| Authentication | None (all users full access) | Enterprise internal tool — network-level access control |
