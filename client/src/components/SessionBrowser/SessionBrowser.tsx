import { useEffect, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  listSessionDates,
  listSegments,
  listBookmarks,
  type Segment,
  type Bookmark,
} from "../../services/api";
import styles from "./SessionBrowser.module.css";

/** Returns "YYYY-MM" for a Date. */
const ym  = (d: Date) => d.toISOString().slice(0, 7);
/** Returns "YYYY-MM-DD". */
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** All day-strings in a month, Mon-first. */
function monthDays(year: number, month: number): (string | null)[] {
  const first = new Date(Date.UTC(year, month, 1));
  const cells: (string | null)[] = [];
  // Pad with nulls so week starts on Monday (0=Sun → shift)
  const startDow = (first.getDay() + 6) % 7; // 0=Mon
  for (let i = 0; i < startDow; i++) cells.push(null);
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  for (let d = 1; d <= days; d++) {
    cells.push(ymd(new Date(Date.UTC(year, month, d))));
  }
  return cells;
}

export default function SessionBrowser() {
  const { agentId = "" } = useParams<{ agentId: string }>();
  const navigate = useNavigate();

  const today     = new Date();
  const [cursor,  setCursor]    = useState({ year: today.getUTCFullYear(), month: today.getUTCMonth() });
  const [dates,   setDates]     = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);

  // ── Load all dates that have recordings ───────────────────────────────────
  useEffect(() => {
    void listSessionDates(agentId).then((d) => {
      setDates(new Set(d));
      // Auto-select most recent
      if (d.length > 0) setSelected(d[d.length - 1]);
    });
  }, [agentId]);

  // ── Load timeline data for selected date ──────────────────────────────────
  const loadDay = useCallback(async (date: string) => {
    const [segs, bms] = await Promise.all([
      listSegments(agentId, `${date}T00:00:00Z`, `${date}T23:59:59Z`),
      listBookmarks(agentId, `${date}T00:00:00Z`, `${date}T23:59:59Z`),
    ]);
    setSegments(segs);
    setBookmarks(bms);
  }, [agentId]);

  useEffect(() => {
    if (selected) void loadDay(selected);
  }, [selected, loadDay]);

  const prevMonth = () =>
    setCursor(({ year, month }) =>
      month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 }
    );

  const nextMonth = () =>
    setCursor(({ year, month }) =>
      month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 }
    );

  const monthLabel = new Date(Date.UTC(cursor.year, cursor.month, 1))
    .toLocaleString("en-US", { month: "long", year: "numeric" });

  const cells = monthDays(cursor.year, cursor.month);

  return (
    <div className={styles.root}>
      <header className={styles.bar}>
        <button className={styles.back} onClick={() => navigate(-1)}>← Back</button>
        <span className={styles.title}>{agentId} — Sessions</span>
      </header>

      <div className={styles.body}>
        {/* ── Calendar ───────────────────────────────────────────────────── */}
        <div className={styles.calendar}>
          <div className={styles.calHeader}>
            <button onClick={prevMonth}>‹</button>
            <span>{monthLabel}</span>
            <button onClick={nextMonth}>›</button>
          </div>

          <div className={styles.weekRow}>
            {["Mo","Tu","We","Th","Fr","Sa","Su"].map((d) => (
              <span key={d} className={styles.weekDay}>{d}</span>
            ))}
          </div>

          <div className={styles.calGrid}>
            {cells.map((cell, i) => {
              if (!cell) return <span key={i} />;
              const hasRec = dates.has(cell);
              const isSelected = cell === selected;
              return (
                <button
                  key={cell}
                  className={`${styles.day} ${hasRec ? styles.hasRec : ""} ${isSelected ? styles.selectedDay : ""}`}
                  onClick={() => hasRec && setSelected(cell)}
                  disabled={!hasRec}
                >
                  {parseInt(cell.slice(8))}
                  {hasRec && <span className={styles.recDot} />}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Daily timeline ─────────────────────────────────────────────── */}
        <div className={styles.timeline}>
          {selected ? (
            <>
              <div className={styles.timelineHeader}>
                <span>{selected}</span>
                <button
                  className={styles.replayBtn}
                  onClick={() =>
                    navigate(`/replay/${encodeURIComponent(agentId)}/${selected}`)
                  }
                >
                  ▶ Replay Day
                </button>
              </div>

              <DayTimeline
                segments={segments}
                bookmarks={bookmarks}
                onJump={(ts) =>
                  navigate(`/replay/${encodeURIComponent(agentId)}/${selected}?t=${encodeURIComponent(ts)}`)
                }
              />
            </>
          ) : (
            <p className={styles.empty}>Select a day with recordings</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 24-hour timeline bar ──────────────────────────────────────────────────────

function DayTimeline({
  segments,
  bookmarks,
  onJump,
}: {
  segments: Segment[];
  bookmarks: Bookmark[];
  onJump: (ts: string) => void;
}) {
  const TOTAL = 86400; // seconds in a day

  const pct = (iso: string) => {
    const midnight = iso.slice(0, 10) + "T00:00:00Z";
    const offset   = (new Date(iso).getTime() - new Date(midnight).getTime()) / 1000;
    return Math.max(0, Math.min(100, (offset / TOTAL) * 100));
  };

  return (
    <div className={styles.dayTimeline}>
      {/* Hour labels */}
      <div className={styles.hourLabels}>
        {[0, 6, 12, 18, 24].map((h) => (
          <span key={h} style={{ left: `${(h / 24) * 100}%` }}>
            {h === 24 ? "" : `${String(h).padStart(2,"0")}:00`}
          </span>
        ))}
      </div>

      {/* Track */}
      <div className={styles.track}>
        {segments.map((seg) => (
          <div
            key={seg.id}
            className={styles.segment}
            style={{
              left:  `${pct(seg.start_time)}%`,
              width: `${pct(seg.end_time) - pct(seg.start_time)}%`,
            }}
            title={`${seg.start_time.slice(11, 19)} – ${seg.end_time.slice(11, 19)}`}
            onClick={() => onJump(seg.start_time)}
          />
        ))}

        {bookmarks.map((bm) => (
          <div
            key={bm.id}
            className={styles.bmPin}
            style={{ left: `${pct(bm.timestamp)}%` }}
            title={bm.label}
            onClick={() => onJump(bm.timestamp)}
          />
        ))}
      </div>

      {/* Bookmark list */}
      {bookmarks.length > 0 && (
        <ul className={styles.bmList}>
          {bookmarks.map((bm) => (
            <li key={bm.id} onClick={() => onJump(bm.timestamp)}>
              <span className={styles.bmTime}>{bm.timestamp.slice(11, 19)}</span>
              <span className={styles.bmLabel}>{bm.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
