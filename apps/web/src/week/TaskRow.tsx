import { useEffect, useRef, useState } from "react";

import { ApiError } from "../api/client";
import { clock, formatCompact, relativeDay, zonedDay, zonedMinutes } from "../lib/time";
import type { DayCapacity, NewTask, Task, TaskChanges } from "../api/types";
import { DeletePanel } from "./DeletePanel";
import { restoreBlocker, restoreBlockers, snapshotOf } from "./restore";
import { EditPanel } from "./EditPanel";
import { MovePanel } from "./MovePanel";
import { NotePanel } from "./NotePanel";
import { cx } from "../lib/cx";
import day from "./Day.module.css";
import styles from "./Week.module.css";

/**
 * What an opened row is showing.
 *
 * `open` is the resting state the disclosure produces: note and checklist, no form. The rest
 * are verbs. `list` joins this when the checklist has an API to save to.
 */
export type Panel = "open" | "edit" | "move" | "note" | "delete";

interface Verb {
  panel: Panel;
  label: string;
  /** What the key hint shows. */
  key: string;
  /** How `aria-keyshortcuts` names it. */
  shortcut: string;
  /** The `KeyboardEvent.key` values that reach this verb from the row. */
  keys: string[];
}

const EDIT: Verb = { panel: "edit", label: "edit", key: "E", shortcut: "E", keys: ["e", "E"] };
const MOVE: Verb = { panel: "move", label: "move", key: "M", shortcut: "M", keys: ["m", "M"] };
const NOTE: Verb = { panel: "note", label: "note", key: "O", shortcut: "O", keys: ["o", "O"] };
// The design's key is ⌫. Delete is accepted beside Backspace because on a Mac keyboard the
// key labelled delete sends Backspace, and on a PC the key labelled Delete sends Delete —
// each person presses the one their keyboard calls delete.
const DELETE: Verb = {
  panel: "delete",
  label: "delete",
  key: "⌫",
  shortcut: "Delete",
  keys: ["Backspace", "Delete"],
};

/**
 * The verbs a row offers, in the design's order.
 *
 * `move` is withheld from a completed task. Completing early shortens `end_at` to the moment
 * it was done (ADR-0022), so moving a finished task to a day after that moment gives it an
 * empty range: it would appear to move and occupy nothing, and the plan-versus-actual record
 * S6 reads from would stop meaning anything. Whether a finished task should move at all is an
 * open decision in the backlog; until it is made, the verb is not offered.
 */
function verbsFor(task: Task): Verb[] {
  return task.completed_at === null ? [EDIT, MOVE, NOTE, DELETE] : [EDIT, NOTE, DELETE];
}

/**
 * Why the row asks before deleting, one sentence per reason (item 21 of the round): what the
 * undo could not bring back, named in the person's own day and time.
 */
function whyNot(task: Task, timezone: string, now: Date): string[] {
  const today = zonedDay(now.toISOString(), timezone);
  return restoreBlockers(task, now).map((blocker) => {
    if (blocker === "done") return "It is done.";
    if (blocker === "started") {
      const at = clock(zonedMinutes(task.start_at, timezone));
      return `It has started — ${at} ${relativeDay(zonedDay(task.start_at, timezone), today)}.`;
    }
    const ticked = task.items.filter((item) => item.completed_at !== null).length;
    return `${String(ticked)} of ${String(task.items.length)} checklist items ${ticked === 1 ? "is" : "are"} ticked, and would come back unticked.`;
  });
}

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
}: Props): React.ReactNode {
  const done = task.completed_at !== null;
  const verbs = verbsFor(task);
  // The server's sentence for the last thing refused on the closed row: a delete or a
  // completion, both of which can be pressed without opening it.
  const [refusal, setRefusal] = useState<string | null>(null);
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

  function refused(problem: unknown): void {
    setRefusal(problem instanceof ApiError ? problem.detail : "Couldn’t reach the server.");
  }

  function toggle(): void {
    setRefusal(null);
    onToggle(task).catch(refused);
  }

  // Judged at the press, not when the row was drawn: a task that could be put back when the
  // screen loaded may have started since (ADR-0025). A faithful recreate exists, so the delete
  // goes now and the undo is offered; otherwise the row asks first and promises nothing.
  function startDelete(): void {
    if (restoreBlocker(task, new Date()) !== null) {
      onOpen("delete");
      return;
    }
    setRefusal(null);
    onDelete(snapshotOf(task)).catch(refused);
  }
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
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const verb = verbs.find((candidate) => candidate.keys.includes(event.key));
        if (verb === undefined) return;
        event.preventDefault();
        if (verb === DELETE) startDelete();
        else onOpen(verb.panel);
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

      {(task.tag !== null || hasNote || task.items.length > 0 || saving) && (
        <div className={day.meta}>
          {task.tag !== null && <span className={day.tag}>{task.tag.name}</span>}
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
        <>
          <div role="toolbar" aria-label={`Actions for ${task.title}`} className={day.verbs}>
            {verbs.map((verb) => (
              <button
                key={verb.panel}
                type="button"
                className={cx(day.verb, open === verb.panel && day.verbOn)}
                aria-pressed={open === verb.panel}
                aria-keyshortcuts={verb.shortcut}
                onClick={() => {
                  if (open === verb.panel) onOpen("open");
                  else if (verb === DELETE) startDelete();
                  else onOpen(verb.panel);
                }}
              >
                {verb.label}
                <kbd aria-hidden="true" className={day.cap}>
                  {verb.key}
                </kbd>
              </button>
            ))}
            <button
              type="button"
              className={day.close}
              aria-label="Close"
              aria-keyshortcuts="Escape"
              onClick={() => {
                onOpen(null);
              }}
            >
              esc
            </button>
          </div>

          {open === "edit" && (
            <EditPanel
              task={task}
              days={days}
              timezone={timezone}
              onSave={onSave}
              onCancel={() => {
                onOpen("open");
              }}
            />
          )}

          {open === "delete" && (
            <DeletePanel
              reasons={whyNot(task, timezone, new Date())}
              onConfirm={() => onDelete(null)}
              onCancel={() => {
                onOpen("open");
              }}
            />
          )}

          {open === "move" && !done && (
            <MovePanel task={task} days={days} tasks={allTasks} timezone={timezone} onSave={onSave} />
          )}

          {open === "note" && (
            <NotePanel
              task={task}
              onSave={onSave}
              onCancel={() => {
                onOpen("open");
              }}
            />
          )}

          {/* Shown, not editable: the checklist's own panel, C, comes with its controls. */}
          {open === "open" && task.items.length > 0 && (
            <div className={styles.checklist}>
              <div className={styles.checklistHead}>
                <span className={styles.checklistTitle}>Checklist</span>
                <span className={styles.taskNote}>
                  {checked}/{task.items.length} checked
                </span>
              </div>
              {task.items.map((item) => (
                <span key={item.id} className={styles.checkItem}>
                  <span className={styles.itemBox}>
                    {item.completed_at !== null && <span className={styles.checkMark} />}
                  </span>
                  <span
                    className={cx(
                      styles.checkLabel,
                      item.completed_at !== null && styles.checkLabelDone,
                    )}
                  >
                    {item.label}
                  </span>
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
