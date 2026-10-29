import { useEffect, useRef, useState } from "react";

import { ApiError } from "../api/client";
import { useSession } from "../auth/useSession";
import {
  dayMonth,
  daysFrom,
  weekRange,
  weekdayOf,
  zonedDay,
} from "../lib/time";
import type { Task } from "../api/types";
import { type Shortcut, ShortcutLegend } from "../ui/ShortcutLegend";
import { type Notice, StatusRegion } from "../ui/StatusRegion";
import { DayColumn } from "./DayColumn";
import { NewTaskDialog } from "./NewTaskDialog";
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
 * The round's legend has fifteen. `C` and Alt with the arrows wait for the checklist panel: a
 * legend that promises a key is a worse guide than a short one, so each joins when it works.
 */
const SHORTCUTS: Shortcut[] = [
  { keys: ["←", "→", "↑", "↓"], label: "move between days and rows" },
  { keys: ["Home", "End"], label: "first or last in a day" },
  { keys: ["Enter"], label: "open or close a row" },
  { keys: ["Space"], label: "mark done" },
  { keys: ["E"], label: "edit" },
  { keys: ["M"], label: "move" },
  { keys: ["O"], label: "note" },
  { keys: ["⌫"], label: "delete" },
  { keys: ["N"], label: "new task on the focused day" },
  { keys: ["[", "]"], label: "previous or next week" },
  { keys: ["T"], label: "back to this week" },
  { keys: ["Ctrl", "Z"], label: "undo a delete" },
  { keys: ["Esc"], label: "close" },
];

/** `Thu 22`, for a local date: what the status region calls the day a task was on. */
function dayLabel(localDate: string): string {
  return `${weekdayOf(localDate)} ${String(Number(localDate.slice(8, 10)))}`;
}

