import { clock, formatMinutes } from "../lib/time";
import type { Task } from "../api/types";
import { useDirectionalFill } from "./useDirectionalFill";
import { cx } from "../lib/cx";
import styles from "./Week.module.css";

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
  open: boolean;
  onOpen: () => void;
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
 *
 * Two native buttons cost a second tab stop per row and buy back everything that was being
 * written by hand — focus, activation, the pressed and expanded states — from elements that
 * actually mean them.
 */
export function TaskRow({
  task,
  index,
  minutesFromMidnight,
  split,
  doneLine,
  open,
  onOpen,
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
      data-open={open ? "1" : undefined}
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
            than this file's, and `aria-expanded` sits on a role that supports it. */}
        <button
          type="button"
          className={styles.taskTitle}
          aria-expanded={open}
          onClick={onOpen}
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

      {open && (
        // No click handler of its own any more. Opening lives on the title button, so a
        // click landing in here reaches nothing that would close it.
        <div className={styles.panel}>
          <div className={styles.panelTop}>
            <button type="button" className={styles.panelClose} onClick={onOpen}>
              esc
            </button>
          </div>

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
        </div>
      )}
    </div>
  );
}
