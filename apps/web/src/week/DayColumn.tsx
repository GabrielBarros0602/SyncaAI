import { formatMinutes, weekdayName, zonedMinutes } from "../lib/time";
import type { DayCapacity, NewTask, Task } from "../api/types";
import { warningFor } from "./load";
import { TaskRow } from "./TaskRow";
import { NewTaskForm } from "./NewTaskForm";
import { useDirectionalFill } from "./useDirectionalFill";
import { cx } from "../lib/cx";
import styles from "./Week.module.css";

/**
 * The longest a local day can be, in minutes. A day that gains an hour at a daylight saving
 * transition has 1500, and the track is scaled against that so every day in the week is
 * measured on one ruler.
 */
const LONGEST_DAY = 1500;

interface Props {
  capacity: DayCapacity;
  /** The day in the week with the most room, when this one is heavy enough to say so. */
  lighter: DayCapacity | null;
  tasks: Task[];
  index: number;
  weekday: string;
  date: string;
  timezone: string;
  formOpen: boolean;
  submitting: boolean;
  serverError: string | null;
  onHover: (day: string | null) => void;
  onOpenForm: (day: string) => void;
  onCancelForm: () => void;
  onCreate: (task: NewTask) => void;
  onToggle: (task: Task) => void;
}

export function DayColumn({
  capacity,
  lighter,
  tasks,
  index,
  weekday,
  date,
  timezone,
  formOpen,
  submitting,
  serverError,
  onHover,
  onOpenForm,
  onCancelForm,
  onCreate,
  onToggle,
}: Props): React.ReactNode {
  const { onMouseEnter, onMouseLeave, fillRef } = useDirectionalFill();
  const dayNumber = String(index + 1).padStart(2, "0");
  const over = capacity.over_capacity;
  // Against the budget, the same thing `over_capacity` is measured against. Against the
  // calendar day this would be negative on every day that flag is ever true.
  const overBy = capacity.occupied_minutes - capacity.usable_minutes;

  // Against the longest possible day, not against this one. Scaling each day to itself
  // would make every track full width and quietly throw away the fact this screen exists
  // to be honest about: days are not all the same length.
  const trackWidth = `${String(Math.round((capacity.total_minutes / LONGEST_DAY) * 100))}%`;
  // Against the real day, so the bar means "how much of this day is spoken for". The budget
  // decides the numbers; the geometry stays honest about the day itself.
  const barWidth = `${String(Math.min(100, Math.round((capacity.occupied_minutes / capacity.total_minutes) * 100)))}%`;
  const warning = warningFor(capacity);

  return (
    <div className={cx(styles.day, over && styles.dayOver)}>
      <div
        className={styles.head}
        onMouseEnter={(event) => {
          onHover(capacity.day);
          onMouseEnter(event);
        }}
        onMouseLeave={(event) => {
          onHover(null);
          onMouseLeave(event);
        }}
      >
        <span ref={fillRef} className={styles.fill} aria-hidden="true" />
        <div className={styles.layer} style={{ display: "flex", justifyContent: "space-between" }}>
          <span className={styles.dayIndex}>{dayNumber}</span>
          <span className={styles.dayTotalNote}>
            {capacity.total_minutes === 1440
              ? "1440 min"
              : `${String(capacity.total_minutes)} min · DST`}
          </span>
        </div>
        <div className={cx(styles.layer, styles.weekday)}>{weekday}</div>
        <div className={cx(styles.layer, styles.date)}>{date}</div>
        <div className={cx(styles.layer, styles.free, "rise")}>
          {formatMinutes(capacity.free_minutes)}
        </div>
        <div className={cx(styles.layer, styles.freeOf)}>
          free of{" "}
          <span className={styles.freeOfValue}>{formatMinutes(capacity.usable_minutes)}</span>
        </div>
        {over && (
          <div className={cx(styles.layer, styles.overChip)}>over by {formatMinutes(overBy)}</div>
        )}
        {warning.message !== null && (
          <div
            className={cx(
              styles.layer,
              styles.warning,
              warning.level === "unsustainable" && styles.warningLoud,
            )}
          >
            <p className={styles.warningText}>{warning.message}</p>
            {lighter !== null && (
              // Deterministic, and true today. The AI adds *which* task should move, later
              // — the sentence does not need it to be honest (ADR-0022).
              <p className={styles.warningMove}>
                This day is heavier than the rest of your week.{" "}
                <span className={styles.warningMoveDay}>
                  {weekdayName(lighter.weekday)} has {formatMinutes(lighter.free_minutes)} free.
                </span>
              </p>
            )}
          </div>
        )}
        <div className={cx(styles.layer, styles.trackRow)}>
          <div data-track className={styles.track} style={{ width: trackWidth }}>
            <div data-bar className={styles.bar} style={{ width: barWidth }} />
          </div>
          {over && <div className={styles.overflow} />}
        </div>
        <div className={cx(styles.layer, styles.dayMeta)}>
          {capacity.task_count === 0
            ? "no tasks"
            : `${String(capacity.task_count)} ${capacity.task_count === 1 ? "task" : "tasks"} · ${formatMinutes(capacity.occupied_minutes)} booked`}
        </div>
      </div>

      {tasks.map((task, position) => (
        <TaskRow
          key={task.id}
          task={task}
          index={`${dayNumber}.${String(position + 1).padStart(2, "0")}`}
          minutesFromMidnight={zonedMinutes(task.start_at, timezone)}
          onToggle={onToggle}
        />
      ))}

      {capacity.task_count === 0 && !formOpen && (
        <div className={styles.emptyDay}>
          Nothing booked. The day is open, all{" "}
          <span className={styles.emptyDayValue}>{formatMinutes(capacity.free_minutes)}</span> of it.
        </div>
      )}

      {formOpen ? (
        <NewTaskForm
          weekday={weekday}
          date={date}
          day={capacity.day}
          timezone={timezone}
          submitting={submitting}
          serverError={serverError}
          onSubmit={onCreate}
          onCancel={onCancelForm}
        />
      ) : (
        <button
          type="button"
          className={styles.newTask}
          onClick={() => {
            onOpenForm(capacity.day);
          }}
        >
          <span>new task</span>
          <span className={styles.key}>N</span>
        </button>
      )}
    </div>
  );
}
