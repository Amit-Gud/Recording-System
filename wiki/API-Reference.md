# API Reference

All HTTP endpoints are exposed through the Traefik gateway on port **80**. No authentication is required — access is controlled at the network level.

Base URL: `http://<server>/`

Timestamps are **ISO 8601 / RFC 3339** in UTC, e.g. `2026-03-05T14:30:00Z`.

---

## Ingest API

Used by Windows agents to register and upload segments.

### `POST /ingest/register`

Agent heartbeat. Called on startup and periodically to update `last_seen`.

**Request body** (`application/json`):

```json
{
  "agent_id": "WORKSTATION-01",
  "hostname": "WORKSTATION-01",
  "ip":       "192.168.1.55"
}
```

**Response** `200 OK`:

```json
{ "status": "ok" }
```

---

### `POST /ingest/segment`

Upload a 60-second `.ts` segment.

**Request** (`multipart/form-data`):

| Field | Type | Description |
|-------|------|-------------|
| `agent_id` | string | Agent identifier |
| `start_time` | string | ISO-8601 UTC, segment start |
| `end_time` | string | ISO-8601 UTC, segment end |
| `segment` | file | MPEG-TS binary data (`.ts`) |

**Response** `201 Created`:

```json
{
  "segment_id": 4271,
  "file_path":  "/recordings/WORKSTATION-01/2026-03-05/segment_143000.ts"
}
```

**After successful upload**, ingest-service publishes a NATS event to `segments.uploaded`:

```json
{
  "agent_id":   "WORKSTATION-01",
  "start_time": "2026-03-05T14:30:00Z",
  "end_time":   "2026-03-05T14:31:00Z",
  "file_path":  "/recordings/WORKSTATION-01/2026-03-05/segment_143000.ts",
  "file_size":  3932160
}
```

---

## Metadata API

Used by the client to browse agents and sessions.

### `GET /api/agents`

List all registered agents with online/offline status.

**Response** `200 OK`:

```json
[
  {
    "agent_id":      "WORKSTATION-01",
    "hostname":      "WORKSTATION-01",
    "ip":            "192.168.1.55",
    "last_seen":     "2026-03-05T14:31:45Z",
    "registered_at": "2026-02-01T08:00:00Z",
    "online":        true
  }
]
```

> `online` is `true` if `last_seen` is within the last 90 seconds.

---

### `GET /api/sessions`

List dates that have at least one recording segment for an agent.

**Query parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `agent_id` | yes | Agent identifier |

**Response** `200 OK`:

```json
["2026-03-03", "2026-03-04", "2026-03-05"]
```

Dates are in `YYYY-MM-DD` format, sorted ascending.

---

### `GET /api/segments`

List segments within a time range for an agent.

**Query parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `agent_id` | yes | Agent identifier |
| `start` | yes | ISO-8601 UTC — range start (inclusive) |
| `end` | yes | ISO-8601 UTC — range end (inclusive) |

**Response** `200 OK`:

```json
[
  {
    "id":         4271,
    "agent_id":   "WORKSTATION-01",
    "start_time": "2026-03-05T14:30:00Z",
    "end_time":   "2026-03-05T14:31:00Z",
    "file_path":  "/recordings/WORKSTATION-01/2026-03-05/segment_143000.ts",
    "file_size":  3932160,
    "created_at": "2026-03-05T14:31:02Z"
  }
]
```

---

## Replay API

Used by the client HLS player.

### `GET /hls/{agent_id}/{date}/playlist.m3u8`

Returns an HLS playlist for the given agent and date.

**Path parameters:**

| Parameter | Description |
|-----------|-------------|
| `agent_id` | Agent identifier |
| `date` | `YYYY-MM-DD` |

**Response** `200 OK` (`application/vnd.apple.mpegurl`):

```
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:60
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:60.0,
segment_143000.ts
#EXTINF:60.0,
segment_143100.ts
...
#EXT-X-ENDLIST
```

**Response** `404 Not Found` — no recordings exist for that agent/date.

---

### `GET /hls/{agent_id}/{date}/{segment}.ts`

Serve a single `.ts` segment file.

**Response** `200 OK` (`video/MP2T`) — binary MPEG-TS data.

---

## Bookmarks API

### `POST /api/bookmarks`

Create a bookmark.

**Request body** (`application/json`):

```json
{
  "agent_id":  "WORKSTATION-01",
  "timestamp": "2026-03-05T14:30:47Z",
  "label":     "Suspicious activity — user opened unknown file"
}
```

**Response** `201 Created`:

```json
{
  "id":         83,
  "agent_id":   "WORKSTATION-01",
  "timestamp":  "2026-03-05T14:30:47Z",
  "label":      "Suspicious activity — user opened unknown file",
  "created_at": "2026-03-05T14:30:49Z"
}
```

---

### `GET /api/bookmarks`

Query bookmarks for an agent within a time range.

**Query parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `agent_id` | yes | Agent identifier |
| `start` | yes | ISO-8601 UTC — range start (inclusive) |
| `end` | yes | ISO-8601 UTC — range end (inclusive) |

**Example:**

```
GET /api/bookmarks?agent_id=WORKSTATION-01&start=2026-03-05T00:00:00Z&end=2026-03-05T23:59:59Z
```

**Response** `200 OK`:

```json
[
  {
    "id":         83,
    "agent_id":   "WORKSTATION-01",
    "timestamp":  "2026-03-05T14:30:47Z",
    "label":      "Suspicious activity — user opened unknown file",
    "created_at": "2026-03-05T14:30:49Z"
  }
]
```

Results are sorted by `timestamp` ascending.

---

### `DELETE /api/bookmarks/{id}`

Delete a bookmark by ID.

**Response** `204 No Content` on success.

**Response** `404 Not Found` if the bookmark does not exist.

---

## Error Responses

All services return errors in the same format:

```json
{
  "error": "segment not found"
}
```

| Status | Meaning |
|--------|---------|
| `400` | Bad request — missing or invalid parameter |
| `404` | Resource not found |
| `500` | Internal server error — check service logs |

---

## WebRTC (mediamtx)

Live view uses the **WHEP** (WebRTC-HTTP Egress Protocol) standard supported by mediamtx.

### `POST /{agent_id}/whep`

**Host:** mediamtx, port **8889** (not through Traefik).

**Request body:** SDP offer (`Content-Type: application/sdp`)

**Response** `201 Created`: SDP answer (`Content-Type: application/sdp`)

The client creates an `RTCPeerConnection`, generates an offer, POSTs it to this endpoint, and uses the response as the remote description. Tracks arrive via `pc.ontrack`.

Example URL: `http://192.168.1.10:8889/WORKSTATION-01/whep`
