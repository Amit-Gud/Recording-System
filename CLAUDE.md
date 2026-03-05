# Recording System — CLAUDE.md

## Project Overview

An enterprise screen recording and replay system. Windows agents capture endpoints
continuously and stream to a microservices backend. Authorized users replay sessions
via a React web client.

---

## Components

| Component | Technology | Description |
|-----------|-----------|-------------|
| **Windows Agent** | C# .NET 8 (Windows Service) | Captures screen, encodes H.264, streams live + uploads segments |
| **Server Stack** | Go microservices + Docker Compose | Ingests, stores, indexes, serves recordings |
| **Web Client** | React + Tauri (Windows Startup app) | Live view (WebRTC) + replay (HLS) + bookmarks |

---

## System Specifications

| Property | Value |
|----------|-------|
| Concurrent agents | Up to 10 |
| Recording schedule | 24/7 |
| Resolution | HD 1920×1080 |
| Frame rate | 10 fps |
| Video codec | H.264 |
| Live transport | RTSP (Agent → mediamtx) |
| Segment upload | HTTP multipart POST (Agent → ingest-service) |
| Live streaming to client | WebRTC (mediamtx → React) |
| Replay streaming to client | HLS (.m3u8 + .ts) |
| Local agent buffer | 24 hours circular (SQLite index + .ts files) |
| Server retention | 30 days, cyclic deletion |
| Estimated storage | ~5.4 GB/agent/day → ~1.6 TB (10 agents, 30 days) |
| Authentication | All users have full access, no per-user restrictions |
| Content masking | Not required |

---

