import { useEffect, useRef, useState } from "react";

import { useSession } from "../auth/useSession";
import { daysFrom, formatMinutes, isoWeek, stamp, weekdayName, zonedDay } from "../lib/time";
import type { NewTask } from "../api/types";
import { DayColumn } from "./DayColumn";
import { WeekSkeleton } from "./WeekSkeleton";
import { WeekUnreachable } from "./WeekUnreachable";
import { lightestDay } from "./load";
import { useWeek } from "./useWeek";
import styles from "./Week.module.css";

export function WeekScreen(): React.ReactNode {
  const { signOut } = useSession();
  const week = useWeek();
  const [openDay, setOpenDay] = useState<string | null>(null);
  const hovered = useRef<string | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      // Narrowed rather than asserted. The listener is on `window`, so the target really is
      // an `EventTarget` — with nothing focused it is `window` or `document`, neither of
      // which has a `tagName`. Casting it to `HTMLElement | null` said otherwise, and the
      // read threw and took every shortcut on this screen down with it.
      const target = event.target;
      const tag = target instanceof HTMLElement ? target.tagName.toLowerCase() : null;
      // A shortcut that fires while somebody is typing is not a shortcut, it is a bug that
      // eats a letter.
      if (tag === "input" || tag === "textarea") return;

      if (event.key === "Escape") {
        setOpenDay(null);
      } else if ((event.key === "n" || event.key === "N") && hovered.current !== null) {
        event.preventDefault();
        setOpenDay(hovered.current);
      } else if (event.key === "t" || event.key === "T") {
        // Unconditional, including when it is already zero. A key that silently does nothing
        // on the week you are already on is indistinguishable from one that is broken.
        event.preventDefault();
        week.goTo(0);
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
  // Against the usable budget, so the week's headline figure means the same thing as each
  // day's. Summing the calendar days here would put 168h on a screen whose columns say 16h.
  const usableMinutes = week.days.reduce((sum, day) => sum + day.usable_minutes, 0);
  const bookedMinutes = week.days.reduce((sum, day) => sum + day.occupied_minutes, 0);
  const taskCount = week.days.reduce((sum, day) => sum + day.task_count, 0);
  const overDays = week.days.filter((day) => day.over_capacity).length;

  // In the zone the *server* stores, not the browser's. The two can differ, and a screen that
  // marked today from the browser would put the rail on the wrong column for a user who
  // travelled — silently, which is the worst way to be wrong about which day it is.
  const todayKey = zonedDay(new Date().toISOString(), week.me.timezone);
  const todayIndex = week.days.findIndex((day) => day.day === todayKey);
  const { week: weekNumber, year } = isoWeek(week.monday);
  const distance = Math.abs(week.offset);

  return (
    <div className={styles.frame}>
      <div className={styles.chrome}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
          <span className={styles.wordmark}>SyncaAI</span>
          <span className={styles.meta}>
            week {String(weekNumber).padStart(2, "0")} · {String(year)}
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
            {stamp(week.monday)} — {stamp(dates[6] as Date)}
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
          <button
            type="button"
            className={styles.home}
            disabled={week.offset === 0}
            onClick={() => {
              week.goTo(0);
            }}
          >
            <span>this week</span>
            <span className={styles.key}>T</span>
          </button>
          {/*
           * How far from now, in words. `[` and `]` move a week at a time and the date range
           * alone does not say how many of them have been pressed — three weeks out reads as
           * a plausible set of dates unless something counts them.
           */}
          {week.offset !== 0 && (
            <span data-away className={styles.away}>
              {week.offset > 0 ? "+" : "-"}
              {String(distance)} {distance === 1 ? "week" : "weeks"}
            </span>
          )}
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
        {/* Booked leads here for the same reason it leads in a column: free floors at zero,
            and a week that reads `0m free` at the top says nothing about how full it is. */}
        <div className={styles.summaryFigures}>
          <span className={styles.figureStrong}>{formatMinutes(bookedMinutes)} booked</span>
          <span className={styles.figure}>
            {formatMinutes(Math.max(0, usableMinutes - bookedMinutes))} free of{" "}
            {formatMinutes(usableMinutes)} budget
          </span>
          <span className={styles.figure}>
            {taskCount} {taskCount === 1 ? "task" : "tasks"}
          </span>
          {overDays > 0 && (
            <span className={styles.chip}>
              {overDays} {overDays === 1 ? "day" : "days"} over budget
            </span>
          )}
        </div>
        {/* Only the keys that do something today. The design's legend lists nine; the other
            six belong to verbs that do not exist yet, and a legend that promises them is a
            worse guide than a short one. It grows as they land. */}
        <div className={styles.legend}>
          {[
            { key: "space", word: "complete" },
            { key: "N", word: "new" },
            { key: "T", word: "this week" },
          ].map((entry) => (
            <span key={entry.key} className={styles.legendItem}>
              <span className={styles.key}>{entry.key}</span>
              <span className={styles.legendWord}>{entry.word}</span>
            </span>
          ))}
        </div>
      </div>

      <div className={styles.grid}>
        {week.days.map((capacity, index) => (
          <DayColumn
            key={capacity.day}
            capacity={capacity}
            lighter={capacity.load === "fine" ? null : lightestDay(week.days, capacity.day)}
            tasks={week.byDay.get(capacity.day) ?? []}
            index={index}
            weekday={weekdayName(capacity.weekday)}
            date={stamp(dates[index] as Date)}
            today={index === todayIndex}
            // Only inside the week that holds today. A week entirely in the past would
            // otherwise render seven greyed dates, which is a lot of recessive ink to say
            // one thing the header already says.
            past={todayIndex >= 0 && index < todayIndex}
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
            {formatMinutes(usableMinutes)} free across seven days.
          </span>
          <span className={styles.emptyWeekNote}>
            Capacity is known before anything is on it.
          </span>
        </div>
      )}
    </div>
  );
}
