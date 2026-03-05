# Server Setup

The server stack runs entirely in Docker Compose. A single `docker compose up --build` starts all services.

---

## Requirements

| Requirement | Minimum |
|-------------|---------|
| OS | Any Linux distro (Ubuntu 22.04 LTS recommended), or Windows with WSL2 |
| Docker | 24.0 or later |
| Docker Compose | v2 plugin (`docker compose`, not `docker-compose`) |
| CPU | 2 cores |
| RAM | 2 GB free |
| Disk | 2 TB recommended (see [Storage](#storage-planning)) |
| Ports open | 80 (API + HLS), 8554 (RTSP), 8889 (WebRTC) |

---

## First-Time Setup

### 1 — Clone and configure

```bash
cd server
cp .env.example .env
```

Edit `.env`:

```env
POSTGRES_USER=recording
POSTGRES_PASSWORD=changeme        # ← change this
POSTGRES_DB=recordings
NATS_URL=nats://nats:4222
RECORDINGS_PATH=/recordings
RETENTION_DAYS=30
```

### 2 — Start

```bash
docker compose up --build
```

All services start in dependency order. First startup downloads base images and compiles the Go services — expect 2–5 minutes.

### 3 — Verify

```bash
# All containers running?
docker compose ps

# API responding?
curl http://localhost/api/agents        # → []

# PostgreSQL ready?
docker compose exec postgres psql -U recording -d recordings -c "\dt metadata.*"
```

---

## Services and Ports

| Service | Internal Port | External Port | Description |
|---------|--------------|---------------|-------------|
| Traefik | 80 | **80** | API gateway — all client/agent traffic enters here |
| ingest-service | 8001 | — | Receives segment uploads from agents |
| metadata-service | 8002 | — | Indexes segments, serves agent/session queries |
| replay-service | 8003 | — | Serves HLS playlists and `.ts` files |
| bookmarks-service | 8004 | — | Bookmark CRUD |
| cleanup-service | — | — | Background job, no HTTP port |
| mediamtx | 8554, 8889 | **8554**, **8889** | RTSP ingest from agents / WebRTC to clients |
| NATS | 4222 | — | Internal message bus |
| PostgreSQL | 5432 | — | Internal database |

Only ports **80**, **8554**, and **8889** need to be reachable from agent machines and client machines.

---

## Directory Structure

```
server/
  docker-compose.yml
  .env.example
  mediamtx/
    mediamtx.yml              ← mediamtx configuration
  postgres/
    init.sql                  ← creates metadata and bookmarks schemas
  ingest-service/
    main.go
    Dockerfile
  metadata-service/
    main.go
    Dockerfile
  replay-service/
    main.go
    Dockerfile
  bookmarks-service/
    main.go
    Dockerfile
  cleanup-service/
    main.go
    Dockerfile
```

---

## Common Operations

### Start / Stop

```bash
docker compose up -d              # start in background
docker compose down               # stop all, keep volumes
docker compose down -v            # stop all + delete volumes (DESTROYS DATABASE)
```

### View Logs

```bash
docker compose logs -f                        # all services
docker compose logs -f ingest-service         # single service
docker compose logs -f --tail=100 metadata-service
```

### Restart a Single Service

```bash
docker compose restart ingest-service
```

### Rebuild After Code Changes

```bash
docker compose up --build ingest-service      # rebuild + restart one service
docker compose up --build                     # rebuild everything
```

---

## Storage Planning

Recordings are stored on the Docker host at the path mapped to `/recordings` inside containers. Set this path in `docker-compose.yml` under the `volumes:` section for the ingest and replay services.

| Agents | Days | Per-agent/day | Total |
|--------|------|---------------|-------|
| 1 | 30 | 5.4 GB | ~162 GB |
| 5 | 30 | 5.4 GB | ~810 GB |
| 10 | 30 | 5.4 GB | ~1.6 TB |

Calculation: 500 kbps × 86400 s/day = 5.4 GB/agent/day.

The cleanup-service deletes segments older than `RETENTION_DAYS` (default 30) every hour. Adjust in `.env`.

### Using a Separate Disk

Mount the target disk to a directory (e.g. `/data/recordings`) and update `docker-compose.yml`:

```yaml
volumes:
  recordings:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /data/recordings
```

---

## Backup

### Database

```bash
docker compose exec postgres pg_dump -U recording recordings > backup_$(date +%Y%m%d).sql
```

### Recordings

Use `rsync` or any file backup tool on the recordings directory. The `.ts` files are self-contained — each 60-second segment can be played independently.

---

## Production Checklist

- [ ] Change `POSTGRES_PASSWORD` in `.env`
- [ ] Mount recordings volume to a dedicated large disk
- [ ] Set a firewall rule: only trusted IP ranges can reach ports 80, 8554, 8889
- [ ] Configure log rotation (`docker compose logs` can grow large)
- [ ] Set up a cron job or monitoring alert if disk usage exceeds 80%
- [ ] Consider running Traefik with HTTPS (add a certificate resolver to `docker-compose.yml`)

---

## Troubleshooting

### `docker compose up` fails on PostgreSQL

The init script (`postgres/init.sql`) runs only on first start. If the `postgres_data` volume already exists from a failed previous run:

```bash
docker compose down -v            # deletes the volume — data will be lost
docker compose up --build
```

### ingest-service not receiving segments

1. Confirm port 80 is reachable from the agent machine: `curl http://<server>/ingest/health`
2. Check Traefik routing: `docker compose logs traefik`
3. Check ingest-service logs: `docker compose logs ingest-service`

### mediamtx not receiving RTSP stream

1. Confirm port 8554 is reachable: `curl -v telnet://<server>:8554`
2. Check agent `appsettings.json` — `MediaServerUrl` must point to this server on port 8554
3. Review `docker compose logs mediamtx`
