import { useEffect, useRef } from "react";

import { clock, formatCompact } from "../lib/time";
import type { DayCapacity, NewTask, Task, TaskChanges } from "../api/types";
import { type Panel, RowPanels, useRowActions } from "./RowPanels";
import type { ChecklistChange } from "./useWeek";
import { cx } from "../lib/cx";
import day from "./Day.module.css";

export type { Panel } from "./RowPanels";

interface Props {
  task: Task;
  minutesFromMidnight: number;
  /** The task runs past midnight, so its end time is tomorrow's. */
  crosses: boolean;
  /**
   * The line under the title: `done 15:00 · 1h30 of 3h · −1h30` once done, how its minutes
   * divide across midnight until then, and null when neither applies. Precomputed: it needs
   * the zone and the names of two weekdays, and the row has neither.
   */
  doneLine: string | null;
  timezone: string;
  /** The week on screen and every task it holds, which is what the move panel weighs. */
  days: DayCapacity[];
  allTasks: Task[];
  open: Panel | null;
  /** `2:3`: the row's place in the week's grid, which the arrow keys move between. */
  cell: string;
  /** The week's one tab stop is on this row (ADR-0053). */
  tabStop: boolean;
  onFocusCell: () => void;
  /** A write about this task has not reached the screen yet. */
  saving: boolean;
  onOpen: (panel: Panel | null) => void;
  /** `sentence`, when a panel has one, is announced once the change is saved. */
  onSave: (changes: TaskChanges, sentence?: string) => Promise<void>;
  /** Complete or reopen. Rejects with the server's `ApiError` when it refuses. */
  onToggle: (task: Task) => Promise<void>;
  /**
   * Delete the task. `snapshot` is what an undo would recreate, or null when the delete was
   * confirmed because no faithful recreate exists. Rejects with the server's `ApiError`.
   */
  onDelete: (snapshot: NewTask | null) => Promise<void>;
  /** Change the checklist. Rejects with the server's `ApiError`. */
  onChecklist: (change: ChecklistChange) => Promise<void>;
  /** Open the page of the plan a task came from. */
  onOpenPlan?: ((planId: string) => void) | undefined;
}

/**
 * One task, on the day it belongs to: a cell of the week's grid (ADR-0053).
 *
 * The row itself is the disclosure. It holds the week's one tab stop when the arrows bring it
 * there, Enter opens and closes it, Space completes it, and the verb letters reach a verb
 * without opening first. The box stays a real button for the pointer, out of the tab order
 * while the row is shut, since Space on the row is the same press.
 *
 * The second round's answer, a box and a title button per row, was two tab stops a row: about
 * sixty to cross a full week. A row that took focus itself was refused then because it was a
 * `group`, which cannot carry `aria-expanded`; a `gridcell` can.
 */
export function TaskRow({
  task,
  minutesFromMidnight,
  crosses,
  doneLine,
  timezone,
  days,
  allTasks,
  open,
  cell,
  tabStop,
  onFocusCell,
  saving,
  onOpen,
  onSave,
  onToggle,
  onDelete,
  onChecklist,
  onOpenPlan,
}: Props): React.ReactNode {
  const done = task.completed_at !== null;
  const actions = useRowActions(task, onOpen, onToggle, onDelete);
  const { refusal, toggle } = actions;
  const planId = task.plan_id;
  const self = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(open !== null);

  // A closed panel takes the focused control with it. Focus comes back to the row it was in,
  // whichever way the row was closed, rather than falling to the page (ADR-0053).
  useEffect(() => {
    if (wasOpen.current && open === null && document.activeElement === document.body) {
      self.current?.focus();
    }
    wasOpen.current = open !== null;
  }, [open]);

  const checked = task.items.filter((item) => item.completed_at !== null).length;
  const hasNote = task.notes !== null && task.notes.trim() !== "";

  return (
    <div
      ref={self}
      // Addressable so the band on the receiving day has somewhere to send the reader back
      // to. The task id rather than the position: the row moves when its neighbours change.
      id={`task-${task.id}`}
      role="gridcell"
      data-cell={cell}
      tabIndex={tabStop ? 0 : -1}
      aria-expanded={open !== null}
      aria-busy={saving}
      data-open={open !== null ? "1" : undefined}
      className={cx(day.row, open !== null && day.rowOpen)}
      onFocus={onFocusCell}
      onClick={(event) => {
        // The pointer's way in, anywhere on a shut row but its box. Once open, the row is a
        // panel full of controls, and a press between them should not shut it.
        const onControl = event.target instanceof Element && event.target.closest("button");
        if (open === null && !onControl) onOpen("open");
      }}
      onKeyDown={(event) => {
        // Only keys pressed on the row itself: inside an open row they belong to its controls.
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter") {
          event.preventDefault();
          onOpen(open === null ? "open" : null);
          return;
        }
        if (event.key === " ") {
          event.preventDefault();
          toggle();
          return;
        }
        actions.verbKey(event);
      }}
    >
      <div className={day.time}>
        <span>
          {clock(minutesFromMidnight)} –{" "}
          <span className={day.end}>
            {clock(minutesFromMidnight + task.duration_minutes)}
            {/* The end time wraps past midnight rather than reading `25:30`, so on its own it
                claims a morning that belongs to tomorrow. This is the mark that says so. */}
            {crosses && <span className={day.plusOne}>+1</span>}
          </span>
        </span>
        <span>{formatCompact(task.duration_minutes)}</span>
      </div>

      <div className={day.line}>
        <button
          type="button"
          role="checkbox"
          className={day.box}
          aria-checked={done}
          aria-label={`${done ? "Reopen" : "Complete"} ${task.title}`}
          aria-keyshortcuts={open === null ? undefined : "Space"}
          tabIndex={open === null ? -1 : 0}
          onClick={toggle}
        >
          <span className={cx(day.mark, done && day.markDone)} />
        </button>
        <span className={cx(day.title, done && day.titleDone)}>{task.title}</span>
      </div>

      {(task.tag !== null || planId !== null || hasNote || task.items.length > 0 || saving) && (
        <div className={day.meta}>
          {task.tag !== null && <span className={day.tag}>{task.tag.name}</span>}
          {/* The way back to the count, from anywhere a step of it shows (plan.dc.html). No
              step number: the task keeps only its plan (decided on 2026-11-22). */}
          {planId !== null && (
            <button
              type="button"
              className={day.fromPlan}
              tabIndex={open === null ? -1 : 0}
              onClick={() => {
                onOpenPlan?.(planId);
              }}
            >
              from your plan
            </button>
          )}
          {/* Only while shut: open, the note itself is on the row. */}
          {hasNote && open === null && <span className={day.quiet}>note</span>}
          {task.items.length > 0 && (
            <span className={cx(day.quiet, day.figure)}>
              {checked}/{task.items.length} checked
            </span>
          )}
          {/* The word is the whole signal: the row keeps what it showed until the server has
              answered and the week has been read again, so nothing on it is a guess. */}
          {saving && <span className={day.saving}>saving…</span>}
        </div>
      )}

      {doneLine !== null && <span className={day.doneLine}>{doneLine}</span>}
      {open === "open" && hasNote && <span className={day.note}>{task.notes}</span>}

      {/* On the row, because a delete or a completion can be pressed with the row shut, and a
          refusal nobody can see is a refusal that did not happen. */}
      {refusal !== null && (
        <span role="alert" className={day.refusal}>
          {refusal}
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
        />
      )}
    </div>
  );
}
