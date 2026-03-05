# Agent Setup

The Windows Agent is a background Windows Service that captures the screen 24/7 and uploads recordings to the server. It ships as a single self-contained installer (`RecordingAgentSetup.exe`).

---

## Requirements

| Requirement | Minimum |
|-------------|---------|
| OS | Windows 10 / Windows Server 2019 or later |
| CPU | Any modern x64 processor (hardware H.264 encoding is not required) |
| RAM | 256 MB free |
| Disk | 6 GB free on the system drive (24-hour local buffer) |
| Network | TCP access to the server on port 80 and port 8554 |
| .NET runtime | **Not required** — the installer bundles a self-contained .NET 8 runtime |
| FFmpeg | **Not required** — `ffmpeg.exe` is bundled inside the installer |
| Admin rights | Required for installation only |

---

## Installation

### Step 1 — Run the installer

Double-click `RecordingAgentSetup.exe` and click through the wizard:

**Server Configuration page:**

| Field | Example | Notes |
|-------|---------|-------|
| Recording Server URL | `http://192.168.1.10` | The server running Docker Compose |
| Media Server URL | `rtsp://192.168.1.10:8554` | mediamtx RTSP address (same host, port 8554) |
| Agent ID | *(leave empty)* | Defaults to the machine's computer name |

Click **Next**, then **Install**.

### Step 2 — Verify

The agent starts automatically after the installer finishes. Open Task Manager → Details and confirm `RecordingAgent.exe` is running.

The installer also adds the agent to **Windows Startup** (HKCU Run key) so it restarts automatically after every login.

### Step 3 — Confirm on the server

Within 30 seconds the agent should appear in the client Dashboard. If it does not, check [Troubleshooting](#troubleshooting) below.

---

## Uninstall

Use **Add or Remove Programs** → *Recording Agent* → Uninstall.

The uninstaller stops the agent process, removes all installed files, and removes the Startup registry entry. The local buffer directory (`C:\ProgramData\RecordingAgent\`) is **not** deleted — remove it manually if you want to reclaim disk space.

---

## Manual Configuration

All settings live in:

```
C:\Program Files\RecordingAgent\appsettings.json
```

Edit this file and restart the agent (`taskkill /IM RecordingAgent.exe /F && start "" "C:\Program Files\RecordingAgent\RecordingAgent.exe"`) to apply changes.

```json
{
  "Agent": {
    "AgentId":                "WORKSTATION-01",
    "ServerUrl":              "http://192.168.1.10",
    "MediaServerUrl":         "rtsp://192.168.1.10:8554",
    "BufferPath":             "C:\\ProgramData\\RecordingAgent\\buffer",
    "FfmpegPath":             "C:\\Program Files\\RecordingAgent\\ffmpeg.exe",
    "TargetFps":              10,
    "BufferHours":            24,
    "SegmentDurationSeconds": 60,
    "VideoBitrateKbps":       500
  },
  "Logging": {
    "LogLevel": {
      "Default": "Information"
    }
  }
}
```

| Key | Default | Notes |
|-----|---------|-------|
| `AgentId` | `""` (uses `Environment.MachineName`) | Must be unique across all agents |
| `ServerUrl` | set by installer | Base URL of the server, no trailing slash |
| `MediaServerUrl` | set by installer | RTSP base URL of mediamtx |
| `BufferPath` | `C:\ProgramData\RecordingAgent\buffer` | Local buffer root; needs ~6 GB free |
| `FfmpegPath` | set by installer | Full path to `ffmpeg.exe` |
| `TargetFps` | `10` | Frames per second; higher = more CPU + disk |
| `BufferHours` | `24` | Hours to keep locally before deletion |
| `SegmentDurationSeconds` | `60` | Length of each uploaded `.ts` file |
| `VideoBitrateKbps` | `500` | H.264 target bitrate; 500 kbps ≈ 3.75 MB/min |

---

## Local Buffer

The agent keeps a rolling 24-hour buffer locally, independent of the server:

```
C:\ProgramData\RecordingAgent\buffer\
  index.db                    ← SQLite: segment index
  segments\
    20260305_143000.ts
    20260305_143100.ts
    ...
```

**What happens when the network is down:** segments accumulate in the buffer and are uploaded in order as soon as connectivity is restored. The Upload thread retries each segment up to 4 times with exponential backoff (2 s, 4 s, 8 s, 16 s).

**What happens when the buffer fills up:** the Cleanup thread deletes the oldest segment to make room, even if it has not been uploaded yet. A `WARNING` is written to the Windows Event Log in this case.

---

## Building the Installer

If you need to build `RecordingAgentSetup.exe` from source:

**Prerequisites on the build machine:**
- Windows 10 or later
- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)
- [Inno Setup 6](https://jrsoftware.org/isdl.php)
- Internet access (first build downloads FFmpeg, ~80 MB)

```powershell
cd installer
.\build.ps1
# Output: installer\dist\RecordingAgentSetup.exe

# Skip FFmpeg download if tools\ffmpeg.exe already exists:
.\build.ps1 -SkipFfmpegDownload
```

The script:
1. Runs `dotnet publish --self-contained win-x64` on the agent project
2. Downloads FFmpeg essentials (ffmpeg.exe + ffprobe.exe) into `installer\tools\`
3. Compiles `setup.iss` with Inno Setup → `installer\dist\RecordingAgentSetup.exe`

---

## Troubleshooting

### Agent not appearing in the Dashboard

1. Check that the agent is running: `tasklist | findstr RecordingAgent`
2. Verify `ServerUrl` in `appsettings.json` is reachable: `curl http://<server>/api/agents`
3. Check Windows Firewall — the agent needs outbound TCP on port 80 and 8554
4. Review the Windows Event Log → Application for errors from `RecordingAgent`

### Black screen / no video in Live View

1. The RTSP stream goes directly from the agent to mediamtx. Verify mediamtx is running: `docker compose ps` on the server.
2. Confirm `MediaServerUrl` in `appsettings.json` points to the mediamtx host on port 8554.
3. Some RDP sessions block DXGI capture. The agent must run in the console session (logged-in desktop), not a pure RDP session with no local display.

### High CPU usage

Lower `TargetFps` (e.g. `5`) or `VideoBitrateKbps` (e.g. `300`) in `appsettings.json`.

### Segments not uploading

Check connectivity to the server and review the Windows Event Log for upload errors. The Upload thread logs each retry attempt.
