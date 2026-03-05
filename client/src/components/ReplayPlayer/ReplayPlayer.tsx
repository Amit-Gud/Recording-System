import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { hlsPlaylistUrl, listBookmarks, createBookmark, type Bookmark } from "../../services/api";
import { HlsPlayer } from "../../services/hlsPlayer";
import BookmarkPanel from "../BookmarkPanel/BookmarkPanel";
import AddBookmarkDialog from "../BookmarkPanel/AddBookmarkDialog";
import styles from "./ReplayPlayer.module.css";

const SPEEDS = [0.5, 1, 1.5, 2, 4, 8];

function fmt(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

export default function ReplayPlayer() {
  const { agentId = "", date = "" } = useParams<{ agentId: string; date: string }>();
  const [searchParams] = useSearchParams();
  const navigate       = useNavigate();

  const videoRef    = useRef<HTMLVideoElement>(null);
  const hlsRef      = useRef(new HlsPlayer());
  const scrubRef    = useRef<HTMLInputElement>(null);

  const [duration, setDuration]         = useState(0);
  const [currentTime, setCurrentTime]   = useState(0);
  const [playing, setPlaying]           = useState(true);
  const [speedIdx, setSpeedIdx]         = useState(1);       // index into SPEEDS
  const [bookmarks, setBookmarks]       = useState<Bookmark[]>([]);
  const [showPanel, setShowPanel]       = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [hlsError, setHlsError]         = useState<string | null>(null);

  // ── Load HLS ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current!;
    const hls   = hlsRef.current;

    hls.attach(video, hlsPlaylistUrl(agentId, date), {
      onError:          (d) => setHlsError(d),
      onDurationChange: (d) => setDuration(d),
    });

    // Jump to timestamp from query param (?t=ISO or ?t=seconds)
    const jumpTo = searchParams.get("t");
    if (jumpTo) {
      const dayStart = new Date(`${date}T00:00:00Z`).getTime() / 1000;
      const targetTs = isNaN(Number(jumpTo))
        ? new Date(jumpTo).getTime() / 1000 - dayStart
        : Number(jumpTo);
      video.addEventListener("loadedmetadata", () => hls.seekTo(targetTs), { once: true });
    }

    return () => hls.detach();
  }, [agentId, date, searchParams]);

  // ── Sync scrubber ─────────────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current!;
    const onTime = () => setCurrentTime(video.currentTime);
    const onPlay  = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("play",  onPlay);
    video.addEventListener("pause", onPause);
    return () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("play",  onPlay);
      video.removeEventListener("pause", onPause);
    };
  }, []);

  // ── Bookmarks ─────────────────────────────────────────────────────────────
  const loadBookmarks = useCallback(async () => {
    try {
      const bms = await listBookmarks(agentId, `${date}T00:00:00Z`, `${date}T23:59:59Z`);
      setBookmarks(bms);
    } catch { /* non-fatal */ }
  }, [agentId, date]);

  useEffect(() => { void loadBookmarks(); }, [loadBookmarks]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (e.key === "b" || e.key === "B") setShowAddDialog(true);
      if (e.key === " ") {
        e.preventDefault();
        videoRef.current?.paused ? void videoRef.current.play() : videoRef.current?.pause();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const togglePlay = () => {
    const v = videoRef.current!;
    v.paused ? void v.play() : v.pause();
  };

  const cycleSpeed = () => {
    const next = (speedIdx + 1) % SPEEDS.length;
    setSpeedIdx(next);
    hlsRef.current.setPlaybackRate(SPEEDS[next]);
  };

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = Number(e.target.value);
    hlsRef.current.seekTo(t);
    setCurrentTime(t);
  };

  const handleBookmarkSave = async (label: string) => {
    const dayStart = new Date(`${date}T00:00:00Z`).getTime() / 1000;
    const ts = new Date((dayStart + currentTime) * 1000).toISOString();
    await createBookmark(agentId, ts, label);
    await loadBookmarks();
    setShowAddDialog(false);
  };

  // Convert bookmark ISO timestamp to seconds from day start
  const dayStartSec = new Date(`${date}T00:00:00Z`).getTime() / 1000;
  const bmPositions = bookmarks.map((bm) => ({
    ...bm,
    position: new Date(bm.timestamp).getTime() / 1000 - dayStartSec,
  }));

  return (
    <div className={styles.root}>
      {/* ── Top bar ────────────────────────────────────────────────────────── */}
      <header className={styles.bar}>
        <button className={styles.back} onClick={() => navigate(-1)}>← Back</button>
        <span className={styles.title}>
          {agentId} — {date}
        </span>
        <div className={styles.barActions}>
          <button
            className={showPanel ? styles.active : ""}
            onClick={() => setShowPanel((v) => !v)}
          >
            Bookmarks
          </button>
          <button onClick={() => setShowAddDialog(true)} title="Press B">
            + Bookmark
          </button>
        </div>
      </header>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className={styles.body}>
        <div className={styles.playerWrap}>
          {hlsError && <div className={styles.error}>{hlsError}</div>}

          <video
            ref={videoRef}
            autoPlay
            playsInline
            className={styles.video}
          />

          {/* ── Controls ─────────────────────────────────────────────────── */}
          <div className={styles.controls}>
            {/* Timeline scrubber */}
            <div className={styles.timelineWrap}>
              <input
                ref={scrubRef}
                type="range"
                className={styles.scrubber}
                min={0}
                max={duration || 1}
                step={0.5}
                value={currentTime}
                onChange={handleScrub}
              />
              {/* Bookmark markers on the timeline */}
              {bmPositions.map((bm) =>
                duration > 0 ? (
                  <div
                    key={bm.id}
                    className={styles.bmMarker}
                    style={{ left: `${(bm.position / duration) * 100}%` }}
                    title={bm.label}
                    onClick={() => hlsRef.current.seekTo(bm.position)}
                  />
                ) : null
              )}
            </div>

            <div className={styles.controlRow}>
              <button className={styles.playBtn} onClick={togglePlay}>
                {playing ? "⏸" : "▶"}
              </button>
              <span className={styles.time}>
                {fmt(currentTime)} / {fmt(duration)}
              </span>
              <button className={styles.speedBtn} onClick={cycleSpeed}>
                {SPEEDS[speedIdx]}×
              </button>
            </div>
          </div>
        </div>

        {showPanel && (
          <BookmarkPanel
            agentId={agentId}
            start={`${date}T00:00:00Z`}
            end={`${date}T23:59:59Z`}
            onJump={(ts) => {
              const pos = new Date(ts).getTime() / 1000 - dayStartSec;
              hlsRef.current.seekTo(pos);
            }}
            refreshKey={bookmarks.length}
          />
        )}
      </div>

      {showAddDialog && (
        <AddBookmarkDialog
          onSave={handleBookmarkSave}
          onCancel={() => setShowAddDialog(false)}
        />
      )}
    </div>
  );
}
