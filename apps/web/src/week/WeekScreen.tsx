import { useEffect, useRef, useState } from "react";

import { ApiError } from "../api/client";
import { useSession } from "../auth/useSession";
import { dayMonth, daysFrom, weekRange, weekdayName, zonedDay } from "../lib/time";
import type { NewTask, Task } from "../api/types";
import { type Shortcut, ShortcutLegend } from "../ui/ShortcutLegend";
import { type Notice, StatusRegion } from "../ui/StatusRegion";
import { DayColumn } from "./DayColumn";
import { WeekHeader } from "./WeekHeader";
import { WeekSkeleton } from "./WeekSkeleton";
import { WeekUnreachable } from "./WeekUnreachable";
import type { Panel } from "./TaskRow";
import type { Trash } from "./Trash";
import { useWeek } from "./useWeek";
import styles from "./WeekScreen.module.css";

/**
 * Where focus goes once a write has come back.
 *
 * A task's title, or a day's `new task` button when the day has no row left to land on. By id
 * and by day rather than by element: the element that had focus does not survive the reload.
 */
type FocusTarget = { task: string } | { newTaskOn: string };

/**
 * The keys that do something today, in the design's order and words.
 *
 * The round's legend has fifteen. The arrows, Home and End, `C` and Alt with the arrows wait
 * for the row grid and the checklist panel; Space waits too, because on a row's title today it
 * presses the button and opens the row, which is the opposite of what the legend would say. A
 * legend that promises a key is a worse guide than a short one, so each joins when it works.
 * `N` reaches the day under the pointer until the grid gives the week a focused day.
 */
const SHORTCUTS: Shortcut[] = [
  { keys: ["Enter"], label: "open or close a row" },
  { keys: ["E"], label: "edit" },
  { keys: ["M"], label: "move" },
  { keys: ["O"], label: "note" },
  { keys: ["⌫"], label: "delete" },
  { keys: ["N"], label: "new task on the day under the pointer" },
  { keys: ["[", "]"], label: "previous or next week" },
  { keys: ["T"], label: "back to this week" },
  { keys: ["Ctrl", "Z"], label: "undo a delete" },
  { keys: ["Esc"], label: "close" },
];

/** `Thu 22`, for a local date: what the status region calls the day a task was on. */
function dayLabel(localDate: string): string {
  // Noon UTC, so no zone can move the date the weekday is read from.
  const weekday = new Date(`${localDate}T12:00:00Z`).getUTCDay();
  return `${weekdayName(weekday === 0 ? 7 : weekday)} ${String(Number(localDate.slice(8, 10)))}`;
}

