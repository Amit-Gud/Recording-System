import { useEffect, useState } from "react";
import { listBookmarks, deleteBookmark, type Bookmark } from "../../services/api";
import styles from "./BookmarkPanel.module.css";

interface Props {
  agentId: string;
  start: string;
  end: string;
  onJump: (timestamp: string) => void;
  refreshKey?: number;
}

export default function BookmarkPanel({ agentId, start, end, onJump, refreshKey }: Props) {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    setLoading(true);
    void listBookmarks(agentId, start, end)
      .then(setBookmarks)
      .finally(() => setLoading(false));
  }, [agentId, start, end, refreshKey]);

  const handleDelete = async (id: number) => {
    await deleteBookmark(id);
    setBookmarks((prev) => prev.filter((b) => b.id !== id));
  };

  return (
    <div className={styles.panel}>
      <div className={styles.header}>Bookmarks</div>

      {loading && <p className={styles.info}>Loading…</p>}

      {!loading && bookmarks.length === 0 && (
        <p className={styles.info}>No bookmarks — press B to add one.</p>
      )}

      <ul className={styles.list}>
        {bookmarks.map((bm) => (
          <li key={bm.id} className={styles.item}>
            <button className={styles.jumpBtn} onClick={() => onJump(bm.timestamp)}>
              <span className={styles.time}>{bm.timestamp.slice(11, 19)}</span>
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
  );
}
