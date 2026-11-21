/**
 * One task in the one day's list below 1100px (day-phone.dc.html, ADR-0056).
 *
 * Two controls, as the drawing has them: the box that completes it, and a button that opens and
 * closes it. Tab reaches both; nothing here is a cell of a grid. The verbs, the refusals and the
 * panels are the week's row's own (`RowPanels`), so the two shapes a task takes never offer
 * different things.
 *
 * In the desktop's words where the two drawings name the same thing (docs/design/README.md):
 * the time as the week writes it, "1/3 checked", the done line and "saving…". How long a task
 * has been running is the phone's own.
 */
import { useEffect, useRef } from "react";

import type { DayCapacity, NewTask, Task, TaskChanges } from "../api/types";
import { cx } from "../lib/cx";
import { clock, formatCompact, minutesBetween } from "../lib/time";
import { type Panel, RowPanels, useRowActions, verbsFor } from "./RowPanels";
import type { ChecklistChange } from "./useWeek";
import day from "./Day.module.css";
import list from "./DayView.module.css";

interface Props {
  task: Task;
  minutesFromMidnight: number;
  /** The task runs past midnight, so its end time is tomorrow's. */
  crosses: boolean;
  /** How it went once done, or how its minutes divide across midnight; null when neither. */
  doneLine: string | null;
  timezone: string;
  days: DayCapacity[];
  allTasks: Task[];
  open: Panel | null;
  saving: boolean;
  onOpen: (panel: Panel | null) => void;
  onSave: (changes: TaskChanges, sentence?: string) => Promise<void>;
  onToggle: (task: Task) => Promise<void>;
  onDelete: (snapshot: NewTask | null) => Promise<void>;
  onChecklist: (change: ChecklistChange) => Promise<void>;
}

/** `1h10 of 3h so far`, for a task under way now; null for any other. */
function runningText(task: Task, now: Date): string | null {
  if (task.completed_at !== null) return null;
  const elapsed = minutesBetween(task.start_at, now);
  if (elapsed < 0 || elapsed >= task.duration_minutes) return null;
  return `${formatCompact(elapsed)} of ${formatCompact(task.duration_minutes)} so far`;
}

export function DayRow({
  task,
  minutesFromMidnight,
  crosses,
  doneLine,
  timezone,
  days,
  allTasks,
  open,
  saving,
  onOpen,
  onSave,
  onToggle,
  onDelete,
  onChecklist,
}: Props): React.ReactNode {
  const done = task.completed_at !== null;
  const actions = useRowActions(task, onOpen, onToggle, onDelete);
  const self = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(open !== null);

  // A closed panel takes the focused control with it. Focus comes back to the button that
  // opened the row, however it was closed, rather than falling to the page.
  useEffect(() => {
    if (wasOpen.current && open === null && document.activeElement === document.body) {
      self.current?.focus();
    }
    wasOpen.current = open !== null;
  }, [open]);

  const checked = task.items.filter((item) => item.completed_at !== null).length;
  const hasNote = task.notes !== null && task.notes.trim() !== "";
  // Read at render, like the move panel's: the clock passes a start while the day is open.
  const running = runningText(task, new Date());

  return (
    <li aria-busy={saving} className={cx(list.item, open !== null && list.itemOpen)}>
      <div className={list.itemLine}>
        <button
          type="button"
          role="checkbox"
          className={list.box}
          aria-checked={done}
          aria-label={`${done ? "Reopen" : "Complete"} ${task.title}`}
          onClick={actions.toggle}
        >
          <span className={cx(day.mark, done && day.markDone)} />
        </button>
        <button
          ref={self}
          // Addressable, so a band on the next day, an undo and a move can bring focus back.
          id={`task-${task.id}`}
          type="button"
          className={list.disclosure}
          aria-expanded={open !== null}
          aria-keyshortcuts={verbsFor(task)
            .map((verb) => verb.shortcut)
            .join(" ")}
          onClick={() => {
            onOpen(open === null ? "open" : null);
          }}
          onKeyDown={(event) => {
            // Enter and Space are the button's own. The verbs' letters reach a verb, as on the
            // week's row, without opening first (ADR-0056).
            if (event.target === event.currentTarget) actions.verbKey(event);
          }}
        >
          <span className={list.itemTime}>
            {clock(minutesFromMidnight)} –{" "}
            <span className={day.end}>
              {clock(minutesFromMidnight + task.duration_minutes)}
              {crosses && <span className={day.plusOne}>+1</span>}
            </span>{" "}
            · {formatCompact(task.duration_minutes)}
          </span>
          <span className={cx(list.itemTitle, done && day.titleDone)}>{task.title}</span>
          {(task.tag !== null || hasNote || task.items.length > 0 || saving) && (
            <span className={list.itemMeta}>
              {task.tag !== null && <span className={list.tag}>{task.tag.name}</span>}
              {hasNote && open === null && <span>note</span>}
              {task.items.length > 0 && (
                <span>
                  {checked}/{task.items.length} checked
                </span>
              )}
              {/* The word is the whole signal: nothing on the row changes until the server
                  has answered and the week has been read again. */}
              {saving && <span className={list.saving}>saving…</span>}
            </span>
          )}
          {/* Wraps wherever a space allows, at any width and text size: the round's drawing
              held its two halves unbroken, and at 200% on a phone they ran past the edge. */}
          {doneLine !== null && <span className={list.itemLine2}>{doneLine}</span>}
          {running !== null && <span className={list.itemLine2}>{running}</span>}
        </button>
      </div>

      {(actions.refusal !== null || open !== null) && (
        <div className={cx(list.itemBody, open !== null && list.itemPanels)}>
          {open === "open" && hasNote && <p className={day.note}>{task.notes}</p>}
          {actions.refusal !== null && (
            <span role="alert" className={day.refusal}>
              {actions.refusal}
            </span>
          )}
          {open !== null && (
            <RowPanels
              task={task}
              open={open}
              timezone={timezone}
              days={days}
              allTasks={allTasks}
              saving={saving}
              actions={actions}
              onOpen={onOpen}
              onSave={onSave}
              onDelete={onDelete}
              onChecklist={onChecklist}
              list
            />
          )}
        </div>
      )}
    </li>
  );
}
