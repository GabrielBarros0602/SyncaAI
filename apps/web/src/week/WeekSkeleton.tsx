import { dayMonth, daysFrom, mondayOf, weekRange, weekdayLong } from "../lib/time";
import { cx } from "../lib/cx";
import day from "./Day.module.css";
import page from "./WeekScreen.module.css";

interface Props {
  /** The week on its way; the browser's own week while the session is still unknown. */
  monday?: Date;
}

/**
 * The week while its figures are on their way: before the session is known, and between one
 * week and the next.
 *
 * Deliberately not the login screen and not a spinner in the middle of nothing. The shape
 * of the week is already true — seven days exist regardless of who is signed in — so it is
 * drawn, and only the numbers are withheld. A user who is signed in never sees the
 * signed-out interface, not even for a frame (ADR-0021).
 *
 * The dates are the week being loaded, not this week: after `]` they are next week's, which is
 * what the heading above already says.
 */
export function WeekSkeleton({ monday = mondayOf(new Date()) }: Props): React.ReactNode {
  const dates = daysFrom(monday);

  return (
    <>
      {/* The phone's words for it (day-phone.dc.html); the desktop drawing has no loading
          state of its own. */}
      <p role="status" className={day.loading}>
        Loading {weekRange(monday, dates[6] as Date)}…
      </p>
      <div className={page.grid} aria-busy="true">
        {dates.map((date, index) => (
          <div key={date.toISOString()} className={day.day}>
            <div className={day.head}>
              <div className={day.name}>
                <span className={day.weekday}>{weekdayLong(index + 1)}</span>
                <span className={day.date}>{dayMonth(date)}</span>
              </div>
              <span className={cx(day.placeholder, "skeleton")} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
