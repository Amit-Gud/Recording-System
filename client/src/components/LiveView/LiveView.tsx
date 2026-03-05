import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { webrtcUrl, createBookmark } from "../../services/api";
import BookmarkPanel from "../BookmarkPanel/BookmarkPanel";
import AddBookmarkDialog from "../BookmarkPanel/AddBookmarkDialog";
import styles from "./LiveView.module.css";

export default function LiveView() {
  const { agentId = "" } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const videoRef  = useRef<HTMLVideoElement>(null);
  const pcRef     = useRef<RTCPeerConnection | null>(null);

  const [connected, setConnected]           = useState(false);
  const [error, setError]                   = useState<string | null>(null);
  const [showBookmarks, setShowBookmarks]   = useState(false);
  const [showAddDialog, setShowAddDialog]   = useState(false);

  // ── WebRTC connection ──────────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current!;
    let active = true;

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    pcRef.current = pc;

    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });

    pc.ontrack = (e) => {
      if (active && video.srcObject !== e.streams[0]) {
        video.srcObject = e.streams[0];
        setConnected(true);
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "disconnected") {
        if (active) setError("Connection to agent lost.");
      }
    };

    void (async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const res = await fetch(webrtcUrl(agentId), {
          method: "POST",
          headers: { "Content-Type": "application/sdp" },
          body: offer.sdp,
        });

        if (!res.ok) throw new Error(`mediamtx responded ${res.status}`);

        const sdp = await res.text();
        await pc.setRemoteDescription({ type: "answer", sdp });
      } catch (e) {
        if (active) setError(String(e));
      }
    })();

    return () => {
      active = false;
      pc.close();
      pcRef.current = null;
    };
  }, [agentId]);

  // ── Keyboard shortcut: B = bookmark ───────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "b" || e.key === "B") {
        setShowAddDialog(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleBookmarkSave = async (label: string) => {
    await createBookmark(agentId, new Date().toISOString(), label);
    setShowAddDialog(false);
  };

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className={styles.root}>
      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <header className={styles.bar}>
        <button className={styles.back} onClick={() => navigate(-1)}>← Back</button>
        <span className={styles.title}>{agentId} — Live</span>
        <div className={styles.barActions}>
          <button onClick={() => navigate(`/replay/${encodeURIComponent(agentId)}/${today}`)}>
            Go to Replay
          </button>
          <button
            className={showBookmarks ? styles.active : ""}
            onClick={() => setShowBookmarks((v) => !v)}
          >
            Bookmarks
          </button>
          <button onClick={() => setShowAddDialog(true)} title="Press B to bookmark">
            + Bookmark
          </button>
        </div>
      </header>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <div className={styles.body}>
        <div className={styles.playerWrap}>
          {error && <div className={styles.error}>{error}</div>}
          {!connected && !error && <div className={styles.spinner}>Connecting…</div>}
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className={styles.video}
          />
        </div>

        {showBookmarks && (
          <BookmarkPanel
            agentId={agentId}
            start={`${today}T00:00:00Z`}
            end={`${today}T23:59:59Z`}
            onJump={(ts) =>
              navigate(`/replay/${encodeURIComponent(agentId)}/${today}?t=${encodeURIComponent(ts)}`)
            }
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
