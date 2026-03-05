# Client Setup

The client is a Windows desktop application built with **React** (UI) and **Tauri** (native shell). It can also run as a plain web page in any modern browser for development.

---

## Requirements

### To run the built application

| Requirement | Notes |
|-------------|-------|
| Windows 10 or later | Tauri uses WebView2 (Chromium-based, pre-installed on Win 10/11) |
| Network access | TCP port 80 (API + HLS) and port 8889 (WebRTC) on the server |

### To build from source

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 20 LTS or later | JavaScript runtime |
| npm | 10 or later | Package manager (bundled with Node) |
| Rust + Cargo | 1.77 or later | Tauri shell compilation |
| Visual Studio Build Tools | 2022 (C++ workload) | Required by Tauri on Windows |

Install Rust: `winget install Rustlang.Rustup` then `rustup default stable`

---

## Configuration

```bash
cd client
cp .env.example .env
```

Edit `.env`:

```env
# Base URL of the server Docker stack
VITE_API_BASE_URL=http://192.168.1.10

# mediamtx WebRTC endpoint (for live thumbnails and Live View)
VITE_MEDIA_SERVER_URL=http://192.168.1.10:8889
```

> The `.env` file is read at **build time** — rebuild after changes.

---

## Development

```bash
cd client
npm install
npm run tauri dev
```

This starts:
- Vite dev server on `localhost:1420` with hot-reload
- Tauri native window pointing to the dev server

**API proxy** — the Vite dev server proxies `/api`, `/hls`, and `/ingest` to `localhost:80` so you can point `VITE_API_BASE_URL` to an empty string during local dev and run the server stack locally.

**Browser-only dev** (no Tauri, no Rust required):

```bash
npm run dev
# Open http://localhost:1420
```

---

## Building

```bash
cd client
npm run tauri build
```

This produces a Windows installer (`.msi` or `.exe`) in:

```
client/src-tauri/target/release/bundle/
  msi/     RecordingSystem_1.0.0_x64_en-US.msi
  nsis/    RecordingSystem_1.0.0_x64-setup.exe
```

Deploy either installer file to Windows machines.

> First build downloads Rust dependencies and compiles Tauri — expect 5–10 minutes. Subsequent builds are faster.

---

## Screens

### Dashboard

The entry screen. Shows a grid of all registered agents with:
- Live WebRTC thumbnail (muted, 16:9, best-effort)
- Online (green dot, animated) / Offline (red dot) status
- **Live View** button — opens the agent's live stream
- **Sessions** button — opens the session calendar
- **Bookmarks** header button — opens the global bookmark list

Agent list auto-refreshes every 10 seconds.

### Live View

Full-screen WebRTC stream from a single agent.

| Control | Action |
|---------|--------|
| **← Back** | Return to Dashboard |
| **Go to Replay** | Open today's replay for this agent |
| **Bookmarks** | Toggle the bookmarks sidebar |
| **+ Bookmark** | Open Add Bookmark dialog |
| **B** key | Open Add Bookmark dialog (shortcut) |

Bookmarks created here are saved with the current UTC timestamp.

### Replay Player

HLS playback with full seek control.

| Control | Action |
|---------|--------|
| Scrubber | Seek to any position in the day |
| Yellow dots on scrubber | Bookmark positions — click to jump |
| ▶ / ⏸ button | Play / Pause |
| **Space** | Play / Pause (keyboard shortcut) |
| Speed button | Cycle through 0.5×, 1×, 1.5×, 2×, 4×, 8× |
| **B** key | Add bookmark at current position |
| **Bookmarks** | Toggle sidebar list |

Deep-link to a specific moment: `/replay/{agentId}/{date}?t=2026-03-05T14:30:00Z`

### Session Browser

Left panel: calendar showing dots on days with recordings. Click a day to load the timeline.

Right panel: 24-hour track showing:
- **Blue bars** — recorded segments (click to jump to that segment in Replay)
- **Yellow pins** — bookmarks (click to jump to that moment in Replay)
- **Bookmark list** — scrollable list of bookmarks for the selected day

### All Bookmarks

Global list across all agents, sorted newest first. Each row shows agent, timestamp, and label. Click to open the Replay Player at that exact moment.

---

## System Tray

The Tauri shell adds a system tray icon. Closing the window hides it to the tray instead of exiting.

| Action | Result |
|--------|--------|
| Left-click tray icon | Show / focus the window |
| Right-click → Show | Show / focus the window |
| Right-click → Quit | Fully exit the application |

---

## Troubleshooting

### Blank screen / API errors

- Confirm `VITE_API_BASE_URL` in `.env` is set correctly and the server is reachable
- Open DevTools (`F12`) → Console for error details

### Live thumbnails not loading

- WebRTC thumbnails use the `VITE_MEDIA_SERVER_URL` (port 8889). Confirm mediamtx is running and reachable.
- If the agent is offline, the thumbnail shows "Offline" — this is expected.

### HLS playback fails

- The Replay Player fetches `/hls/{agentId}/{date}/playlist.m3u8` through the API gateway. Confirm the replay-service is running: `docker compose logs replay-service`
- Confirm segments exist for the requested date: `GET /api/segments?agent_id=...&start=...&end=...`

### WebView2 not found

Install WebView2 runtime: download the Evergreen bootstrapper from the Microsoft website. On Windows 11 it is pre-installed.
