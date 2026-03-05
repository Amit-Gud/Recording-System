# Recording System — CLAUDE.md

## Project Overview

An enterprise screen recording and replay system consisting of three components:

- **Windows Agent** — runs as a Windows Service on endpoint machines, captures screen
  content (including mouse cursor) at 10 fps HD, streams to the server, and maintains
  a local 24-hour rolling buffer.
- **Recording Server** — Docker-based backend that receives video streams, stores segments,
  manages metadata, and exposes a REST API.
- **Replay Client** — Windows desktop application (auto-starts on login) for searching,
  playing back recordings, and adding bookmarks.

---

## System Specifications

| Property              | Value                                          |
|-----------------------|------------------------------------------------|
| Concurrent agents     | Up to 10                                       |
| Recording schedule    | 24/7                                           |
| Resolution            | HD (1920×1080)                                 |
| Frame rate            | 10 fps                                         |
| Video codec           | H.264                                          |
| Transport (Agent→Server) | HTTP chunked POST (multipart segments)      |
| Local agent buffer    | Last 24 hours (circular, on local disk)        |
| Server retention      | 30 days; older segments deleted cyclically     |
| Estimated storage     | ~5.4 GB/agent/day → ~1.6 TB total (10 agents, 30 days) |
| Authentication        | All replay-client users have full access; no per-user restrictions |
| Content masking       | Not required                                   |

---

## Architecture

```
┌─────────────────────────────────────┐
│  Windows Endpoint (Agent)           │
│  ┌──────────────┐  ┌─────────────┐  │
│  │ DXGI Screen  │→ │ H.264       │  │
│  │ Capture      │  │ Encoder     │  │
│  │ (10fps, HD)  │  │ (FFmpeg)    │  │
│  └──────────────┘  └──────┬──────┘  │
│          ↓ (local 24h)    │         │
│  ┌──────────────┐         │ HTTP    │
│  │ Local Buffer │         │ POST    │
│  │ (circular)   │         │ chunks  │
│  └──────────────┘         │         │
└───────────────────────────┼─────────┘
                            ↓
┌──────────────────────────────────────────────┐
│  Docker Compose (Recording Server Stack)     │
│                                              │
│  ┌─────────────────┐   ┌──────────────────┐  │
│  │  FastAPI Server  │←→│  PostgreSQL DB   │  │
│  │  (Python)        │   │  (metadata,      │  │
│  │                  │   │   bookmarks,     │  │
│  │  - Ingest API    │   │   segments)      │  │
│  │  - Replay API    │   └──────────────────┘  │
│  │  - Bookmarks API │                         │
│  └────────┬─────────┘                         │
│           │ read/write                        │
│  ┌────────▼─────────────────────────────────┐ │
│  │  Video Storage Volume                    │ │
│  │  /recordings/<agent_id>/<date>/          │ │
│  │    segment_HHMMSS.ts                     │ │
│  │    playlist.m3u8                         │ │
│  └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
                            ↑ REST API / HLS
┌──────────────────────────────────────────────┐
│  Replay Client (Windows WPF App)             │
│  - Starts on Windows login (startup entry)   │
│  - Search: by agent, date/time range         │
│  - Playback: HLS stream via embedded player  │
│  - Bookmarks: add during playback            │
└──────────────────────────────────────────────┘
```

---

## Component Details

### 1. Windows Agent (`/agent`)

**Technology:** C# (.NET 8) — Windows Service

**Responsibilities:**
- Capture the screen using **DXGI Desktop Duplication API** at 10 fps
- Overlay/encode mouse cursor position as video metadata or burned-in cursor
- Encode frames to H.264 using **FFmpeg** (via `FFmpeg.AutoGen` or process pipe)
- Write encoded segments (1-minute `.ts` files) to local circular buffer (last 24h)
- Simultaneously POST each completed segment to the Recording Server
- Retry failed uploads from local buffer when connectivity is restored
- Register itself as a Windows Service; auto-start on boot

**Key files (planned):**
```
agent/
  Agent.csproj
  src/
    ScreenCapture/   # DXGI capture loop
    Encoder/         # FFmpeg H.264 encoding
    Uploader/        # HTTP segment uploader with retry
    LocalBuffer/     # Circular 24h disk buffer management
    Service/         # Windows Service host
  appsettings.json   # server URL, agent_id, buffer path
```

---

### 2. Recording Server (`/server`)

**Technology:** Python 3.12 + FastAPI — runs in Docker

**Responsibilities:**
- Receive video segment uploads from agents (multipart HTTP POST)
- Write `.ts` segments to organized file storage
- Maintain/update per-agent HLS playlists (`.m3u8`)
- Record segment metadata in PostgreSQL (agent_id, start_time, end_time, file_path)
- Expose API for bookmark creation and retrieval
- Serve HLS playlists and video segments to replay clients
- Run a background job to delete segments older than 30 days

**Docker services (`docker-compose.yml`):**
```
recording-server   # FastAPI app (port 8000)
postgres           # PostgreSQL 15 (port 5432, internal only)
```

**Storage layout:**
```
/recordings/
  <agent_id>/
    <YYYY-MM-DD>/
      segment_<HHMMSS>.ts     # 1-minute video chunk
      playlist.m3u8            # rolling HLS playlist for that day
```

**Key files (planned):**
```
server/
  Dockerfile
  docker-compose.yml
  requirements.txt
  app/
    main.py
    routers/
      ingest.py      # POST /api/segments
      replay.py      # GET /api/sessions, GET /hls/{agent_id}/...
      bookmarks.py   # POST/GET /api/bookmarks
    models.py        # SQLAlchemy ORM models
    database.py      # DB connection
    storage.py       # File I/O helpers
    cleanup.py       # 30-day retention job (APScheduler)
  alembic/           # DB migrations
```

