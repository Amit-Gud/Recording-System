# Recording System

Enterprise-grade screen recording and replay platform. Windows agents capture endpoints 24/7 and stream to a microservices backend. Authorized users can watch sessions live or replay any recorded moment via a native Windows client.

---

## Overview

| Component | Technology | Role |
|-----------|-----------|------|
| **Windows Agent** | C# .NET 8 Windows Service | Captures screen at 10 fps, encodes H.264, streams live + uploads 60-second segments |
| **Server Stack** | Go microservices + Docker Compose | Ingests, indexes, stores, and serves recordings |
| **Web Client** | React + Tauri (Windows app) | Live view (WebRTC) + replay (HLS) + bookmarks |

**Capacity:** up to 10 concurrent agents · 24/7 · HD 1920×1080 · 10 fps · 30-day retention · ~1.6 TB total

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Windows Endpoint                                           │
│  DXGI Capture → H.264                                       │
│    ├── RTSP ──────────────────→ mediamtx (live)             │
│    └── HTTP POST segments ───→ ingest-service               │
│  Local circular buffer: 24 h (SQLite + .ts files)           │
└─────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────▼──────────┐
                    │  Traefik :80       │  API Gateway
                    └─────────┬──────────┘
          ┌──────────┬────────┼────────┬──────────┐
          ▼          ▼        ▼        ▼          ▼
      ingest      metadata  replay  bookmarks  cleanup
      :8001        :8002    :8003    :8004     (cron)
          │          │                │
          └────┬─────┘                │
               ▼                     ▼
         NATS :4222            PostgreSQL :5432
               │
         /recordings/{agent_id}/{date}/segment_HHMMSS.ts

                    mediamtx :8554 RTSP / :8889 WebRTC
                              │
                    ┌─────────▼──────────┐
                    │  React + Tauri     │  Windows Client
                    │  Dashboard         │
                    │  Live View (WebRTC)│
                    │  Replay (HLS)      │
                    │  Session Browser   │
                    │  Bookmarks         │
                    └────────────────────┘
```

---

## Quick Start

### 1 — Server

```bash
cd server
cp .env.example .env          # set POSTGRES_PASSWORD etc.
docker compose up --build
```

Server is ready at `http://localhost`.

### 2 — Windows Agent

Run `RecordingAgentSetup.exe` on each Windows endpoint.
The installer wizard asks for the server URL and starts the agent immediately.

To build the installer yourself:
```powershell
cd installer
.\build.ps1                   # requires Inno Setup 6 + .NET 8 SDK
# → installer/dist/RecordingAgentSetup.exe
```

### 3 — Client

```bash
cd client
cp .env.example .env          # set VITE_API_BASE_URL
npm install
npm run tauri dev             # development
npm run tauri build           # → Windows installer
```

---

## Repository Layout

```
Recording-System/
  README.md
  CLAUDE.md                   ← AI assistant instructions
  wiki/                       ← detailed documentation
  agent/                      ← C# .NET 8 Windows Service
    src/
      ScreenCapture/          ← DXGI Desktop Duplication
      Encoder/                ← FFmpeg H.264 pipe
      Uploader/               ← HTTP upload + retry
      LocalBuffer/            ← SQLite circular buffer
      Service/                ← Windows Service host
    appsettings.json
  server/
    docker-compose.yml
    .env.example
    ingest-service/           ← Go: receive segments, publish NATS
    metadata-service/         ← Go: index segments, list sessions
    replay-service/           ← Go: serve HLS
    bookmarks-service/        ← Go: bookmark CRUD
    cleanup-service/          ← Go: 30-day retention job
    mediamtx/                 ← RTSP → WebRTC bridge config
    postgres/                 ← DB init SQL
  client/                     ← React + Tauri Windows app
    src/
      components/
        Dashboard/
        LiveView/
        ReplayPlayer/
        SessionBrowser/
        BookmarkPanel/
      services/
        api.ts                ← REST + WebRTC client
        hlsPlayer.ts          ← hls.js wrapper
    src-tauri/                ← Rust Tauri shell
  installer/
    setup.iss                 ← Inno Setup script
    build.ps1                 ← Build automation
```

---

## Documentation

Full documentation is in the [`wiki/`](wiki/) directory:

| Page | Description |
|------|-------------|
| [Home](wiki/Home.md) | System overview and component summary |
| [Architecture](wiki/Architecture.md) | Detailed design, data flows, decisions |
| [Agent Setup](wiki/Agent-Setup.md) | Install and configure the Windows agent |
| [Server Setup](wiki/Server-Setup.md) | Deploy the Docker stack |
| [Client Setup](wiki/Client-Setup.md) | Build and run the React + Tauri client |
| [API Reference](wiki/API-Reference.md) | Full REST API documentation |
| [Development](wiki/Development.md) | Local dev workflow, branch conventions |

---

## Key Specs

| Property | Value |
|----------|-------|
| Concurrent agents | Up to 10 |
| Schedule | 24/7 continuous |
| Resolution | 1920 × 1080 |
| Frame rate | 10 fps |
| Codec | H.264 |
| Live latency | < 1 s (WebRTC) |
| Segment length | 60 s (.ts) |
| Local agent buffer | 24 h circular |
| Server retention | 30 days |
| Estimated storage | ~5.4 GB / agent / day · ~1.6 TB total |
| Authentication | All users — full access |
