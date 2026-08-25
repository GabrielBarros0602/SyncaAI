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
  onToggle: (task: Task) => void;
}

export function TaskRow({ task, index, minutesFromMidnight, onToggle }: Props): React.ReactNode {
  const { onMouseEnter, onMouseLeave, fillRef } = useDirectionalFill();
  const done = task.completed_at !== null;
  const checked = task.items.filter((item) => item.completed_at !== null).length;

  return (
    // A button rather than a div with a click handler: it is one, and making it one is what
    // gets keyboard activation, focus order and the pressed state without writing any of them.
    <button
      type="button"
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
        </span>
        <span className={styles.taskDuration}>{formatMinutes(task.duration_minutes)}</span>
      </span>
      <span className={styles.taskTitle}>{task.title}</span>
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
