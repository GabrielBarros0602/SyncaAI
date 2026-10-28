import { clock, formatCompact, zonedMinutes } from "../lib/time";
import type { Carried } from "./carried";
import day from "./Day.module.css";

/**
 * What the day before is still holding, on the day receiving it.
 *
 * Not a task row, and drawn so it cannot be mistaken for one: a dashed edge, the arrow it
 * came by, and no verb on it anywhere. The task belongs to the day it starts on and is
 * listed, counted and acted on there. Repeating the row here was the alternative and it is
 * worse — the count would say five tasks where there are three, and a delete button would
 * sit on half a task.
 *
 * One band at most: tasks cannot overlap, so only one can be running at a midnight. The
 * whole band is a cell of the week's grid and the way back to its owner (ADR-0053).
 */
interface Props {
  entry: Carried;
  /** The weekday it came from: the day before, since a task cannot cross two midnights. */
  fromWeekday: string;
  timezone: string;
  /**
   * Focus the row that owns the task, or null when that row is not on this screen.
   *
   * Null on Monday and only there: its source is the day before the week, which is fetched
   * so the figures are right and never rendered. An offer to go somewhere that does not
   * exist is worse than not offering.
   */
  onGoToOwner: ((taskId: string) => void) | null;
  cell: string;
  tabStop: boolean;
  onFocusCell: () => void;
}

export function CarriedBand({
  entry,
  fromWeekday,
  timezone,
  onGoToOwner,
  cell,
  tabStop,
  onFocusCell,
}: Props): React.ReactNode {
  const goToOwner =
    onGoToOwner === null
      ? undefined
      : () => {
          onGoToOwner(entry.task.id);
        };

  return (
    <div
      role="gridcell"
      data-cell={cell}
      tabIndex={tabStop ? 0 : -1}
      className={day.band}
      data-goes={goToOwner === undefined ? undefined : "1"}
      onFocus={onFocusCell}
      onClick={goToOwner}
      onKeyDown={(event) => {
        if (event.key !== "Enter" || goToOwner === undefined) return;
        event.preventDefault();
        goToOwner();
      }}
    >
      {/* "here" is this day's share of it, which the booked figure above already counts. */}
      <div className={day.bandTop}>
        <span>↳ carried from {fromWeekday}</span>
        <span className={day.figure}>{formatCompact(entry.minutes)} here</span>
      </div>
      <span className={day.bandTitle}>{entry.task.title}</span>
      <div className={day.bandFoot}>
        <span>
          {clock(zonedMinutes(entry.task.start_at, timezone))} →{" "}
          {clock(zonedMinutes(entry.task.end_at, timezone))}
        </span>
        {/* Words, not a button: the whole band is the control, and Enter on it goes. */}
        {goToOwner !== undefined && <span className={day.bandGo}>go to {fromWeekday}</span>}
      </div>
    </div>
  );
}
