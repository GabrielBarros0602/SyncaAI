import { daysFrom, mondayOf, stamp, weekdayName } from "../lib/time";
import { cx } from "../lib/cx";
import styles from "./Week.module.css";

/**
 * What is on screen before the session is known.
 *
 * Deliberately not the login screen and not a spinner in the middle of nothing. The shape
 * of the week is already true — seven days exist regardless of who is signed in — so it is
 * drawn, and only the numbers are withheld. A user who is signed in never sees the
 * signed-out interface, not even for a frame (ADR-0021).
 */
export function WeekSkeleton(): React.ReactNode {
  const days = daysFrom(mondayOf(new Date()));

  return (
    <div className={styles.frame} aria-busy="true">
      <div className={styles.chrome}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
          <span className={styles.wordmark}>SyncaAI</span>
          <span className={styles.meta}>checking session</span>
        </div>
        <span className={cx(styles.shellBar, "skeleton")} style={{ width: 150 }} />
      </div>
      <div className={styles.summary}>
        <span className={cx(styles.shellBar, "skeleton")} style={{ width: 280 }} />
        <span className={styles.hint} role="status">
          nothing renders until the session is known
        </span>
      </div>
      <div className={styles.grid}>
        {days.map((day, index) => (
          <div key={day.toISOString()} className={styles.day}>
            <div className={styles.head}>
              <span className={styles.dayIndex}>{String(index + 1).padStart(2, "0")}</span>
              <div className={styles.weekday} style={{ color: "var(--faint)" }}>
                {weekdayName(index + 1)}
              </div>
              <div className={styles.date}>{stamp(day)}</div>
              <div className={styles.shellFree}>&#8212;</div>
              <div
                className={cx(styles.shellBar, "skeleton")}
                style={{ marginTop: 22, height: 3 }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
