import {
  MINUTES_IN_A_DAY,
  clock,
  formatCompact,
  minutesBetween,
  weekdayLong,
  weekdayName,
  zonedMinutes,
  zonedStamp,
} from "../lib/time";
import type { DayCapacity, NewTask, Task, TaskChanges } from "../api/types";
import { type Carried, splitOf } from "./carried";
import { CarriedBand } from "./CarriedBand";
import { warningFor } from "./load";
import { type Panel, TaskRow } from "./TaskRow";
import { NewTaskForm } from "./NewTaskForm";
import { cx } from "../lib/cx";
import day from "./Day.module.css";

/**
 * The longest a local day can be, in minutes. A day that gains an hour at a daylight saving
 * transition has 1500, and the trail is scaled against that so every day in the week is
 * measured on one ruler.
 */
const LONGEST_DAY = 1500;

/** Where `minutes` falls on the ruler, as a CSS percentage rounded to a tenth. */
function onRuler(minutes: number): string {
  return `${String(Math.round((minutes / LONGEST_DAY) * 1000) / 10)}%`;
}

/**
 * How a crossing task reads on the row that owns it, or null when it stays in its own day.
 *
 * Both weekdays are named rather than left to `+1`, because the mark says only *that* it
 * crosses. Which day gets how much is the thing somebody planning is actually asking.
 */
function splitText(task: Task, timeZone: string, own: string, next: string): string | null {
  const split = splitOf(task, timeZone);
  if (split === null) return null;

  return `crosses midnight · ${formatCompact(split.own)} ${own} / ${formatCompact(split.into)} ${next}`;
}

/**
 * When a task was finished, how long it took, and how that compares to the plan.
 *
 * Measured to `completed_at` rather than to `end_at`, and the difference is the whole point.
 * The trigger clamps `end_at` to the planned end (ADR-0022), so reading the overrun off it
 * would report every late finish as exact — and running past an estimate is the datum the
 * planner in S6 is being given, not a failure to hide.
 *
 * In the neutral ink either way. The accent means trouble, and taking longer than you
 * guessed is not trouble.
 */
function doneText(task: Task, timeZone: string): string | null {
  if (task.completed_at === null) return null;

  const at = clock(zonedMinutes(task.completed_at, timeZone));
  const actual = minutesBetween(task.start_at, task.completed_at);

  // A task ticked days after it ran measures when somebody remembered, not how long it took.
  // The design never meets this case — it works in minutes since midnight and wraps once, so
  // it cannot produce more than a day — but the box makes it a click away: forget Monday's
  // task, tick it on Wednesday, and the comparison reads `56h22 of 2h30 · +53h52`. True about
  // the clock and false about the work, on the row the planner reads plan-versus-actual from.
  //
  // A day is the bound because the schema already uses it: no task may exceed 1440 minutes,
  // so a completion further out than that cannot be describing the task's own run.
  if (actual < 0 || actual > MINUTES_IN_A_DAY) {
    return `done ${zonedStamp(task.completed_at, timeZone)} ${at}`;
  }

  const delta = actual - task.duration_minutes;
  const against =
    delta === 0 ? "to the minute" : `${delta < 0 ? "−" : "+"}${formatCompact(Math.abs(delta))}`;

  return `done ${at} · ${formatCompact(actual)} of ${formatCompact(task.duration_minutes)} · ${against}`;
}

interface Props {
  capacity: DayCapacity;
  tasks: Task[];
  /** All seven days and every task on screen. A row's move panel weighs the whole week. */
  week: DayCapacity[];
  allTasks: Task[];
  /** What the day before is still holding when this one starts. */
  carried: Carried[];
  /**
   * Focus the row that owns a carried task, or null when that row is not on this screen.
   *
   * Null on the first column and only there: what it inherits comes from the day before the
   * week, which is fetched so the figures are right and never rendered.
   */
  onGoToOwner: ((taskId: string) => void) | null;
  /** The one row open anywhere on the screen, or null. One at a time, like the design. */
  openTask: { id: string; panel: Panel } | null;
  /** The tasks whose last write the screen does not show yet. */
  saving: ReadonlySet<string>;
  onOpenTask: (open: { id: string; panel: Panel } | null) => void;
  onSaveTask: (taskId: string, changes: TaskChanges) => Promise<void>;
  onDeleteTask: (task: Task, snapshot: NewTask | null) => Promise<void>;
  index: number;
  /** `Wed`, which the new task form names the day by. */
  weekday: string;
  /** `22 Oct`. */
  date: string;
  /** This column is the day it is now, in the user's zone. */
  today: boolean;
  /** Before today, in any week. Nothing new can start on it, so it offers nothing new. */
  past: boolean;
  timezone: string;
  formOpen: boolean;
  submitting: boolean;
  serverError: string | null;
  onHover: (day: string | null) => void;
  onOpenForm: (day: string) => void;
  onCancelForm: () => void;
  onCreate: (task: NewTask) => void;
  onToggle: (task: Task) => Promise<void>;
}

