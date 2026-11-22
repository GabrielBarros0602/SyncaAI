import { useEffect, useRef, useState } from "react";

import { ApiError } from "../api/client";
import { useSession } from "../auth/useSession";
import { cx } from "../lib/cx";
import {
  dayMonth,
  daysFrom,
  toLocalDate,
  weekRange,
  weekdayName,
  weekdayOf,
  zonedDay,
} from "../lib/time";
import { useLayout } from "../lib/useLayout";
import type { NewTask, Task, TaskChanges } from "../api/types";
import { type Shortcut, ShortcutLegend } from "../ui/ShortcutLegend";
import { type Notice, StatusRegion } from "../ui/StatusRegion";
import { DayBar } from "./DayBar";
import { DayColumn } from "./DayColumn";
import { DayHeader } from "./DayHeader";
import { DayList } from "./DayList";
import { NewTaskDialog } from "./NewTaskDialog";
import { WeekGlance } from "./WeekGlance";
import { WeekHeader } from "./WeekHeader";
import { WeekSkeleton } from "./WeekSkeleton";
import { WeekUnreachable } from "./WeekUnreachable";
import type { Panel } from "./TaskRow";
import type { Trash } from "./Trash";
import { useWeek } from "./useWeek";
import styles from "./WeekScreen.module.css";

/**
 * Where focus goes once the week has come back.
 *
 * A task's title, a day's `new task` button when the day has no row left to land on, or a cell
 * of the grid by its place, which is where "go to date" lands. By id, day and place rather than
 * by element: the element that had focus does not survive the reload.
 */
type FocusTarget = { task: string } | { newTaskOn: string } | { cell: string };

/** The keys the week answers to: the round's fifteen, in its order and words. */
const SHORTCUTS: Shortcut[] = [
  { keys: ["←", "→", "↑", "↓"], label: "move between days and rows" },
  { keys: ["Home", "End"], label: "first or last in a day" },
  { keys: ["Enter"], label: "open or close a row" },
  { keys: ["Space"], label: "mark done" },
  { keys: ["E"], label: "edit" },
  { keys: ["M"], label: "move" },
  { keys: ["O"], label: "note" },
  { keys: ["C"], label: "checklist" },
  { keys: ["⌫"], label: "delete" },
  { keys: ["N"], label: "new task on the focused day" },
  { keys: ["Alt", "↑", "↓"], label: "reorder a checklist item" },
  { keys: ["[", "]"], label: "previous or next week" },
  { keys: ["T"], label: "back to this week" },
  { keys: ["Ctrl", "Z"], label: "undo a delete" },
  { keys: ["Esc"], label: "close" },
];

/**
 * The keys below 1100px, where the day is a list (ADR-0056): the arrows and Home and End walk
 * the week's grid, and there is none.
 */
const LIST_SHORTCUTS = SHORTCUTS.filter(
  (shortcut) => !shortcut.keys.some((key) => key === "←" || key === "Home"),
);

/** `Thu 22`, for a local date: what the status region calls the day a task was on. */
function dayLabel(localDate: string): string {
  return `${weekdayOf(localDate)} ${String(Number(localDate.slice(8, 10)))}`;
}

