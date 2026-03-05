// ─────────────────────────────────────────────────────────────────────────────
// REST API client — thin wrappers around fetch()
// All paths are relative so the Vite dev-proxy and Tauri production URL
// (set via VITE_API_BASE_URL) both work transparently.
// ─────────────────────────────────────────────────────────────────────────────

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function del(path: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`DELETE ${path} → ${res.status}`);
}

// ── Agents ────────────────────────────────────────────────────────────────────

export interface Agent {
  agent_id: string;
  hostname: string;
  ip: string;
  last_seen: string; // ISO-8601
  online: boolean;
}

export const listAgents = () => get<Agent[]>("/api/agents");

// ── Sessions ──────────────────────────────────────────────────────────────────

/** Returns array of date strings "YYYY-MM-DD" that have recordings. */
export const listSessionDates = (agentId: string) =>
  get<string[]>(`/api/sessions?agent_id=${encodeURIComponent(agentId)}`);

// ── Segments ──────────────────────────────────────────────────────────────────

export interface Segment {
  id: number;
  agent_id: string;
  start_time: string;
  end_time: string;
  file_path: string;
  file_size: number;
}

export const listSegments = (agentId: string, start: string, end: string) =>
  get<Segment[]>(
    `/api/segments?agent_id=${encodeURIComponent(agentId)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
  );

// ── HLS ───────────────────────────────────────────────────────────────────────

/** Full URL to the HLS playlist for a given agent+date. */
export const hlsPlaylistUrl = (agentId: string, date: string) =>
  `${BASE}/hls/${encodeURIComponent(agentId)}/${date}/playlist.m3u8`;

// ── Bookmarks ─────────────────────────────────────────────────────────────────

export interface Bookmark {
  id: number;
  agent_id: string;
  timestamp: string; // ISO-8601
  label: string;
  created_at: string;
}

export const createBookmark = (agentId: string, timestamp: string, label: string) =>
  post<Bookmark>("/api/bookmarks", { agent_id: agentId, timestamp, label });

export const listBookmarks = (agentId: string, start: string, end: string) =>
  get<Bookmark[]>(
    `/api/bookmarks?agent_id=${encodeURIComponent(agentId)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
  );

export const deleteBookmark = (id: number) => del(`/api/bookmarks/${id}`);

// ── WebRTC (mediamtx) ─────────────────────────────────────────────────────────

const MEDIA_BASE =
  (import.meta.env.VITE_MEDIA_SERVER_URL as string | undefined) ?? "http://localhost:8889";

/** WebRTC WHEP endpoint for live view (mediamtx convention). */
export const webrtcUrl = (agentId: string) =>
  `${MEDIA_BASE}/${encodeURIComponent(agentId)}/whep`;