export function DayColumn({
  capacity,
  tasks,
  week,
  allTasks,
  carried,
  onGoToOwner,
  openTask,
  saving,
  onOpenTask,
  onSaveTask,
  onDeleteTask,
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
  const dayNumber = String(index + 1).padStart(2, "0");
  const over = capacity.over_capacity;
  // Against the budget, the same thing `over_capacity` is measured against. Against the
  // calendar day this would be negative on every day that flag is ever true.
  const overBy = capacity.occupied_minutes - capacity.usable_minutes;
  const warning = warningFor(capacity);
  // ISO weekdays run 1..7 from Monday, so both neighbours wrap rather than clamp.
  const previousWeekday = weekdayName(((capacity.weekday + 5) % 7) + 1);
  const nextWeekday = weekdayName((capacity.weekday % 7) + 1);
  const budget = formatCompact(capacity.usable_minutes);
  // What a screen reader is told in place of the drawing. The day's length is said here and
  // nowhere else, since the trail is what shows it: a caption would put a second "24h" in a
  // header whose only other hours are the booked figure and the budget.
  const trail = `${String(capacity.total_minutes / 60)}-hour day, ${formatCompact(capacity.occupied_minutes)} booked against a ${budget} budget`;

  return (
    <div className={cx(day.day, over && day.dayOver)} data-day={capacity.day}>
      <div
        className={day.head}
        onMouseEnter={() => {
          // A day that has gone is never N's target, as it never shows "+ new task".
          onHover(past ? null : capacity.day);
        }}
        onMouseLeave={() => {
          onHover(null);
        }}
      >
        <div className={day.title}>
          <div className={day.name}>
            <span className={cx(day.weekday, past && day.weekdayPast)}>
              {weekdayLong(capacity.weekday)}
            </span>
            <span className={day.date}>{date}</span>
          </div>
          {today && <span className={day.today}>today</span>}
        </div>
        {/*
         * The big number is what is *booked*, not what is free.
         *
         * Free has a floor at zero (ADR-0022), so a sixteen-hour day, a nineteen-hour day and
         * a twenty-four-hour day all rendered `0m` in this position, at this size — three very
         * different days reading identically in the one place the eye lands first. Booked has
         * no such collapse, and free keeps its meaning on the line below where it carries the
         * denominator that makes it readable. That line is the only place the budget appears.
         */}
        <div className={day.figures}>
          <div className={day.booked}>
            <span data-booked className={day.bookedValue}>
              {formatCompact(capacity.occupied_minutes)}
            </span>
            <span className={day.bookedWord}>booked</span>
          </div>
          <span data-free className={day.free}>
            <span className={day.figure}>{formatCompact(capacity.free_minutes)}</span> free of{" "}
            <span className={day.figure}>{budget}</span>
          </span>
        </div>
        {over && <span className={day.over}>over by {formatCompact(overBy)}</span>}
        <div role="img" aria-label={trail} className={day.trail}>
          <span data-track className={day.track} style={{ width: onRuler(capacity.total_minutes) }} />
          {/* Clipped at the day's end: minutes past midnight belong to the next day's trail. */}
          <span
            className={cx(day.bar, over && day.barOver)}
            style={{ width: onRuler(Math.min(capacity.occupied_minutes, capacity.total_minutes)) }}
          />
          {/* Where the budget falls, and where the day ends. The bar says how much of the day
              is gone; the first tick says where the line it is measured against sits. */}
          <span
            data-budget-mark
            className={cx(day.tick, over && day.tickCut)}
            style={{ left: `calc(${onRuler(capacity.usable_minutes)} - 1px)` }}
          />
          <span
            data-day-end
            className={day.tick}
            style={{ left: `calc(${onRuler(capacity.total_minutes)} - 2px)` }}
          />
        </div>
        {warning.message !== null && <span className={day.level}>{warning.message}</span>}
      </div>

      {carried.length > 0 && (
        <CarriedBand
          carried={carried}
          fromWeekday={previousWeekday}
          timezone={timezone}
          bookedMinutes={capacity.occupied_minutes}
          onGoToOwner={onGoToOwner}
        />
      )}

      {tasks.map((task, position) => (
        <TaskRow
          key={task.id}
          task={task}
          index={`${dayNumber}.${String(position + 1).padStart(2, "0")}`}
          minutesFromMidnight={zonedMinutes(task.start_at, timezone)}
          split={splitText(task, timezone, weekdayName(capacity.weekday), nextWeekday)}
          doneLine={doneText(task, timezone)}
          timezone={timezone}
          days={week}
          allTasks={allTasks}
          open={openTask?.id === task.id ? openTask.panel : null}
          saving={saving.has(task.id)}
          onOpen={(panel) => {
            onOpenTask(panel === null ? null : { id: task.id, panel });
          }}
          onSave={(changes) => onSaveTask(task.id, changes)}
          onToggle={onToggle}
          onDelete={(snapshot) => onDeleteTask(task, snapshot)}
        />
      ))}

      {/* A day holding only inherited minutes is not empty, and saying it is would
          contradict both the figure above and the band. */}
      {capacity.task_count === 0 && carried.length === 0 && !formOpen && (
        <span className={day.empty}>Nothing booked.</span>
      )}

      {formOpen && (
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
      )}
      {/* From today on, in any week: a day that has gone cannot take a new start, and a button
          the server would refuse every time is not an offer. */}
      {!formOpen && !past && (
        <button
          type="button"
          // Where focus goes when the last row of this day is deleted: the nearest thing in
          // the column somebody can still act on.
          data-new-task={capacity.day}
          className={day.newTask}
          aria-keyshortcuts="N"
          onClick={() => {
            onOpenForm(capacity.day);
          }}
        >
          + new task
          <kbd aria-hidden="true" className={day.key}>
            N
          </kbd>
        </button>
      )}
    </div>
  );
}
