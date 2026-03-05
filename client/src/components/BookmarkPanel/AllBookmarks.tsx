/**
 * Global bookmarks view — shows all bookmarks across all agents,
 * reachable from the Dashboard header.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listAgents, listBookmarks, deleteBookmark, type Bookmark } from "../../services/api";
import styles from "./AllBookmarks.module.css";

export default function AllBookmarks() {
  const navigate = useNavigate();
  const [items, setItems]     = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const agents = await listAgents();
        const now    = new Date().toISOString();
        const epoch  = "1970-01-01T00:00:00Z";
        const all    = await Promise.all(
          agents.map((a) => listBookmarks(a.agent_id, epoch, now))
        );
        const flat = all.flat().sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
        setItems(flat);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleDelete = async (id: number) => {
    await deleteBookmark(id);
    setItems((prev) => prev.filter((b) => b.id !== id));
  };

  const handleJump = (bm: Bookmark) => {
    const date = bm.timestamp.slice(0, 10);
    navigate(
      `/replay/${encodeURIComponent(bm.agent_id)}/${date}?t=${encodeURIComponent(bm.timestamp)}`
    );
  };

  return (
    <div className={styles.root}>
      <header className={styles.bar}>
        <button className={styles.back} onClick={() => navigate(-1)}>← Back</button>
        <span className={styles.title}>All Bookmarks</span>
      </header>

      <div className={styles.content}>
        {loading && <p className={styles.info}>Loading…</p>}

        {!loading && items.length === 0 && (
          <p className={styles.info}>No bookmarks yet.</p>
        )}

        <ul className={styles.list}>
          {items.map((bm) => (
            <li key={bm.id} className={styles.item}>
              <button className={styles.jumpBtn} onClick={() => handleJump(bm)}>
                <span className={styles.agent}>{bm.agent_id}</span>
                <span className={styles.ts}>{bm.timestamp.replace("T", " ").slice(0, 19)}</span>
                <span className={styles.label}>{bm.label}</span>
              </button>
              <button
                className={styles.deleteBtn}
                onClick={() => void handleDelete(bm.id)}
                title="Delete"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
