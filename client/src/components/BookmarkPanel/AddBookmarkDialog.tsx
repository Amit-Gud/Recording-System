import { useEffect, useRef, useState } from "react";
import styles from "./BookmarkPanel.module.css";

interface Props {
  onSave: (label: string) => Promise<void>;
  onCancel: () => void;
}

export default function AddBookmarkDialog({ onSave, onCancel }: Props) {
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return;
    setSaving(true);
    try {
      await onSave(label.trim());
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.dialogTitle}>Add Bookmark</h2>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <input
            ref={inputRef}
            className={styles.dialogInput}
            type="text"
            placeholder="Bookmark label…"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={200}
          />
          <div className={styles.dialogActions}>
            <button type="button" className={styles.cancelBtn} onClick={onCancel}>
              Cancel
            </button>
            <button
              type="submit"
              className={styles.saveBtn}
              disabled={!label.trim() || saving}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
