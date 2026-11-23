/**
 * The one day on screen below 1100px, as day-phone.dc.html draws it (ADR-0056).
 *
 * Its heading, how many tasks it holds, the booked figure large and the free one under it with
 * its denominator, a trail with each task where it falls and a mark for now, the load sentence
 * from the server's ladder, the heavy day's offer, and the day's tasks as a list: the band
 * carried from the night before, the rows, or a word that there is nothing.
 *
 * In the desktop's words where the two drawings name the same thing (docs/design/README.md):
 * "booked", "today", the date as `22 Oct`, the band's words and "Nothing booked." The count and
 * the trail's marks are the phone's own.
 */
import { useId } from "react";

import type { DayCapacity, NewTask, Task, TaskChanges } from "../api/types";
import { cx } from "../lib/cx";
import {
  formatCompact,
  startOfLocalDay,
  weekdayLong,
  weekdayName,
  zonedDay,
  zonedMinutes,
} from "../lib/time";
import type { Carried } from "./carried";
import { CarriedBand } from "./CarriedBand";
import { doneText, onRuler, splitText } from "./DayColumn";
import { DayRow } from "./DayRow";
import { HeavyDayOffer } from "./HeavyDayOffer";
import { warningFor } from "./load";
import { heavyDayOffer } from "./move";
import { occupancyOf } from "./occupancy";
import type { Panel } from "./RowPanels";
import type { ChecklistChange } from "./useWeek";
import { type Proposed, ProposedItem } from "../plan/ProposedRow";
import list from "./DayView.module.css";

const MINUTE = 60_000;

interface Props {
  capacity: DayCapacity;
  /** The tasks that begin on this day: its rows. */
  tasks: Task[];
  /** All seven days and every task fetched: what the offer and the move panel weigh. */
  week: DayCapacity[];
  allTasks: Task[];
  carried: Carried[];
  /** Put the day before on screen with the owning row open, or null on a Monday. */
  onGoToOwner: ((taskId: string) => void) | null;
  openTask: { id: string; panel: Panel } | null;
  saving: ReadonlySet<string>;
  onOpenTask: (open: { id: string; panel: Panel } | null) => void;
  onSaveTask: (taskId: string, changes: TaskChanges, sentence?: string) => Promise<void>;
  onDeleteTask: (task: Task, snapshot: NewTask | null) => Promise<void>;
  /** Its place in the week, Monday zero: where "go to date" sends focus, `2:0`. */
  index: number;
  /** `22 Oct`. */
  date: string;
  today: boolean;
  timezone: string;
  onToggle: (task: Task) => Promise<void>;
  onChecklist: (taskId: string, change: ChecklistChange) => Promise<void>;
  /** The steps of the plan under review that would land on this day (plan.dc.html). */
  proposed?: Proposed[];
  /** Open the review on a step. */
  onOpenStep?: (itemId: string) => void;
  /** Open the page of the plan a task came from. */
  onOpenPlan?: ((planId: string) => void) | undefined;
}

