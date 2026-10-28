import { dayMonth, daysFrom, weekdayLong } from "../lib/time";
import day from "./Day.module.css";
import page from "./WeekScreen.module.css";

interface Props {
  /** The week that could not be read. */
  monday: Date;
  onRetry: () => void;
}

/**
 * The week when the server could not be reached.
 *
 * Every day reads `—` rather than a number. Showing the last figures that were fetched
 * would be worse than showing none: a stale free-minutes count is a number somebody will
 * plan against, and it is wrong in the direction that overbooks.
 */
export function WeekUnreachable({ monday, onRetry }: Props): React.ReactNode {
  return (
    <>
      <div className={day.problem} role="alert">
        <div>
          <p className={day.problemHead}>Couldn&rsquo;t reach the server.</p>
          <p className={day.problemNote}>No minutes are shown rather than stale ones.</p>
        </div>
        <button type="button" className={day.retry} onClick={onRetry}>
          retry
        </button>
      </div>
      <div className={page.grid}>
        {daysFrom(monday).map((date, index) => (
          <div key={date.toISOString()} className={day.day}>
            <div className={day.head}>
              <div className={day.name}>
                <span className={day.weekday}>{weekdayLong(index + 1)}</span>
                <span className={day.date}>{dayMonth(date)}</span>
              </div>
              <span className={day.bookedValue}>&#8212;</span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