export function WeekScreen(): React.ReactNode {
  const { signOut } = useSession();
  const week = useWeek();
  // Seven columns from 1100px, one day beside or under the week at a glance below (ADR-0052).
  const layout = useLayout();
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
  const dates = daysFrom(week.monday);
  const dayKeys = dates.map(toLocalDate);
  // From the dates rather than from the days the server sent, so the one day on screen below
  // 1100px is already today's while its week is on the way.
  const todayIndex = todayKey === null ? -1 : dayKeys.indexOf(todayKey);
  // Until the zone is known the browser's today says which day to draw, as the skeleton before
  // it did, and never which day is marked.
  const startDay = week.me === null ? dayKeys.indexOf(toLocalDate(new Date())) : todayIndex;
  // The day holding the stop is also the one day on screen, below 1100px.
  const current =
    focus !== null && focus.offset === week.offset ? focus : { day: Math.max(0, startDay), cell: 0 };
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
        : "newTaskOn" in target
          ? document.querySelector<HTMLElement>(`[data-new-task="${target.newTaskOn}"]`)
          : document.querySelector<HTMLElement>(`[data-cell="${target.cell}"]`);
    // With one day on screen the row may have gone to a day that is not. Focus goes to the
    // header of the day that is, rather than to the page.
    const header = layout === "week" ? null : document.querySelector<HTMLElement>('[data-cell$=":0"]');
    (element ?? header)?.focus();
    // The day too: another day of the same week comes on screen without the week reloading.
  }, [loaded, status, current.day, layout]);

  function focusOnceReloaded(target: FocusTarget): void {
    pendingFocus.current = { target, after: loaded };
  }

  /** Put another day of the week on screen, where one day is, and focus `then` once it is. */
  function showDay(day: number, then?: FocusTarget): void {
    setOpenTask(null);
    setFocus({ offset: week.offset, day, cell: 0 });
    // This week is already here, so the day's arrival is the one to wait for.
    if (then !== undefined) pendingFocus.current = { target: then, after: loaded - 1 };
  }

  /** The day before or after the one on screen, into the next week when the week ends. */
  function stepDay(by: -1 | 1): void {
    const day = current.day + by;
    if (day >= 0 && day <= 6) {
      showDay(day);
      return;
    }
    const offset = week.offset + by;
    setOpenTask(null);
    setFocus({ offset, day: by === 1 ? 0 : 6, cell: 0 });
    week.goTo(offset);
  }

  /**
   * Another week. With one day on screen it opens on the same weekday, as day-phone.dc.html
   * has it; the seven columns start from today's header, or Monday's.
   */
  function goToWeek(offset: number): void {
    if (layout !== "week") {
      setOpenTask(null);
      setFocus({ offset, day: current.day, cell: 0 });
    }
    week.goTo(offset);
  }

  /** This week, and with one day on screen, today: what T and "back to this week" mean. */
  function goToToday(): void {
    if (layout !== "week") {
      setOpenTask(null);
      setFocus(null);
    }
    week.goTo(0);
  }

  /**
   * A new task from the bar under the one day on screen.
   *
   * On that day, unless it has gone: a day that has gone takes nothing new, so the form opens
   * on today, in this week, as the drawing has it.
   */
  function newTaskFromBar(): void {
    if (todayKey === null) return;
    const shown = dayKeys[current.day];
    if (shown !== undefined && shown >= todayKey) {
      setOpenDay(shown);
      return;
    }
    if (week.offset !== 0) goToToday();
    setOpenDay(todayKey);
  }

  /**
   * The week holding a local date, with focus on that day's header.
   *
   * Counted from the Monday on screen, which is already the person's and not the browser's, so
   * the offset means what `[` and `]` mean. Rounded, because a week across a daylight saving
   * change is an hour short or long.
   */
  function goToDate(localDate: string): void {
    const [year = 1970, month = 1, date = 1] = localDate.split("-").map(Number);
    const days = Math.round(
      (new Date(year, month - 1, date).getTime() - week.monday.getTime()) / 86_400_000,
    );
    const weeks = Math.floor(days / 7);
    const offset = week.offset + weeks;
    const day = days - weeks * 7;
    const cell = `${String(day)}:0`;
    setOpenTask(null);
    setFocus({ offset, day, cell: 0 });
    // The same week does not reload, so there is no arrival to wait for, unless the day itself
    // is not on screen yet.
    if (offset === week.offset) {
      const header = document.querySelector<HTMLElement>(`[data-cell="${cell}"]`);
      if (header !== null) header.focus();
      else pendingFocus.current = { target: { cell }, after: loaded - 1 };
      return;
    }
    focusOnceReloaded({ cell });
    week.goTo(offset);
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
      docked={layout !== "week"}
      notice={notice}
      onExpire={() => {
        setTrash(null);
        setSaid(null);
      }}
      onDismiss={
        layout === "week"
          ? undefined
          : () => {
              // The ✕ goes with the notice. Focus that was on it lands on the day rather than
              // the page; without scrolling, since the day's head may be far above.
              const held = (document.activeElement?.closest('[role="status"]') ?? null) !== null;
              setTrash(null);
              setSaid(null);
              if (held) {
                document
                  .querySelector<HTMLElement>('[data-cell$=":0"]')
                  ?.focus({ preventScroll: true });
              }
            }
      }
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
      // Nor while a dialog is in front: its keys are its own. Esc on a sheet's select would
      // otherwise shut the row the sheet was opened from, and T move the week behind it.
      if (target instanceof Element && target.closest("dialog") !== null) return;

      if (event.key === "Escape") {
        setOpenDay(null);
        setOpenTask(null);
      } else if (event.key === "n" || event.key === "N") {
        if (layout !== "week") {
          event.preventDefault();
          newTaskFromBar();
          return;
        }
        // The focused day, and never one that has gone: it offers no "+ new task" either.
        const day = week.days[current.day];
        if (day === undefined || current.day < todayIndex) return;
        event.preventDefault();
        setOpenDay(day.day);
      } else if (event.key === "t" || event.key === "T") {
        // Unconditional, including when it is already zero. A key that silently does nothing
        // on the week you are already on is indistinguishable from one that is broken.
        event.preventDefault();
        goToToday();
      } else if (event.key === "[") {
        goToWeek(week.offset - 1);
      } else if (event.key === "]") {
        goToWeek(week.offset + 1);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
    // No list of dependencies: the one it had began with `week`, a new object on every render,
    // so it never held the listener back, and what the keys call is declared in this render.
  });

  // The header and the legend sit at the same place in every state, so between one week and
  // the next they stay mounted: focus stays on the › that was pressed, and a folded legend
  // stays folded.
  const range = weekRange(week.monday, dates[6] as Date);
  const legend = <ShortcutLegend shortcuts={layout === "week" ? SHORTCUTS : LIST_SHORTCUTS} />;
  const top = (
    <>
      <WeekHeader
        range={range}
        offset={week.offset}
        me={week.me}
        today={todayKey ?? toLocalDate(new Date())}
        onGoTo={goToWeek}
        onBack={goToToday}
        onGoToDate={goToDate}
        onSignOut={() => {
          void signOut();
        }}
      />
      {legend}
    </>
  );

  /** `Wed 21`: the day `by` days from the one on screen, which may be in another week. */
  function neighbour(by: -1 | 1): string {
    const date = new Date(week.monday);
    date.setDate(date.getDate() + current.day + by);
    return `${weekdayName(((current.day + by + 7) % 7) + 1)} ${String(date.getDate())}`;
  }

  /**
   * The page around what the week holds, in whichever state it is in.
   *
   * From 1100px the week is all there is. Below, one day stands beside or under the week at a
   * glance, and the bar between days stays at the bottom with the status region stacked above
   * it rather than over it, so New task and both days stay in reach while a notice shows.
   */
  function frame(content: React.ReactNode): React.ReactNode {
    if (layout === "week") {
      return (
        <>
          <main className={styles.page}>
            {top}
            {content}
          </main>
          {region}
        </>
      );
    }
    const glance = (
      <WeekGlance
        layout={layout}
        dates={dates}
        days={week.days}
        state={week.status}
        selected={current.day}
        today={todayIndex}
        onSelect={showDay}
      />
    );
    // Edge to edge, as the drawing is: the header, the column and the bar draw their own
    // edges, so the shell's padding is taken back. The legend, for a keyboard, sits above the
    // day rather than between the header and the week it describes.
    return (
      <div className={styles.edge}>
        <main className={styles.dayPage}>
          <DayHeader
            layout={layout}
            range={range}
            offset={week.offset}
            me={week.me}
            days={dayKeys}
            shown={dayKeys[current.day] ?? dayKeys[0] ?? ""}
            today={todayKey ?? toLocalDate(new Date())}
            onToday={week.offset === 0 && current.day === todayIndex}
            onGoTo={goToWeek}
            onBack={goToToday}
            onGoToDate={goToDate}
            onSignOut={() => {
              void signOut();
            }}
          >
            {layout === "day" && glance}
          </DayHeader>
          <div className={cx(styles.body, layout === "beside" && styles.beside)}>
            {layout === "beside" && glance}
            <div className={styles.pane}>
              {legend}
              {content}
            </div>
          </div>
        </main>
        <div className={styles.dock}>
          {region}
          <DayBar
            previous={neighbour(-1)}
            next={neighbour(1)}
            onPrevious={() => {
              stepDay(-1);
            }}
            onNext={() => {
              stepDay(1);
            }}
            onNew={newTaskFromBar}
          />
        </div>
      </div>
    );
  }

  const only = layout === "week" ? undefined : current.day;

  if (week.status === "loading") {
    return frame(<WeekSkeleton monday={week.monday} day={only} />);
  }
  if (week.status === "unreachable" || week.me === null) {
    return frame(<WeekUnreachable monday={week.monday} day={only} onRetry={week.reload} />);
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

  async function saveTask(taskId: string, changes: TaskChanges, sentence?: string): Promise<void> {
    await week.update(taskId, changes);
    if (sentence !== undefined) say(sentence);
    // Back to the resting panel rather than shut. The row stays where the reader was, and the
    // change they just made is on it — on another day, after a move.
    setOpenTask({ id: taskId, panel: "open" });
    focusOnceReloaded({ task: taskId });
  }

  async function deleteTask(task: Task, snapshot: NewTask | null): Promise<void> {
    const target = focusAfterDeleting(task, timezone);
    // Sent now, not when the window closes: holding the DELETE would keep the slot taken from
    // somebody deleting precisely to free it (the division of item 2).
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
  }

  const newTask = openDay !== null && (
    <NewTaskDialog
      key={openDay}
      startDay={openDay}
      days={week.days}
      timezone={timezone}
      sheet={layout !== "week"}
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
  );

  if (layout !== "week") {
    const capacity = week.days[current.day];
    const index = current.day;
    return frame(
      <>
        {capacity !== undefined && (
          <DayList
            key={capacity.day}
            capacity={capacity}
            tasks={week.byDay.get(capacity.day) ?? []}
            week={week.days}
            allTasks={week.tasks}
            carried={week.carried.get(capacity.day) ?? []}
            // Null on Monday: what it inherits comes from the Sunday before the week, which is
            // fetched so the figures are right and never rendered.
            onGoToOwner={
              index === 0
                ? null
                : (taskId) => {
                    // The owner's day is not on screen: it comes on with the row open, as the
                    // drawing follows a band to its owner.
                    showDay(index - 1, { task: taskId });
                    setOpenTask({ id: taskId, panel: "open" });
                  }
            }
            openTask={openTask}
            saving={week.saving}
            onOpenTask={setOpenTask}
            onSaveTask={saveTask}
            onDeleteTask={deleteTask}
            index={index}
            date={dayMonth(dates[index] as Date)}
            today={capacity.day === todayKey}
            timezone={timezone}
            onToggle={week.toggle}
            onChecklist={week.checklist}
          />
        )}
        {newTask}
      </>,
    );
  }

  return frame(
    <>
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
            onSaveTask={saveTask}
            onDeleteTask={deleteTask}
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
            onChecklist={week.checklist}
          />
        ))}
      </div>
      {newTask}
    </>,
  );
}
