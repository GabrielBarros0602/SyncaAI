/**
 * The week at a glance, beside or above the one day on screen (day-phone.dc.html, #9 of the
 * round's inventory).
 *
 * Always in view rather than behind a button: the day past its budget is the one thing it
 * exists to show, and a strip that had to be opened would hide exactly that day. Below 640px
 * it is seven cells that wrap into rows at 200% text instead of scrolling sideways; from 640px
 * it is a column of seven rows beside the day.
 *
 * Every day sits on one ruler, the longest a day can be, as the day's own trail does. Figures
 * come from the server's week or are not shown: a cell reads `–` while its week loads and `—`
 * when it could not be read, never the number the last week had.
 */
import type { DayCapacity, Load } from "../api/types";
import { cx } from "../lib/cx";
import { formatCompact, weekdayLong, weekdayName } from "../lib/time";
import styles from "./DayView.module.css";

/** The longest a local day can be, in minutes: the ruler every track is drawn against. */
const LONGEST_DAY = 1500;

const LEVEL: Record<Load, string> = {
  fine: "Fine",
  heavy: "Heavy",
  strained: "Strained",
  unsustainable: "Unsustainable",
};

/** A share as a CSS percentage, rounded to a tenth. */
function percent(share: number): string {
  return `${String(Math.round(share * 1000) / 10)}%`;
}

interface Props {
  /** `day` is the strip of seven cells; `beside` the column of seven rows. */
  layout: "day" | "beside";
  /** The seven dates of the week on screen, Monday first. */
  dates: Date[];
  /** The server's seven days, or none while the week is not on screen. */
  days: DayCapacity[];
  state: "ready" | "loading" | "unreachable";
  /** Which of the seven is the day on screen. */
  selected: number;
  /** Which is today in the person's zone, or -1 when today is in another week. */
  today: number;
  onSelect: (index: number) => void;
}

export function WeekGlance({
  layout,
  dates,
  days,
  state,
  selected,
  today,
  onSelect,
}: Props): React.ReactNode {
  const cells = dates.map((date, index) => {
    const capacity = state === "ready" ? days[index] : undefined;
    const total = capacity?.total_minutes ?? 1440;
    const figure =
      capacity !== undefined
        ? formatCompact(capacity.occupied_minutes)
        : state === "loading"
          ? "–"
          : "—";
    return {
      index,
      number: String(date.getDate()),
      isToday: index === today,
      isSelected: index === selected,
      // Every level above fine, the server's ladder and never one recomputed here.
      load: capacity === undefined || capacity.load === "fine" ? null : LEVEL[capacity.load],
      figure,
      said:
        capacity !== undefined
          ? `${figure} reserved. ${LEVEL[capacity.load]}.`
          : state === "loading"
            ? "Loading."
            : "Not loaded.",
      track: percent(total / LONGEST_DAY),
      // Clipped at the day's end: a day booked past its own length fills its track and stops.
      fill: percent(capacity === undefined ? 0 : Math.min(1, capacity.occupied_minutes / total)),
    };
  });

  if (layout === "day") {
    return (
      <ol aria-label="Week at a glance" aria-busy={state === "loading"} className={styles.strip}>
        {cells.map((cell) => (
          <li key={cell.index} className={styles.stripItem}>
            <button
              type="button"
              className={cx(styles.pick, styles.cell, cell.load !== null && styles.over)}
              // The cell draws a letter and three figures. The name says them as a sentence.
              aria-label={`${weekdayLong(cell.index + 1)} ${cell.number}${cell.isToday ? ", today" : ""}. ${cell.said}`}
              aria-current={cell.isSelected ? "true" : undefined}
              onClick={() => {
                onSelect(cell.index);
              }}
            >
              <span aria-hidden="true" className={styles.letter}>
                {weekdayName(cell.index + 1).charAt(0)}
              </span>
              <span aria-hidden="true" className={cx(styles.number, cell.isToday && styles.numberToday)}>
                {cell.number}
              </span>
              <span aria-hidden="true" className={styles.figure}>
                {cell.figure}
              </span>
              <span aria-hidden="true" className={styles.track} style={{ width: `calc(${cell.track} - 6px)` }}>
                <span className={styles.fill} style={{ width: cell.fill }} />
              </span>
            </button>
          </li>
        ))}
      </ol>
    );
  }

  return (
    <aside aria-label="Week at a glance" className={styles.aside}>
      <ol aria-busy={state === "loading"} className={styles.column}>
        {cells.map((cell) => (
          <li key={cell.index}>
            <button
              type="button"
              className={cx(styles.pick, styles.row, cell.load !== null && styles.over)}
              aria-current={cell.isSelected ? "true" : undefined}
              onClick={() => {
                onSelect(cell.index);
              }}
            >
              {/* The spaces are the row's name: it is named by what it shows, and without
                  them the parts would be read as one word. They draw nothing between flex items. */}
              <span className={styles.rowTop}>
                <span className={styles.short}>
                  {weekdayName(cell.index + 1)} {cell.number}
                </span>{" "}
                {cell.isToday && <span className={styles.today}>Today</span>}{" "}
                <span className={styles.figure}>{cell.figure}</span>
              </span>{" "}
              <span aria-hidden="true" className={styles.track} style={{ width: cell.track }}>
                <span className={styles.fill} style={{ width: cell.fill }} />
              </span>
              {cell.load !== null && <span className={styles.level}>{cell.load}</span>}
            </button>
          </li>
        ))}
      </ol>
    </aside>
  );
}
