import { clock, formatMinutes } from "../lib/time";
import type { Task, TaskChanges } from "../api/types";
import { EditPanel } from "./EditPanel";
import { NotePanel } from "./NotePanel";
import { useDirectionalFill } from "./useDirectionalFill";
import { cx } from "../lib/cx";
import styles from "./Week.module.css";

/**
 * What an opened row is showing.
 *
 * `open` is the resting state the disclosure produces: note and checklist, no form. The rest
 * are verbs. `move`, `list` and `delete` join this as their pull requests land.
 */
export type Panel = "open" | "edit" | "note";

interface Verb {
  panel: Panel;
  label: string;
  key: string;
}

const VERBS: Verb[] = [
  { panel: "edit", label: "edit", key: "E" },
  { panel: "note", label: "note", key: "O" },
];

interface Props {
  task: Task;
  /** `03.02` — the day's number and the task's place in it. */
  index: string;
  minutesFromMidnight: number;
  /**
   * How this task's minutes divide across the midnight it crosses, or null when it does not.
   *
   * Precomputed, like `index` is: the split needs the zone and the names of two weekdays,
   * and the row has neither. Non-null is also what says the row crosses at all, so the
   * superscript and the sentence cannot disagree about it.
   */
  split: string | null;
  /** `done 15:00 · 1h30 of 3h · −1h30`, or null while the task is still open. */
  doneLine: string | null;
  timezone: string;
  open: Panel | null;
  onOpen: (panel: Panel | null) => void;
  onSave: (changes: TaskChanges) => Promise<void>;
  onToggle: (task: Task) => void;
}

/**
 * One task, on the day it belongs to.
 *
 * The row is a container and the two things it offers are real buttons: a checkbox that
 * completes, and the title, which is the disclosure that opens the panel. Completing is the
 * frequent verb and must not cost an opening; everything else needs room the resting row
 * does not have.
 *
 * An earlier version of this made the row itself focusable — `role="group"`, `tabIndex={0}`,
 * `aria-expanded`, and hand-written key handling — to keep the design's single tab stop per
 * row. `eslint-plugin-jsx-a11y` refused it, and was right: `aria-expanded` is not supported
 * on `group`, so the open state was announced to nobody, and a container carrying a tab stop
 * and key handlers is a control pretending not to be one.
 */
export function TaskRow({
  task,
  index,
  minutesFromMidnight,
  split,
  doneLine,
  timezone,
  open,
  onOpen,
  onSave,
  onToggle,
}: Props): React.ReactNode {
  const { onMouseEnter, onMouseLeave, fillRef } = useDirectionalFill();
  const done = task.completed_at !== null;
  const checked = task.items.filter((item) => item.completed_at !== null).length;
  const hasNote = task.notes !== null && task.notes.trim() !== "";

  return (
    <div
      // Addressable so the band on the receiving day has somewhere to send the reader back
      // to. The task id rather than the position: the row moves when its neighbours change.
      id={`task-${task.id}`}
      role="group"
      data-open={open !== null ? "1" : undefined}
      className={cx(styles.task, done && styles.taskDone)}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <span ref={fillRef} className={styles.fill} aria-hidden="true" />
      <span className={styles.taskTop}>
        <span className={styles.taskIndex}>{index}</span>
        <span className={styles.taskRange}>
          {clock(minutesFromMidnight)} – {clock(minutesFromMidnight + task.duration_minutes)}
          {/* The end time wraps past midnight rather than reading `25:30`, so on its own it
              claims a morning that belongs to tomorrow. This is the mark that says so. */}
          {split !== null && <span className={styles.taskNextDay}>+1</span>}
        </span>
        <span className={styles.taskDuration}>{formatMinutes(task.duration_minutes)}</span>
      </span>

      <span className={styles.taskLine}>
        <button
          type="button"
          className={styles.check}
          aria-pressed={done}
          aria-label={`Complete ${task.title}`}
          onClick={() => {
            onToggle(task);
          }}
        >
          {done && <span className={styles.checkMark} />}
        </button>
        {/* The disclosure. A real button, so focus, Enter and Space are the browser's rather
            than this file's, and `aria-expanded` sits on a role that supports it.

            It also carries the verb shortcuts, because it is the row's focusable element and
            a key handler belongs on something that can be focused. They reach a verb without
            opening first, which is what the letters are for. */}
        <button
          type="button"
          className={styles.taskTitle}
          aria-expanded={open !== null}
          onClick={() => {
            onOpen(open === null ? "open" : null);
          }}
          onKeyDown={(event) => {
            const verb = VERBS.find((candidate) => candidate.key === event.key.toUpperCase());
            if (verb === undefined) return;
            event.preventDefault();
            onOpen(verb.panel);
          }}
        >
          {task.title}
        </button>
      </span>

      {split !== null && <span className={styles.taskSplit}>{split}</span>}

      <span className={styles.taskFoot}>
        {task.tag !== null && <span className={styles.tag}>{task.tag.name}</span>}
        {hasNote && <span className={styles.taskNote}>note</span>}
        {task.items.length > 0 && (
          <span className={styles.taskNote}>
            {checked}/{task.items.length} checked
          </span>
        )}
      </span>

      {doneLine !== null && <span className={styles.taskDoneLine}>{doneLine}</span>}

      {open !== null && (
        <div className={styles.panel}>
          <div className={styles.panelTop}>
            {VERBS.map((verb) => (
              <span key={verb.panel} className={styles.verb}>
                <button
                  type="button"
                  className={cx(styles.verbLabel, open === verb.panel && styles.verbActive)}
                  aria-pressed={open === verb.panel}
                  onClick={() => {
                    onOpen(open === verb.panel ? "open" : verb.panel);
                  }}
                >
                  {verb.label}
                </button>
                <span className={styles.verbKey}>{verb.key}</span>
              </span>
            ))}
            <button
              type="button"
              className={styles.panelClose}
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
              timezone={timezone}
              onSave={onSave}
              onCancel={() => {
                onOpen("open");
              }}
            />
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

          {open === "open" && (
            <>
              {hasNote && <p className={styles.panelNote}>{task.notes}</p>}
              {!hasNote && task.items.length === 0 && (
                <p className={styles.panelBlank}>
                  No note, no checklist. Both are optional and neither is parsed.
                </p>
              )}

              {task.items.length > 0 && (
                <div className={styles.checklist}>
                  <div className={styles.checklistHead}>
                    <span className={styles.checklistTitle}>Checklist</span>
                    <span className={styles.taskNote}>
                      {checked}/{task.items.length} checked
                    </span>
                  </div>
                  {task.items.map((item) => (
                    // Not a button. Editing a checklist has no API yet — `TaskUpdate` has no
                    // items field and no route touches ChecklistItem — and a control that
                    // silently does nothing is worse than a line that never offered.
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
      )}
    </div>
  );
}
