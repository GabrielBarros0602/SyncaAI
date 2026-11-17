import { dayMonth, daysFrom, mondayOf, weekRange, weekdayDrawn } from "../lib/time";
import { cx } from "../lib/cx";
import { useLayout } from "../lib/useLayout";
import day from "./Day.module.css";
import page from "./WeekScreen.module.css";

interface Props {
  /** The week on its way; the browser's own week while the session is still unknown. */
  monday?: Date;
  /**
   * Which of the seven is drawn below 1100px, where one day is on screen. The browser's today
   * while nobody has said, which is the day the week opens on.
   */
  day?: number | undefined;
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
export function WeekSkeleton({
  monday = mondayOf(new Date()),
  day: shown,
}: Props): React.ReactNode {
  const dates = daysFrom(monday);
  // One day below 1100px, as the screen it turns into draws one (ADR-0052). Monday is zero.
  const only = useLayout() === "week" ? null : (shown ?? (new Date().getDay() + 6) % 7);

  return (
    <>
      {/* The phone's words for it (day-phone.dc.html); the desktop drawing has no loading
          state of its own. */}
      <p role="status" className={day.loading}>
        Loading {weekRange(monday, dates[6] as Date)}…
      </p>
      <div className={cx(page.grid, only !== null && page.oneDay)} aria-busy="true">
        {dates.map((date, index) =>
          only !== null && only !== index ? null : (
            <div key={date.toISOString()} className={day.day}>
              <div className={day.head}>
                <div className={day.name}>
                  <span className={day.weekday}>{weekdayDrawn(index + 1)}</span>
                  <span className={day.date}>{dayMonth(date)}</span>
                </div>
                <span className={cx(day.placeholder, "skeleton")} />
              </div>
            </div>
          ),
        )}
      </div>
    </>
  );
}
