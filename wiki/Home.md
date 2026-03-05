# Recording System — Wiki

Welcome to the Recording System documentation.

## What Is This?

An enterprise screen recording and replay platform consisting of three components that work together:

- **Windows Agent** — a background Windows Service installed on each monitored endpoint. It captures the screen continuously using the DXGI Desktop Duplication API, encodes it as H.264, and does two things simultaneously: streams live footage over RTSP and uploads 60-second `.ts` segments to the server over HTTP. It also keeps a local 24-hour circular buffer so recordings are safe even during network outages.

- **Server Stack** — a set of Go microservices orchestrated with Docker Compose. Together they receive and store segments, index them in PostgreSQL, serve live streams via WebRTC, serve historical recordings via HLS, and manage bookmarks and retention.

- **React + Tauri Client** — a Windows desktop application built with React (web UI) and Tauri (native shell). It provides a live view dashboard, a full replay player with a timeline scrubber, a session calendar browser, and a bookmark system.

---

## Pages

| Page | What it covers |
|------|----------------|
| [Architecture](Architecture.md) | Component internals, data flows, design decisions |
| [Agent Setup](Agent-Setup.md) | Install the Windows agent via the single-EXE installer |
| [Server Setup](Server-Setup.md) | Deploy the Docker Compose stack |
| [Client Setup](Client-Setup.md) | Build and run the React + Tauri client |
| [API Reference](API-Reference.md) | Full REST API — endpoints, request/response formats |
| [Development](Development.md) | Local dev environment, branch naming, testing |

---

## System at a Glance

```
Agent (Windows)                Server (Linux/Docker)         Client (Windows)
─────────────────              ─────────────────────         ────────────────
DXGI capture (10fps)           Traefik :80 (gateway)         React + Tauri app
  │                              ├─ ingest-service :8001       Dashboard
  ├─ RTSP ──────────────────→    │    writes .ts to disk       Live View (WebRTC)
  │       mediamtx :8554/8889    │    publishes NATS event     Replay Player (HLS)
  │                              │                             Session Browser
  └─ HTTP POST segments ──────→  ├─ metadata-service :8002    Bookmarks
       (60s .ts, multipart)      │    indexes to PostgreSQL
                                 ├─ replay-service :8003
       Local buffer (24h)        │    serves HLS playlists
       SQLite index + .ts        ├─ bookmarks-service :8004
       Retry on failure          │    CRUD bookmarks
                                 └─ cleanup-service
                                      hourly, 30-day retention

                               NATS :4222  PostgreSQL :5432
                               /recordings/{agent}/{date}/*.ts
```

---

## Quick Navigation

**I want to...**

- Install the agent on a Windows machine → [Agent Setup](Agent-Setup.md)
- Deploy the server → [Server Setup](Server-Setup.md)
- Run or build the client app → [Client Setup](Client-Setup.md)
- Understand how the system works → [Architecture](Architecture.md)
- Integrate with the API → [API Reference](API-Reference.md)
- Contribute code → [Development](Development.md)