export function WeekScreen(): React.ReactNode {
  const { signOut } = useSession();
  const week = useWeek();
  const [openDay, setOpenDay] = useState<string | null>(null);
  // One row open across the whole week, not one per column. Two panels standing open at once
  // would each be offering to act on a different task with nothing saying which is in front.
  const [openTask, setOpenTask] = useState<{ id: string; panel: Panel } | null>(null);
  const hovered = useRef<string | null>(null);
  // Every write reloads the week, and the row somebody acted on may not be where it was when
  // the new week arrives: moved to another day, deleted, or brought back under a new id. Focus
  // is put on the week that arrives after the write — `after` is the load it has to be newer
  // than, so it is never applied to the week the write was made on. A ref, not state: nothing
  // renders from it, and it is the arrival of the week that has to trigger it.
  const pendingFocus = useRef<{ target: FocusTarget; after: number } | null>(null);
  const { loaded, status } = week;
  // The last restorable delete, for as long as it can be undone. One across the week, like the
  // open row: a second delete replaces the first notice, as the design does. The region times
  // it out; a refusal is a new notice, so its sentence gets its own nine seconds to be read.
  const [trash, setTrash] = useState<Trash | null>(null);
  const deletes = useRef(0);

  useEffect(() => {
    const pending = pendingFocus.current;
    if (pending === null || status !== "ready" || loaded <= pending.after) return;
    pendingFocus.current = null;

    const { target } = pending;
    const element =
      "task" in target
        ? document.getElementById(`task-${target.task}`)?.querySelector<HTMLElement>("[aria-expanded]")
        : document.querySelector<HTMLElement>(`[data-new-task="${target.newTaskOn}"]`);
    element?.focus();
  }, [loaded, status]);

  function focusOnceReloaded(target: FocusTarget): void {
    pendingFocus.current = { target, after: loaded };
  }

  async function undo(): Promise<void> {
    if (trash === null || trash.restoring || trash.failure !== null) return;
    const deleted = trash;
    setTrash({ ...deleted, restoring: true });
    // Each answer touches only its own delete: another may have replaced it meanwhile.
    try {
      // A recreate, so a new id. Focus follows the task that exists now, found by the id the
      // server just gave it, never by the one that was deleted.
      const restored = await week.restore(deleted.snapshot);
      setTrash((current) => (current?.id === deleted.id ? null : current));
      focusOnceReloaded({ task: restored.id });
    } catch (problem) {
      const failure = problem instanceof ApiError ? problem.detail : "Couldn’t reach the server.";
      setTrash((current) =>
        current?.id === deleted.id ? { ...deleted, restoring: false, failure } : current,
      );
    }
  }

  const notice: Notice | null =
    trash === null
      ? null
      : trash.failure !== null
        ? {
            id: `${String(trash.id)}:refused`,
            text: `“${trash.title}” was not brought back. ${trash.failure}`,
          }
        : trash.restoring
          ? {
              id: `${String(trash.id)}:restoring`,
              text: `Restoring “${trash.title}”…`,
              busy: true,
            }
          : {
              id: `${String(trash.id)}:deleted`,
              text: `Deleted “${trash.title}” from ${dayLabel(trash.day)}.`,
              action: {
                label: "undo",
                run: () => {
                  void undo();
                },
                undoKey: true,
              },
            };
  // In every state the screen can be in, at the same place in the tree, so it is one region
  // that stays in the page through every reload rather than a new one each time.
  const region = (
    <StatusRegion
      notice={notice}
      onExpire={() => {
        setTrash(null);
      }}
    />
  );

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
        setOpenTask(null);
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

  const dates = daysFrom(week.monday);

  // The header and the legend sit at the same place in every state, so between one week and
  // the next they stay mounted: focus stays on the › that was pressed, and a folded legend
  // stays folded.
  const top = (
    <>
      <WeekHeader
        range={weekRange(week.monday, dates[6] as Date)}
        offset={week.offset}
        me={week.me}
        onGoTo={week.goTo}
        onSignOut={() => {
          void signOut();
        }}
      />
      <ShortcutLegend shortcuts={SHORTCUTS} />
    </>
  );

  if (week.status === "loading") {
    return (
      <>
        <main className={styles.page}>
          {top}
          <WeekSkeleton monday={week.monday} />
        </main>
        {region}
      </>
    );
  }
  if (week.status === "unreachable" || week.me === null) {
    return (
      <>
        <main className={styles.page}>
          {top}
          <WeekUnreachable monday={week.monday} onRetry={week.reload} />
        </main>
        {region}
      </>
    );
  }

  // In the zone the *server* stores, not the browser's. The two can differ, and a screen that
  // marked today from the browser would mark the wrong day for a user who travelled —
  // silently, which is the worst way to be wrong about which day it is.
  const todayKey = zonedDay(new Date().toISOString(), week.me.timezone);

  // Focus rather than scroll: moving the keyboard there is what makes the way back usable by
  // somebody who is not holding a mouse. `scrollIntoView` would move the eye and leave the
  // focus in the band it came from.
  //
  // The target is the row's disclosure, not the row. The row is a plain container with no tab
  // stop of its own — `focus()` on it silently does nothing, which is how this quietly stopped
  // working when the row gave up being focusable.
  function focusTask(taskId: string): void {
    const row = document.getElementById(`task-${taskId}`);
    row?.querySelector<HTMLElement>("[aria-expanded]")?.focus();
  }

  // Focus may not stay on a row that no longer exists. It goes where the same convention
  // already sends it — a row's title — and to the next row in the day, or the one before it,
  // so a run of deletes walks down a day; with none left, to the day's `new task` button.
  function focusAfterDeleting(task: Task, timezone: string): FocusTarget {
    const day = zonedDay(task.start_at, timezone);
    const rows = week.byDay.get(day) ?? [];
    const at = rows.findIndex((row) => row.id === task.id);
    const neighbour = rows[at + 1] ?? rows[at - 1];
    return neighbour === undefined ? { newTaskOn: day } : { task: neighbour.id };
  }

  const timezone = week.me.timezone;

  return (
    <>
      <main className={styles.page}>
        {top}
        <div className={styles.grid}>
          {week.days.map((capacity, index) => (
            <DayColumn
              key={capacity.day}
              capacity={capacity}
              tasks={week.byDay.get(capacity.day) ?? []}
              week={week.days}
              allTasks={week.tasks}
              carried={week.carried.get(capacity.day) ?? []}
              // Null on the first column only. What Monday inherits comes from the Sunday
              // before the week — fetched so the figures are right, never rendered — so there
              // is no row on this screen to send anybody to.
              onGoToOwner={index === 0 ? null : focusTask}
              openTask={openTask}
              saving={week.saving}
              onOpenTask={setOpenTask}
              onSaveTask={async (taskId, changes) => {
                await week.update(taskId, changes);
                // Back to the resting panel rather than shut. The row stays where the reader
                // was, and the change they just made is on it — on another column, after a move.
                setOpenTask({ id: taskId, panel: "open" });
                focusOnceReloaded({ task: taskId });
              }}
              onDeleteTask={async (task, snapshot) => {
                const target = focusAfterDeleting(task, timezone);
                // Sent now, not when the window closes: holding the DELETE would keep the slot
                // taken from somebody deleting precisely to free it (the division of item 2).
                await week.remove(task.id);
                setOpenTask(null);
                // A confirmed delete has no undo, and leaves any notice already showing alone.
                if (snapshot !== null) {
                  deletes.current += 1;
                  setTrash({
                    id: deletes.current,
                    day: zonedDay(task.start_at, timezone),
                    title: task.title,
                    snapshot,
                    restoring: false,
                    failure: null,
                  });
                }
                focusOnceReloaded(target);
              }}
              index={index}
              weekday={weekdayName(capacity.weekday)}
              date={dayMonth(dates[index] as Date)}
              today={capacity.day === todayKey}
              // Local dates as YYYY-MM-DD compare as strings in calendar order.
              past={capacity.day < todayKey}
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
      </main>
      {region}
    </>
  );
}