export function WeekScreen(): React.ReactNode {
  const { signOut } = useSession();
  const week = useWeek();
  const [openDay, setOpenDay] = useState<string | null>(null);
  // One row open across the whole week, not one per column. Two panels standing open at once
  // would each be offering to act on a different task with nothing saying which is in front.
  const [openTask, setOpenTask] = useState<{ id: string; panel: Panel } | null>(null);
  // Where the week's one tab stop is (ADR-0053), for the week it was set in. Another week
  // starts again from today's header, or Monday's when today is not in it.
  const [focus, setFocus] = useState<{ offset: number; day: number; cell: number } | null>(null);
  // In the zone the *server* stores, not the browser's. The two can differ, and a screen that
  // marked today from the browser would mark the wrong day for a user who travelled —
  // silently, which is the worst way to be wrong about which day it is.
  const todayKey = week.me === null ? null : zonedDay(new Date().toISOString(), week.me.timezone);
  const todayIndex = week.days.findIndex((day) => day.day === todayKey);
  const current =
    focus !== null && focus.offset === week.offset ? focus : { day: Math.max(0, todayIndex), cell: 0 };
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
  // What the region says when there is nothing to undo: a task added, moved or brought back,
  // or a tag created along the way. The newest notice replaces the last, whichever kind.
  const [said, setSaid] = useState<{ id: number; text: string } | null>(null);
  const notices = useRef(0);

  function say(text: string): void {
    notices.current += 1;
    setTrash(null);
    setSaid({ id: notices.current, text });
  }

  useEffect(() => {
    const pending = pendingFocus.current;
    if (pending === null || status !== "ready" || loaded <= pending.after) return;
    pendingFocus.current = null;

    const { target } = pending;
    const element =
      "task" in target
        ? document.getElementById(`task-${target.task}`)
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
      const restored = await week.create(deleted.snapshot);
      // Only while nothing newer has been said: a delete or a move since would be the news.
      if (notices.current === deleted.id) {
        say(`Restored “${deleted.title}” on ${dayLabel(deleted.day)}.`);
      }
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
      ? said === null
        ? null
        : { id: `${String(said.id)}:said`, text: said.text }
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
        setSaid(null);
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
      } else if (event.key === "n" || event.key === "N") {
        // The focused day, and never one that has gone: it offers no "+ new task" either.
        const day = week.days[current.day];
        if (day === undefined || current.day < todayIndex) return;
        event.preventDefault();
        setOpenDay(day.day);
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
  }, [week, current.day, todayIndex]);

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

  // Focus rather than scroll: moving the keyboard there is what makes the way back usable by
  // somebody who is not holding a mouse. `scrollIntoView` would move the eye and leave the
  // focus in the band it came from. The row is a cell of the grid, so it takes focus itself.
  function focusTask(taskId: string): void {
    document.getElementById(`task-${taskId}`)?.focus();
  }

  /**
   * The arrows, Home and End, between the cells of the grid (ADR-0053).
   *
   * Only from a cell itself: inside an opened row the keys belong to its controls. Days are
   * rows drawn as columns, so left and right change day and keep the place in it, as far down
   * as the other day goes.
   */
  function onGridKey(event: React.KeyboardEvent<HTMLDivElement>): void {
    const at = event.target instanceof HTMLElement ? event.target.dataset.cell : undefined;
    if (at === undefined) return;
    const [day = 0, cell = 0] = at.split(":").map(Number);
    const grid = event.currentTarget;
    const last = (of: number): number => grid.querySelectorAll(`[data-cell^="${String(of)}:"]`).length - 1;
    let next: [number, number];
    switch (event.key) {
      case "ArrowDown":
        next = [day, Math.min(cell + 1, last(day))];
        break;
      case "ArrowUp":
        next = [day, Math.max(0, cell - 1)];
        break;
      case "ArrowRight":
        next = [Math.min(6, day + 1), Math.min(cell, last(Math.min(6, day + 1)))];
        break;
      case "ArrowLeft":
        next = [Math.max(0, day - 1), Math.min(cell, last(Math.max(0, day - 1)))];
        break;
      case "Home":
        next = [day, 0];
        break;
      case "End":
        next = [day, last(day)];
        break;
      default:
        return;
    }
    event.preventDefault();
    grid.querySelector<HTMLElement>(`[data-cell="${String(next[0])}:${String(next[1])}"]`)?.focus();
  }

  // Focus may not stay on a row that no longer exists. It goes to the next row in the day, or
  // the one before it, so a run of deletes walks down a day; with none left, to the day's
  // `new task` button.
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
        {/* Not a stop itself: its cells hold the one tab stop and the keys arrive from them,
            as the grid pattern has it (ADR-0053). */}
        {/* eslint-disable-next-line jsx-a11y/interactive-supports-focus */}
        <div
          role="grid"
          aria-label={`Week of ${weekRange(week.monday, dates[6] as Date)}`}
          className={styles.grid}
          onKeyDown={onGridKey}
        >
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
              onSaveTask={async (taskId, changes, sentence) => {
                await week.update(taskId, changes);
                if (sentence !== undefined) say(sentence);
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
                  notices.current += 1;
                  setSaid(null);
                  setTrash({
                    id: notices.current,
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
              date={dayMonth(dates[index] as Date)}
              today={capacity.day === todayKey}
              // Local dates as YYYY-MM-DD compare as strings in calendar order.
              past={todayKey !== null && capacity.day < todayKey}
              timezone={week.me?.timezone ?? "UTC"}
              focusedCell={current.day === index ? current.cell : null}
              onFocusCell={(cell) => {
                setFocus({ offset: week.offset, day: index, cell });
              }}
              onOpenForm={setOpenDay}
              onToggle={week.toggle}
            />
          ))}
        </div>
        {openDay !== null && (
          <NewTaskDialog
            key={openDay}
            startDay={openDay}
            days={week.days}
            timezone={timezone}
            onCreate={async (task, sentence) => {
              const created = await week.create(task);
              setOpenDay(null);
              say(sentence);
              // On the row it made, which is where somebody looks next, rather than back on
              // the button that opened the dialog.
              focusOnceReloaded({ task: created.id });
            }}
            onClose={() => {
              setOpenDay(null);
            }}
          />
        )}
      </main>
      {region}
    </>
  );
}
