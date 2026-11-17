/**
 * The way between days when one day is on screen: the day before, a new task, the day after
 * (day-phone.dc.html).
 *
 * A bar at the bottom, always on screen and in reach of a thumb, with both neighbours named.
 * The round refused three other ways: a carousel that only swipes fails WCAG 2.5.1 and gives
 * no sign that it exists, arrows in the day's header sit far from the thumb and beside the
 * week's arrows, and the strip alone has no room left at 200% text.
 */
import { cx } from "../lib/cx";
import styles from "./DayView.module.css";

interface Props {
  /** `Wed 21` and `Fri 23`: the days on either side, which may be in another week. */
  previous: string;
  next: string;
  onPrevious: () => void;
  onNext: () => void;
  onNew: () => void;
}

export function DayBar({ previous, next, onPrevious, onNext, onNew }: Props): React.ReactNode {
  return (
    <nav aria-label="Days" className={styles.bar}>
      <button type="button" className={styles.step} onClick={onPrevious}>
        <span aria-hidden="true">‹ </span>
        <span className={styles.unseen}>Previous day,</span> {previous}
      </button>
      <button type="button" className={styles.create} aria-haspopup="dialog" onClick={onNew}>
        + New task
      </button>
      <button type="button" className={cx(styles.step, styles.stepNext)} onClick={onNext}>
        <span className={styles.unseen}>Next day,</span> {next}
        <span aria-hidden="true"> ›</span>
      </button>
    </nav>
  );
}
