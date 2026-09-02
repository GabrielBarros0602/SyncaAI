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
  onToggle: (task: Task) => void;
}

export function TaskRow({
  task,
  index,
  minutesFromMidnight,
  split,
  onToggle,
}: Props): React.ReactNode {
  const { onMouseEnter, onMouseLeave, fillRef } = useDirectionalFill();
  const done = task.completed_at !== null;
  const checked = task.items.filter((item) => item.completed_at !== null).length;

  return (
    // A button rather than a div with a click handler: it is one, and making it one is what
    // gets keyboard activation, focus order and the pressed state without writing any of them.
    <button
      type="button"
      // Addressable so the band on the receiving day has somewhere to send the reader back
      // to. The task id rather than the position: the row moves when its neighbours change.
      id={`task-${task.id}`}
      aria-pressed={done}
      className={cx(styles.task, done && styles.taskDone)}
      onClick={() => {
        onToggle(task);
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
      <span className={styles.taskTitle}>{task.title}</span>
      {split !== null && <span className={styles.taskSplit}>{split}</span>}
      <span className={styles.taskFoot}>
        {task.tag !== null && <span className={styles.tag}>{task.tag.name}</span>}
        {task.items.length > 0 && (
          <span className={styles.taskNote}>
            {checked}/{task.items.length} checked
          </span>
        )}
        {done && <span className={styles.taskDoneAt}>done</span>}
      </span>
    </button>
  );
}
