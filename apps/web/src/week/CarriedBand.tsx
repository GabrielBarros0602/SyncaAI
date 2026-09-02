import { clock, formatMinutes, zonedMinutes } from "../lib/time";
import type { Carried } from "./carried";
import styles from "./Week.module.css";

/**
 * What the day before is still holding, on the day receiving it.
 *
 * Not a task row, and drawn so it cannot be mistaken for one: dimmed, indented behind an
 * arrow, and with no verb on it anywhere. The task belongs to the day it starts on and is
 * listed, counted and acted on there. Repeating the row here was the alternative and it is
 * worse — the count would say five tasks where there are three, and a delete button would
 * sit on half a task.
 *
 * The footer exists because the band otherwise reads as an addition. These minutes are
 * already inside the figure at the top of the column, and a reader who adds them again gets
 * a number that is wrong in the direction that overbooks.
 */
interface Props {
  carried: Carried[];
  /** The weekday every one of these came from. A task cannot cross two midnights — the
   *  CHECK constraint caps it at 1440 minutes — so one day's band has exactly one source. */
  fromWeekday: string;
  timezone: string;
  /** What the day has booked in total, which is what the footer says these are already in. */
  bookedMinutes: number;
  /**
   * Focus the row that owns the task, or null when that row is not on this screen.
   *
   * Null on Monday and only there: its source is the day before the week, which is fetched
   * so the figures are right and never rendered. An offer to go somewhere that does not
   * exist is worse than not offering.
   */
  onGoToOwner: ((taskId: string) => void) | null;
}

export function CarriedBand({
  carried,
  fromWeekday,
  timezone,
  bookedMinutes,
  onGoToOwner,
}: Props): React.ReactNode {
  const total = carried.reduce((sum, entry) => sum + entry.minutes, 0);
  const one = carried.length === 1;

  return (
    <div className={styles.carried}>
      <div className={styles.carriedHead}>
        <span className={styles.carriedArrow} aria-hidden="true">
          ↳
        </span>
        <span className={styles.carriedFrom}>carried from {fromWeekday}</span>
        <span className={styles.carriedTotal}>{formatMinutes(total)} of this day</span>
      </div>

      {carried.map((entry) => (
        <div key={entry.task.id} className={styles.carriedItem}>
          <div className={styles.carriedWhen}>
            <span>
              from {fromWeekday} {clock(zonedMinutes(entry.task.start_at, timezone))}
            </span>
            <span>ends {clock(zonedMinutes(entry.task.end_at, timezone))}</span>
          </div>
          <div className={styles.carriedTitle}>{entry.task.title}</div>
          <div className={styles.carriedFoot}>
            <span className={styles.carriedMinutes}>
              {formatMinutes(entry.minutes)} of this day
            </span>
            {onGoToOwner !== null && (
              <button
                type="button"
                className={styles.carriedGoTo}
                onClick={() => {
                  onGoToOwner(entry.task.id);
                }}
              >
                go to {fromWeekday}
              </button>
            )}
          </div>
        </div>
      ))}

      <p className={styles.carriedNote}>
        {one
          ? `Not this day’s task. Its minutes are already inside the ${formatMinutes(bookedMinutes)} booked above.`
          : `Not this day’s tasks. Their ${formatMinutes(total)} is already inside the ${formatMinutes(bookedMinutes)} booked above.`}
      </p>
    </div>
  );
}