---

### 3. Replay Client (`/client`)

**Technology:** C# (.NET 8) WPF — Windows desktop app

**Responsibilities:**
- Register itself in Windows Startup (HKCU Run key) on first launch
- Connect to the Recording Server REST API
- Display list of agents and browsable date/time sessions
- Stream and play back HLS video using **LibVLCSharp** or **MediaElement**
- Allow user to add bookmarks at the current playback position (label + timestamp)
- Display existing bookmarks as markers on the playback timeline
- Support jumping to a bookmarked timestamp

**Key files (planned):**
```
client/
  Client.csproj
  Views/
    MainWindow.xaml         # Session browser + player layout
    SessionListView.xaml    # Agent/date/session selector
    PlayerView.xaml         # Video player + timeline + bookmarks
  ViewModels/
    MainViewModel.cs
    PlayerViewModel.cs
  Services/
    ApiService.cs           # HTTP client for server REST API
    HlsPlayerService.cs     # LibVLCSharp integration
  Startup/
    StartupRegistration.cs  # Windows startup entry management
```

---

## REST API Reference (planned)

### Ingest
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/segments` | Upload a 1-minute video segment from agent |
| POST | `/api/agents/register` | Agent registration / heartbeat |

### Replay
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agents` | List all known agents |
| GET | `/api/sessions?agent_id=&date=` | List sessions (days) for an agent |
| GET | `/hls/{agent_id}/{date}/playlist.m3u8` | HLS playlist for a date |
| GET | `/hls/{agent_id}/{date}/{segment}` | Serve a .ts segment |

### Bookmarks
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/bookmarks` | Create a bookmark |
| GET | `/api/bookmarks?agent_id=&start=&end=` | Query bookmarks by agent + time range |
| DELETE | `/api/bookmarks/{id}` | Delete a bookmark |

**Bookmark payload:**
```json
{
  "agent_id": "DESKTOP-ABC123",
  "timestamp": "2026-03-05T14:32:10Z",
  "label": "Suspicious activity"
}
```

---

## Data Models

### `segments` table
```sql
id          SERIAL PRIMARY KEY
agent_id    VARCHAR NOT NULL
start_time  TIMESTAMPTZ NOT NULL
end_time    TIMESTAMPTZ NOT NULL
file_path   VARCHAR NOT NULL
file_size   BIGINT
created_at  TIMESTAMPTZ DEFAULT NOW()
```

### `bookmarks` table
```sql
id          SERIAL PRIMARY KEY
agent_id    VARCHAR NOT NULL
timestamp   TIMESTAMPTZ NOT NULL
label       VARCHAR NOT NULL
created_at  TIMESTAMPTZ DEFAULT NOW()
```

### `agents` table
```sql
id              SERIAL PRIMARY KEY
agent_id        VARCHAR UNIQUE NOT NULL
hostname        VARCHAR
last_seen       TIMESTAMPTZ
registered_at   TIMESTAMPTZ DEFAULT NOW()
```

---

## Development Workflow

### Branch Naming
All branches must use the prefix `claude/` followed by a descriptive slug:
```
claude/agent-screen-capture
claude/server-ingest-api
claude/client-player
```

### Commit Messages
Format: `[component] short description`
```
[agent] add DXGI screen capture loop at 10fps
[server] implement segment ingest endpoint
[client] add bookmark timeline markers to player view
[server] add 30-day retention cleanup job
```

### Running the Server Stack
```bash
cd server
docker compose up --build          # start all services
docker compose down                # stop
docker compose logs -f recording-server   # tail logs
```

### Running the Agent (dev mode)
```bash
cd agent
dotnet run -- --server http://localhost:8000 --agent-id DEV-001
```

### Running the Client (dev mode)
```bash
cd client
dotnet run
```

### Environment Variables (Server)
```
DATABASE_URL=postgresql://user:pass@postgres:5432/recordings
RECORDINGS_PATH=/recordings
RETENTION_DAYS=30
SERVER_PORT=8000
```

---

## Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Screen capture API | DXGI Desktop Duplication | Best performance on Windows, low CPU |
| Video codec | H.264 | Universal compatibility, good compression |
| Video container/streaming | HLS (.ts + .m3u8) | Simple file-based, easy to seek, no special server |
| Server framework | FastAPI (Python) | Fast to develop, async, good for file streaming |
| Server runtime | Docker (docker-compose) | Easy deployment, isolated environment |
| Database | PostgreSQL | Reliable, good timestamp support |
| Client framework | WPF (.NET 8) | Native Windows, good media playback options |
| Video player (client) | LibVLCSharp | Excellent HLS support, native Windows rendering |

---

## Storage Sizing Reference

At H.264 ~500 kbps for HD 10fps:
- **Per agent per hour:** ~225 MB
- **Per agent per day:** ~5.4 GB
- **10 agents, 30 days:** ~1.6 TB

Plan storage accordingly. The local agent buffer (24h) requires ~5.4 GB free disk space per endpoint.

---

## Cyclic Deletion Policy

The server runs a background job (default: every hour) that:
1. Queries `segments` where `start_time < NOW() - INTERVAL '30 days'`
2. Deletes the corresponding `.ts` files from disk
3. Deletes the DB rows
4. Regenerates or prunes stale `.m3u8` playlists

---

## Repository Structure (target)

```
Recording-System/
  CLAUDE.md
  agent/                  # C# .NET 8 Windows Service
  server/                 # Python FastAPI + docker-compose
  client/                 # C# .NET 8 WPF Windows app
  docs/                   # Architecture diagrams, API docs
```
