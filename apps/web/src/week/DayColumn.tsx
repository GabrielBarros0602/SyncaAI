import { formatCompact, formatMinutes, weekdayName, zonedMinutes } from "../lib/time";
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
  /** This column is the day it is now, in the user's zone. */
  today: boolean;
  /** Already gone, in a week that still holds today. Only true alongside a `today` column. */
  past: boolean;
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
  today,
  past,
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
  // Where sixteen hours falls on a track that measures twenty-four. This is what stops the
  // track from being a second drawing of the free figure: the bar says how much of the day
  // is gone, the tick says where the budget it is measured against sits inside it.
  const budgetMark = `${String(Math.round((capacity.usable_minutes / capacity.total_minutes) * 1000) / 10)}%`;
  const warning = warningFor(capacity);

  return (
    // `data-today` rather than a class: the rail is one declaration and an attribute reads
    // as the state it is, where a class would have to be named for the thing it draws.
    <div className={cx(styles.day, over && styles.dayOver)} data-today={today ? "1" : undefined}>
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
          <span className={cx(styles.dayIndex, today && styles.dayIndexToday)}>
            {today ? "today" : dayNumber}
          </span>
          <span className={styles.dayTotalNote}>
            {capacity.total_minutes === 1440
              ? "1440 min"
              : `${String(capacity.total_minutes)} min · DST`}
          </span>
        </div>
        <div className={cx(styles.layer, styles.weekday)}>{weekday}</div>
        <div className={cx(styles.layer, styles.date, past && styles.datePast)}>{date}</div>
        {/*
         * The big number is what is *booked*, not what is free.
         *
         * Free has a floor at zero (ADR-0022), so a sixteen-hour day, a nineteen-hour day and
         * a twenty-four-hour day all rendered `0m` in this position, at this size — three very
         * different days reading identically in the one place the eye lands first. Booked has
         * no such collapse, and free keeps its meaning on the line below where it carries the
         * denominator that makes it readable.
         */}
        <div className={cx(styles.layer, styles.booked)}>
          <span data-booked className={cx(styles.bookedValue, "rise")}>
            {formatCompact(capacity.occupied_minutes)}
          </span>
          <span className={styles.bookedWord}>booked</span>
        </div>
        <div data-free className={cx(styles.layer, styles.freeOf)}>
          <span className={styles.freeOfValue}>{formatCompact(capacity.free_minutes)}</span> free of{" "}
          <span className={styles.freeOfValue}>{formatCompact(capacity.usable_minutes)}</span>
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
            {/*
             * Once the bar has passed the budget the tick is drawn in the background colour,
             * so it reads as a notch cut out of the fill rather than a mark sitting on top of
             * it. That is the whole signal: you can see the line you crossed.
             */}
            <div
              data-budget-mark
              className={cx(styles.budgetMark, over && styles.budgetMarkPassed)}
              style={{ left: budgetMark }}
            />
          </div>
        </div>
        <div className={cx(styles.layer, styles.dayMeta)}>
          {/*
           * Unbooked is measured against the whole calendar day, not against the budget. Past
           * sixteen hours booked the budget is spent, so a figure against it would read `0m`
           * here on every day heavy enough for anyone to look — which is the same collapse
           * that moved the big number off free.
           */}
          {capacity.task_count === 0
            ? "no tasks"
            : `${String(capacity.task_count)} ${capacity.task_count === 1 ? "task" : "tasks"} · ${formatMinutes(capacity.unbooked_minutes)} of the day unbooked`}
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