export function DayList({
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
  date,
  today,
  timezone,
  onToggle,
  onChecklist,
  proposed = [],
  onOpenStep,
  onOpenPlan,
}: Props): React.ReactNode {
  const heading = useId();
  // The rows and the plan's proposed steps, in the order they start.
  const rows = [
    ...tasks.map((task) => ({ task, at: Date.parse(task.start_at) })),
    ...proposed.map((step) => ({ step, at: Date.parse(step.item.start_at) })),
  ].sort((a, b) => a.at - b.at);
  const added = proposed.reduce((sum, step) => sum + step.item.minutes, 0);
  const weekday = weekdayLong(capacity.weekday);
  const previousWeekday = weekdayName(((capacity.weekday + 5) % 7) + 1);
  const nextWeekday = weekdayName((capacity.weekday % 7) + 1);
  const warning = warningFor(capacity);
  const now = new Date();
  const offer = heavyDayOffer(capacity, tasks, week, allTasks, timezone, now);

  // Each task where it falls in this day, clipped at its edges: a task from the night before
  // shows at the start, and one running past midnight stops at the end.
  const start = startOfLocalDay(capacity.day, timezone).getTime();
  const end = start + capacity.total_minutes * MINUTE;
  const segments = allTasks.flatMap((task) => {
    const held = occupancyOf(task);
    const from = Math.max(held.start, start);
    const to = Math.min(held.end, end);
    return to > from ? [{ id: task.id, from: (from - start) / MINUTE, length: (to - from) / MINUTE }] : [];
  });
  // On the same ruler as the week at a glance, so a 25-hour day draws longer.
  const ofDay = (minutes: number): string => `${String((minutes / capacity.total_minutes) * 100)}%`;

  return (
    <section aria-labelledby={heading} data-day={capacity.day} className={list.day}>
      <div className={list.dayHead}>
        <div className={list.titleLine}>
          {/* Where "go to date" puts focus: a heading takes it from script, and adds no stop. */}
          <h2 id={heading} tabIndex={-1} data-cell={`${String(index)}:0`} className={list.dayTitle}>
            {weekday} {date}
          </h2>
          {today && <span className={list.todayPill}>today</span>}
          <span className={list.count}>
            {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
          </span>
        </div>
        <p className={list.bookedLine}>
          <span className={list.big}>{formatCompact(capacity.occupied_minutes)}</span>
          <span className={list.bookedWord}>booked</span>
        </p>
        <p role="status" className={list.free}>
          {formatCompact(capacity.free_minutes)} free of {formatCompact(capacity.usable_minutes)}
        </p>
        <div
          role="img"
          aria-label={`${formatCompact(capacity.occupied_minutes)} booked of a ${formatCompact(capacity.total_minutes)} day`}
          className={list.trail}
          style={{ width: onRuler(capacity.total_minutes) }}
        >
          <div className={list.trailTrack}>
            {segments.map((segment) => (
              <span
                key={segment.id}
                className={list.segment}
                style={{ left: ofDay(segment.from), width: ofDay(segment.length) }}
              />
            ))}
          </div>
          {today && (
            <span
              className={list.now}
              // Real minutes since the day began, not the clock's: they differ on the day the
              // clocks change, and the trail is drawn in real minutes.
              style={{ left: ofDay((now.getTime() - start) / MINUTE) }}
            />
          )}
        </div>
        {added > 0 && (
          <p className={list.free}>+{formatCompact(added)} proposed by your plan, not booked yet</p>
        )}
        {warning.message !== null && <p className={list.load}>{warning.message}</p>}
      </div>

      {offer !== null && (
        <HeavyDayOffer
          key={`${offer.task.id}:${offer.to.day}`}
          offer={offer}
          weekday={weekdayName(capacity.weekday)}
          free={week.find((other) => other.day === offer.to.day)?.free_minutes ?? 0}
          thisWeek={week.some((other) => other.day === zonedDay(now.toISOString(), timezone))}
          timezone={timezone}
          tabbable
          onSave={onSaveTask}
        />
      )}

      <ul aria-label={`Tasks on ${weekday} ${date}`} className={list.rows}>
        {carried[0] !== undefined && (
          <CarriedBand
            entry={carried[0]}
            fromWeekday={previousWeekday}
            timezone={timezone}
            onGoToOwner={onGoToOwner}
          />
        )}
        {rows.map((row) => {
          if ("step" in row) {
            const { step } = row;
            return (
              <ProposedItem
                key={step.item.id}
                {...step}
                timezone={timezone}
                onOpen={() => {
                  onOpenStep?.(step.item.id);
                }}
              />
            );
          }
          const { task } = row;
          const split = splitText(task, timezone, weekdayName(capacity.weekday), nextWeekday);
          return (
            <DayRow
              key={task.id}
              task={task}
              minutesFromMidnight={zonedMinutes(task.start_at, timezone)}
              crosses={split !== null}
              doneLine={doneText(task, timezone) ?? split}
              timezone={timezone}
              days={week}
              allTasks={allTasks}
              open={openTask?.id === task.id ? openTask.panel : null}
              saving={saving.has(task.id)}
              onOpen={(panel) => {
                onOpenTask(panel === null ? null : { id: task.id, panel });
              }}
              onSave={(changes, sentence) => onSaveTask(task.id, changes, sentence)}
              onToggle={onToggle}
              onDelete={(snapshot) => onDeleteTask(task, snapshot)}
              onChecklist={(change) => onChecklist(task.id, change)}
              onOpenPlan={onOpenPlan}
            />
          );
        })}
        {/* A day holding only inherited minutes is not empty. */}
        {tasks.length === 0 && carried.length === 0 && (
          <li className={cx(list.item, list.empty)}>Nothing booked.</li>
        )}
      </ul>
    </section>
  );
}
