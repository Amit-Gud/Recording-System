import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { listAgents, webrtcUrl, type Agent } from "../../services/api";
import styles from "./Dashboard.module.css";

const POLL_MS = 10_000;

export default function Dashboard() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [error, setError]   = useState<string | null>(null);
  const navigate = useNavigate();

  const refresh = useCallback(async () => {
    try {
      setAgents(await listAgents());
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <h1>Recording System</h1>
        <button className={styles.bookmarksBtn} onClick={() => navigate("/bookmarks")}>
          Bookmarks
        </button>
      </header>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.grid}>
        {agents.map((agent) => (
          <AgentCard
            key={agent.agent_id}
            agent={agent}
            onLive={() => navigate(`/live/${encodeURIComponent(agent.agent_id)}`)}
            onSessions={() => navigate(`/sessions/${encodeURIComponent(agent.agent_id)}`)}
          />
        ))}

        {agents.length === 0 && !error && (
          <p className={styles.empty}>Waiting for agents to connect…</p>
        )}
      </div>
    </div>
  );
}

// ── Agent thumbnail card ───────────────────────────────────────────────────────

interface CardProps {
  agent: Agent;
  onLive: () => void;
  onSessions: () => void;
}

function AgentCard({ agent, onLive, onSessions }: CardProps) {
  return (
    <div className={`${styles.card} ${agent.online ? styles.online : styles.offline}`}>
      {/* Live thumbnail — a muted <video> fed by the WebRTC WHEP endpoint */}
      <div className={styles.thumb} onClick={onLive}>
        <WebRtcThumb agentId={agent.agent_id} active={agent.online} />
        <span className={styles.statusDot} />
      </div>

      <div className={styles.info}>
        <span className={styles.hostname} title={agent.ip}>{agent.hostname}</span>
        <span className={styles.status}>{agent.online ? "● Live" : "○ Offline"}</span>
      </div>

      <div className={styles.actions}>
        <button onClick={onLive} disabled={!agent.online}>Live View</button>
        <button onClick={onSessions}>Sessions</button>
      </div>
    </div>
  );
}

// ── Tiny muted WebRTC preview ─────────────────────────────────────────────────

function WebRtcThumb({ agentId, active }: { agentId: string; active: boolean }) {
  useEffect(() => {
    if (!active) return;

    const video = document.getElementById(`thumb-${agentId}`) as HTMLVideoElement | null;
    if (!video) return;

    let pc: RTCPeerConnection | null = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });

    void (async () => {
      try {
        const offer = await pc!.createOffer();
        await pc!.setLocalDescription(offer);

        const res = await fetch(webrtcUrl(agentId), {
          method: "POST",
          headers: { "Content-Type": "application/sdp" },
          body: offer.sdp,
        });
        if (!res.ok) return;

        const answer = await res.text();
        await pc!.setRemoteDescription({ type: "answer", sdp: answer });

        pc!.ontrack = (e) => {
          if (video.srcObject !== e.streams[0]) {
            video.srcObject = e.streams[0];
          }
        };
      } catch {
        // Silently fail — thumbnail is best-effort
      }
    })();

    return () => {
      pc?.close();
      pc = null;
    };
  }, [agentId, active]);

  if (!active) {
    return <div className={styles.offline_placeholder}>Offline</div>;
  }

  return (
    <video
      id={`thumb-${agentId}`}
      autoPlay
      muted
      playsInline
      className={styles.thumbVideo}
    />
  );
}
