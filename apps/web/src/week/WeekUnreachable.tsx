import { daysFrom, mondayOf, stamp, weekdayName } from "../lib/time";
import styles from "./Week.module.css";

interface Props {
  onRetry: () => void;
}

/**
 * The week when the server could not be reached.
 *
 * Every day reads `—` rather than a number. Showing the last figures that were fetched
 * would be worse than showing none: a stale free-minutes count is a number somebody will
 * plan against, and it is wrong in the direction that overbooks.
 */
export function WeekUnreachable({ onRetry }: Props): React.ReactNode {
  const days = daysFrom(mondayOf(new Date()));

  return (
    <div className={styles.frame}>
      <div className={styles.banner} role="alert">
        <div>
          <div className={styles.bannerHead}>Couldn&rsquo;t reach the server.</div>
          <div className={styles.bannerNote}>no minutes shown rather than stale ones</div>
        </div>
        <button type="button" className={styles.retry} onClick={onRetry}>
          <span>retry</span>
          <span className={styles.retryKey}>R</span>
        </button>
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
              <div className={styles.shellNote}>unknown</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
