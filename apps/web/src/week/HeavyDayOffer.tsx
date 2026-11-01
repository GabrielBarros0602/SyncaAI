import { useState } from "react";

import { ApiError } from "../api/client";
import type { TaskChanges } from "../api/types";
import { clock, formatCompact, weekdayName, zonedMinutes } from "../lib/time";
import { moveTo } from "./changes";
import { clockSpan, type Offer } from "./move";
import day from "./Day.module.css";

interface Props {
  offer: Offer;
  /** The heavy day's short name, which the line under the button says will drop. */
  weekday: string;
  /** The receiving day's free minutes, the server's figure. */
  free: number;
  /** The week on screen holds today, so the days left are "this week"'s. */
  thisWeek: boolean;
  timezone: string;
  /** Tab reaches the button only while its day's header holds the week's stop (ADR-0053). */
  tabbable: boolean;
  onSave: (taskId: string, changes: TaskChanges, sentence: string) => Promise<void>;
}

/**
 * The one move that would lighten a day past its budget (ADR-0054, item 20 of the round).
 *
 * The button names the task and the day, and the line under it shows the arithmetic, so the
 * person sees what pressing it does to both days before pressing. It is advice: the server can
 * still refuse the slot, and its sentence then shows here, as it does in the move panel.
 */
export function HeavyDayOffer({
  offer,
  weekday,
  free,
  thisWeek,
  timezone,
  tabbable,
  onSave,
}: Props): React.ReactNode {
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const { task, to } = offer;
  const name = weekdayName(to.weekday);
  const where = `${name} ${String(Number(to.day.slice(8, 10)))}`;
  const room = `${formatCompact(free)} free`;
  // "The lightest" only when it is: the lightest day's slot may have been taken, and the offer
  // gone to the next.
  const why = offer.lightest
    ? `${name} is the lightest day ${thisWeek ? "left this week" : "that week"}, ${room}.`
    : `${name} has ${room}.`;

  function move(): void {
    // Busy rather than disabled: a disabled button would drop keyboard focus to the page.
    if (saving) return;
    setRefusal(null);
    setSaving(true);
    const at = clock(zonedMinutes(task.start_at, timezone));
    onSave(task.id, moveTo(task, to.startAt), `Moved “${task.title}” to ${where}, ${at}.`)
      .catch((problem: unknown) => {
        setRefusal(problem instanceof ApiError ? problem.detail : "Couldn’t reach the server.");
      })
      .finally(() => {
        setSaving(false);
      });
  }

  return (
    <div className={day.offer}>
      <button
        type="button"
        tabIndex={tabbable ? 0 : -1}
        className={day.offerButton}
        aria-busy={saving}
        onClick={move}
      >
        <span className={day.offerLabel}>
          Move “{task.title}” to {where}
        </span>
        <span aria-hidden="true" className={day.offerArrow}>
          →
        </span>
      </button>
      <span className={day.panelHint}>
        Same time, {clockSpan(task, timezone)}. {why} {weekday} would drop to{" "}
        {formatCompact(offer.after)}.
      </span>
      {refusal !== null && (
        <span role="alert" className={day.refusal}>
          {refusal}
        </span>
      )}
    </div>
  );
}
