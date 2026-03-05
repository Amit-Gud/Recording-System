# Development

## Repository Layout

```
Recording-System/
  README.md                   ← project overview
  CLAUDE.md                   ← AI assistant context
  wiki/                       ← this documentation
  agent/                      ← C# .NET 8 Windows Service
  server/                     ← Go microservices + Docker Compose
  client/                     ← React + Tauri Windows app
  installer/                  ← Inno Setup script + build automation
```

---

## Branch Naming

All branches follow the pattern:

```
claude/<component>-<short-description>
```

Examples:

```
claude/agent-screen-capture
claude/server-ingest-api
claude/server-metadata
claude/client-dashboard
claude/client-replay-player
claude/cleanup-retention-job
```

---

## Commit Message Format

```
[component] short description

Optional longer body.
```

Components: `agent`, `ingest`, `metadata`, `replay`, `bookmarks`, `cleanup`, `client`, `installer`, `docs`

Examples:

```
[ingest] add segment upload endpoint with NATS publish
[agent] implement 24h circular buffer with SQLite index
[client] add bookmark markers to replay timeline
[cleanup] add 30-day retention job
[docs] add API reference wiki page
```

---

## Working on the Agent (C#)

**Prerequisites:** .NET 8 SDK, Windows (DXGI requires a real display or virtual display driver)

```bash
cd agent
dotnet build
dotnet run --project src/Service
```

> On a machine without a display (CI server), DXGI capture will fail. Mock the `IDxgiCapture` interface for unit tests.

**Project structure:**

| Project | Namespace | Role |
|---------|-----------|------|
| `ScreenCapture` | `RecordingAgent.ScreenCapture` | DXGI loop, emits raw frames |
| `Encoder` | `RecordingAgent.Encoder` | FFmpeg process management |
| `LocalBuffer` | `RecordingAgent.LocalBuffer` | SQLite segment index |
| `Uploader` | `RecordingAgent.Uploader` | HTTP upload + retry |
| `Service` | `RecordingAgent.Service` | `Worker` host, DI container, config |

**Configuration** during development: edit `agent/RecordingAgent/appsettings.Development.json` — this overrides `appsettings.json` when the environment is `Development`.

---

## Working on the Server (Go)

**Prerequisites:** Go 1.22+, Docker, Docker Compose

Each service is an independent Go module. They all share the Docker Compose network.

### Run everything

```bash
cd server
docker compose up --build
```

### Run a single service locally (outside Docker)

```bash
cd server/ingest-service

export NATS_URL=nats://localhost:4222
export RECORDINGS_PATH=/tmp/recordings
export POSTGRES_DSN="host=localhost user=recording password=recording dbname=recordings sslmode=disable"

go run .
```

Start dependencies first:

```bash
docker compose up postgres nats mediamtx
```

### Adding a new service

1. Create `server/<service-name>/` with `main.go` and `Dockerfile`
2. Add the service to `docker-compose.yml`
3. Add a Traefik routing label if the service needs external HTTP access

---

## Working on the Client (React + Tauri)

**Prerequisites:** Node.js 20 LTS, npm, Rust (for Tauri)

```bash
cd client
npm install

# Web-only dev (no Rust needed):
npm run dev

# Full Tauri dev (native window):
npm run tauri dev
```

### Project structure

```
client/src/
  main.tsx                    ← React entry point
  App.tsx                     ← Router
  services/
    api.ts                    ← REST client
    hlsPlayer.ts              ← hls.js wrapper
  components/
    Dashboard/
      Dashboard.tsx
      Dashboard.module.css
    LiveView/
    ReplayPlayer/
    SessionBrowser/
    BookmarkPanel/
      BookmarkPanel.tsx       ← sidebar panel
      AddBookmarkDialog.tsx   ← modal dialog
      AllBookmarks.tsx        ← global bookmarks page
      *.module.css
```

### Adding a new screen

1. Create `src/components/MyScreen/MyScreen.tsx` and `MyScreen.module.css`
2. Add a `<Route>` in `App.tsx`
3. Add navigation links where appropriate

### Environment variables

Variables must be prefixed with `VITE_` to be exposed to the browser. They are injected at **build time** — restart the dev server after changing `.env`.

---

## Testing

### Agent

```bash
cd agent
dotnet test
```

Unit tests mock `IDxgiCapture` and `IFfmpegEncoder` to avoid hardware dependencies.

### Server services

```bash
cd server/<service-name>
go test ./...
```

Integration tests use `testcontainers-go` to spin up real PostgreSQL and NATS instances.

### Client

```bash
cd client
npm test           # if a test runner is configured
npm run build      # type-check and bundling smoke test
```

---

## CI / CD

Suggested GitHub Actions pipelines (not yet in the repo):

| Pipeline | Trigger | Steps |
|----------|---------|-------|
| `agent-ci` | push to `agent/**` | `dotnet build` + `dotnet test` |
| `server-ci` | push to `server/**` | `go build ./...` + `go test ./...` per service |
| `client-ci` | push to `client/**` | `npm install` + `npm run build` (type-check) |
| `installer-ci` | push to `installer/**` | validate `.iss` syntax with `iscc /? setup.iss` |

---

## Useful Commands

### Check server is healthy

```bash
curl http://localhost/api/agents
curl http://localhost/api/segments?agent_id=TEST&start=2026-01-01T00:00:00Z&end=2026-12-31T23:59:59Z
```

### Manually upload a test segment

```bash
ffmpeg -f lavfi -i testsrc=duration=60:size=1920x1080:rate=10 \
       -c:v libx264 -b:v 500k -f mpegts /tmp/test_segment.ts

curl -X POST http://localhost/ingest/segment \
  -F agent_id=TEST \
  -F start_time=2026-03-05T10:00:00Z \
  -F end_time=2026-03-05T10:01:00Z \
  -F segment=@/tmp/test_segment.ts
```

### Query PostgreSQL directly

```bash
docker compose -f server/docker-compose.yml exec postgres \
  psql -U recording -d recordings \
  -c "SELECT agent_id, count(*) FROM metadata.segments GROUP BY agent_id;"
```

### Watch NATS events

```bash
docker compose -f server/docker-compose.yml exec nats \
  nats sub "segments.uploaded"
```