## Microservices Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Windows Endpoint (C# Agent)                                        │
│  DXGI Capture → H.264 Encoder ──┬── RTSP ──→ mediamtx (live)       │
│                                  └── HTTP POST segments → ingest    │
│  Local Circular Buffer (24h, SQLite index + .ts files)              │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  Docker Compose                                                      │
│                                                                      │
│  [Traefik API Gateway :80]                                           │
│       │                                                              │
│       ├── /ingest/*     → ingest-service    :8001 (Go)              │
│       ├── /api/agents   → metadata-service  :8002 (Go)              │
│       ├── /api/sessions → metadata-service  :8002 (Go)              │
│       ├── /hls/*        → replay-service    :8003 (Go)              │
│       └── /api/bookmarks→ bookmarks-service :8004 (Go)              │
│                                                                      │
│  [mediamtx :8554 RTSP / :8889 WebRTC]  ← live stream from agents   │
│                                                                      │
│  [NATS :4222]  ← async events between services                      │
│    subjects: segments.uploaded, agents.registered                   │
│                                                                      │
│  [PostgreSQL]                                                        │
│    schema: metadata  → agents, segments tables                      │
│    schema: bookmarks → bookmarks table                              │
│                                                                      │
│  [Shared Volume: /recordings/{agent_id}/{date}/segment_HHMMSS.ts]  │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  React Client (Tauri — Windows Startup)                             │
│  Dashboard → Live View (WebRTC) / Replay Player (HLS) / Bookmarks  │
└─────────────────────────────────────────────────────────────────────┘
```

### Service Responsibilities

| Service | Port | Responsibility |
|---------|------|----------------|
| **api-gateway** (Traefik) | 80 | Single entry point, path-based routing |
| **ingest-service** (Go) | 8001 | Receive segments, write to disk, publish NATS events |
| **stream-service** (mediamtx) | 8554/8889 | RTSP → WebRTC for live view |
| **metadata-service** (Go) | 8002 | Index segments, list agents/sessions; consumes NATS |
| **replay-service** (Go) | 8003 | Serve HLS playlists and .ts files for replay |
| **bookmarks-service** (Go) | 8004 | CRUD bookmarks via REST API |
| **cleanup-service** (Go) | — | Hourly job: delete segments older than 30 days |
| **nats** | 4222 | Async message broker |
| **postgres** | 5432 | Metadata + bookmarks persistence |

### NATS Event Flow (segment upload)
```
Agent
  → POST /ingest/segment
    → ingest-service writes seg.ts to /recordings/{agent_id}/{date}/
    → ingest-service publishes: segments.uploaded {agent_id, start_time, end_time, file_path, file_size}
      → metadata-service consumes → INSERT into metadata.segments
      → cleanup-service consumes → updates retention tracking
```

---

## Windows Agent Architecture

### Video Pipeline
```
DXGI Desktop Duplication (10fps, HD)
  → H.264 Encoder (FFmpeg)
  ├── RTSP stream → mediamtx         (live viewing, real-time)
  └── 60s .ts segments → local buffer → HTTP POST to ingest-service
```

### Local Circular Buffer (24h)
```
C:\ProgramData\RecordingAgent\buffer\
  index.db          ← SQLite: segments(filename, start_time, end_time, uploaded)
  segments\
    20260305_143000.ts
    20260305_143100.ts
    ...
```

**Three background threads:**
- **Encoder Thread** — writes segment every 60s, inserts to SQLite with `uploaded=false`
- **Upload Thread** — polls SQLite for `uploaded=false`, POSTs to server, marks `uploaded=true`; retries x4 with exponential backoff on failure
- **Cleanup Thread** — every 60s, if total duration > 24h: delete oldest segment (file + DB row); logs WARNING if deleting unuploaded segment

**Buffer sizing:** 1440 segments × ~3.75 MB = ~5.4 GB disk required per endpoint

---

## Web Client (React + Tauri)

### Screens
1. **Dashboard** — grid of live agent thumbnails, online/offline status
2. **Live View** — full-screen WebRTC player + bookmarks panel, press `B` to bookmark
3. **Replay Player** — HLS player, scrub timeline, bookmark markers, speed 0.5x–8x
4. **Session Browser** — calendar + daily timeline per agent, bookmark list
5. **Add Bookmark Dialog** — label input, saves with exact timestamp

### Navigation Flow
```
Dashboard
  ├── click thumbnail  → Live View
  │     └── "Go to Replay" → Replay Player
  ├── click agent name → Session Browser → Replay Player
  └── [Bookmarks] header → all bookmarks → Replay Player (jump to timestamp)
```

---

## REST API

### Ingest
| Method | Path | Description |
|--------|------|-------------|
| POST | `/ingest/segment` | Upload 60s .ts segment (multipart: agent_id, start_time, end_time, segment file) |
| POST | `/ingest/register` | Agent heartbeat/registration |

### Metadata
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agents` | List all agents with last_seen status |
| GET | `/api/sessions?agent_id=&date=` | List recording dates for an agent |
| GET | `/api/segments?agent_id=&start=&end=` | List segments in time range |

### Replay
| Method | Path | Description |
|--------|------|-------------|
| GET | `/hls/{agent_id}/{date}/playlist.m3u8` | HLS playlist for a date |
| GET | `/hls/{agent_id}/{date}/{segment}.ts` | Serve a video segment |

### Bookmarks
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/bookmarks` | Create bookmark `{agent_id, timestamp, label}` |
| GET | `/api/bookmarks?agent_id=&start=&end=` | Query bookmarks |
| DELETE | `/api/bookmarks/{id}` | Delete bookmark |

---

## Database Schema

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

## Repository Structure

```
Recording-System/
  CLAUDE.md
  agent/                        # C# .NET 8 Windows Service
    Agent.sln
    src/
      ScreenCapture/            # DXGI capture loop
      Encoder/                  # FFmpeg H.264 pipe
      Uploader/                 # HTTP segment uploader + retry
      LocalBuffer/              # SQLite circular buffer management
      Service/                  # Windows Service host
    appsettings.json
  server/
    docker-compose.yml
    .env.example
    mediamtx/
      mediamtx.yml
    postgres/
      init.sql
    ingest-service/             # Go — receives segments from agents
    metadata-service/           # Go — indexes segments, lists sessions
    replay-service/             # Go — serves HLS files
    bookmarks-service/          # Go — bookmark CRUD
    cleanup-service/            # Go — 30-day retention job
  client/                       # React + Tauri
    src/
      components/
        Dashboard/
        LiveView/
        ReplayPlayer/
        SessionBrowser/
        BookmarkPanel/
      services/
        api.ts                  # REST API client
        hlsPlayer.ts
      App.tsx
    src-tauri/                  # Tauri Rust shell + Windows startup
```

---

## Development Workflow

### Branch Naming
```
claude/agent-screen-capture
claude/server-ingest-api
claude/server-metadata
claude/client-dashboard
```

### Commit Messages
Format: `[component] description`
```
[ingest] add segment upload endpoint with NATS publish
[agent] implement 24h circular buffer with SQLite index
[client] add bookmark markers to replay timeline
[cleanup] add 30-day retention job
```

### Running the Server Stack
```bash
cd server
docker compose up --build        # start all services
docker compose down              # stop
docker compose logs -f ingest-service
```

### Environment Variables
```
POSTGRES_USER=recording
POSTGRES_PASSWORD=recording
POSTGRES_DB=recordings
NATS_URL=nats://nats:4222
RECORDINGS_PATH=/recordings
RETENTION_DAYS=30
```

---

## Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Screen capture | DXGI Desktop Duplication | Best perf on Windows, supports cursor |
| Video codec | H.264 | Universal, good compression at 10fps |
| Live streaming | WebRTC via mediamtx | <1s latency, browser-native |
| Replay streaming | HLS (.m3u8 + .ts) | File-based, natural seeking, speed control |
| Agent → Server (live) | RTSP → mediamtx | Separates live from storage pipeline |
| Agent → Server (storage) | HTTP multipart POST | Simple, reliable, retry-friendly |
| Message broker | NATS | Lightweight, Go-native, low latency |
| Server language | Go | Excellent I/O concurrency, small Docker images |
| API gateway | Traefik | Docker-native, zero-config service discovery |
| Client | React + Tauri | Web UI + native Windows shell, auto-startup |
| Local buffer index | SQLite | Zero-config embedded DB, perfect for single-process |
