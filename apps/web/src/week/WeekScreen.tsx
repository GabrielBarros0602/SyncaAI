import { useEffect, useRef, useState } from "react";

import { useSession } from "../auth/useSession";
import { daysFrom, formatMinutes, stamp, toLocalDate, weekdayName } from "../lib/time";
import type { NewTask } from "../api/types";
import { DayColumn } from "./DayColumn";
import { WeekSkeleton } from "./WeekSkeleton";
import { WeekUnreachable } from "./WeekUnreachable";
import { useWeek } from "./useWeek";
import styles from "./Week.module.css";

export function WeekScreen(): React.ReactNode {
  const { signOut } = useSession();
  const week = useWeek();
  const [openDay, setOpenDay] = useState<string | null>(null);
  const hovered = useRef<string | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName.toLowerCase();
      // A shortcut that fires while somebody is typing is not a shortcut, it is a bug that
      // eats a letter.
      if (tag === "input" || tag === "textarea") return;

      if (event.key === "Escape") {
        setOpenDay(null);
      } else if ((event.key === "n" || event.key === "N") && hovered.current !== null) {
        event.preventDefault();
        setOpenDay(hovered.current);
      } else if (event.key === "[") {
        week.goTo(week.offset - 1);
      } else if (event.key === "]") {
        week.goTo(week.offset + 1);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [week]);

  if (week.status === "loading") return <WeekSkeleton />;
  if (week.status === "unreachable" || week.me === null) {
    return <WeekUnreachable onRetry={week.reload} />;
  }

  const dates = daysFrom(week.monday);
  const totalMinutes = week.days.reduce((sum, day) => sum + day.total_minutes, 0);
  const bookedMinutes = week.days.reduce((sum, day) => sum + day.occupied_minutes, 0);
  const taskCount = week.days.reduce((sum, day) => sum + day.task_count, 0);
  const overDays = week.days.filter((day) => day.over_capacity).length;

  return (
    <div className={styles.frame}>
      <div className={styles.chrome}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
          <span className={styles.wordmark}>SyncaAI</span>
          <span className={styles.meta}>
            {stamp(week.monday)} — {stamp(dates[6] as Date)}
          </span>
        </div>
        <div className={styles.nav}>
          <button
            type="button"
            className={styles.ghost}
            onClick={() => {
              week.goTo(week.offset - 1);
            }}
          >
            <span>previous</span>
            <span className={styles.key}>&#91;</span>
          </button>
          <span className={styles.range}>
            {toLocalDate(week.monday)} — {toLocalDate(dates[6] as Date)}
          </span>
          <button
            type="button"
            className={styles.ghost}
            onClick={() => {
              week.goTo(week.offset + 1);
            }}
          >
            <span>next</span>
            <span className={styles.key}>&#93;</span>
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div className={styles.identity}>
            <div className={styles.identityEmail}>{week.me.email}</div>
            <div className={styles.identityZone}>{week.me.timezone}</div>
          </div>
          <button
            type="button"
            className={styles.ghost}
            onClick={() => {
              void signOut();
            }}
          >
            <span>sign out</span>
          </button>
        </div>
      </div>

      <div className={styles.summary}>
        <div className={styles.summaryFigures}>
          <span className={styles.figureStrong}>
            {formatMinutes(Math.max(0, totalMinutes - bookedMinutes))} free
          </span>
          <span className={styles.figure}>
            {formatMinutes(bookedMinutes)} booked of {formatMinutes(totalMinutes)}
          </span>
          <span className={styles.figure}>
            {taskCount} {taskCount === 1 ? "task" : "tasks"}
          </span>
          {overDays > 0 && (
            <span className={styles.chip}>
              {overDays} {overDays === 1 ? "day" : "days"} over capacity
            </span>
          )}
        </div>
        <div className={styles.hint}>
          <span>point at a day, then</span>
          <span className={styles.key}>N</span>
          <span>for a new task</span>
        </div>
      </div>

      <div className={styles.grid}>
        {week.days.map((capacity, index) => (
          <DayColumn
            key={capacity.day}
            capacity={capacity}
            tasks={week.byDay.get(capacity.day) ?? []}
            index={index}
            weekday={weekdayName(capacity.weekday)}
            date={stamp(dates[index] as Date)}
            timezone={week.me?.timezone ?? "UTC"}
            formOpen={openDay === capacity.day}
            submitting={week.creating}
            serverError={openDay === capacity.day ? week.createError : null}
            onHover={(day) => {
              hovered.current = day;
            }}
            onOpenForm={(day) => {
              week.clearCreateError();
              setOpenDay(day);
            }}
            onCancelForm={() => {
              week.clearCreateError();
              setOpenDay(null);
            }}
            onCreate={(task: NewTask) => {
              void week
                .create(task)
                .then(() => {
                  setOpenDay(null);
                })
                .catch(() => {
                  // The form stays open holding the server's message. Closing it here would
                  // throw away what the person typed for a rule they can still satisfy by
                  // moving the task an hour.
                });
            }}
            onToggle={(task) => {
              void week.toggle(task);
            }}
          />
        ))}
      </div>

      {taskCount === 0 && (
        <div className={styles.emptyWeek}>
          <span className={styles.emptyWeekHead}>Nothing booked this week.</span>
          <span className={styles.emptyWeekFigure}>
            {formatMinutes(totalMinutes)} free across seven days.
          </span>
          <span className={styles.emptyWeekNote}>
            Capacity is known before anything is on it.
          </span>
        </div>
      )}
    </div>
  );
}
