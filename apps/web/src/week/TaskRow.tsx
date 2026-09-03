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
 * The row is a container rather than a control, and the checkbox inside it is the control.
 * That inversion is the whole change: completing is the frequent verb and must not cost an
 * opening, while everything else a task can do needs room the resting row does not have.
 *
 * It costs the free keyboard behaviour a `<button>` was giving away, which is why the key
 * handler is explicit. `role="group"` rather than `role="button"` because the row really does
 * contain controls — a button holding a button is invalid, and lying about the role to get
 * the semantics would put the checkbox somewhere a screen reader cannot reach it.
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
      tabIndex={0}
      aria-expanded={open}
      data-open={open ? "1" : undefined}
      className={cx(styles.task, done && styles.taskDone)}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === " ") {
          // Space completes rather than opening, because that is the verb somebody presses
          // dozens of times and opening to reach it would be the cost this row exists to
          // remove.
          event.preventDefault();
          onToggle(task);
        } else if (event.key === "Enter") {
          event.preventDefault();
          onOpen();
        }
      }}
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
          onClick={(event) => {
            // Or the row underneath opens on the same click, and completing a task would
            // leave a panel standing open on it.
            event.stopPropagation();
            onToggle(task);
          }}
        >
          {done && <span className={styles.checkMark} />}
        </button>
        <span className={styles.taskTitle}>{task.title}</span>
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
        <div
          className={styles.panel}
          // The panel is inside the row, and the row opens and closes on click. Without this
          // every click on a note or a checklist item would close what it landed in.
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
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
