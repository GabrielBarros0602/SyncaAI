import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, api } from "../api/client";
import { everyPage } from "../api/pages";
import type { DayCapacity, Me, NewTask, Task, TaskChanges } from "../api/types";
import { daysFrom, mondayOf, toLocalDate, zonedDay } from "../lib/time";
import { type Carried, carriedInto } from "./carried";

/**
 * The week's data.
 *
 * Two calls, in parallel, for the same seven local dates: `/capacity` for the aggregate and
 * `/tasks` for the content. They agree on which instants "this week" means because both take
 * the same local-date vocabulary and both read it in the zone `/me` reports — which is the
 * server's, not this browser's.
 *
 * The status is **derived**, not sequenced. A snapshot is stamped with the window it belongs
 * to, and anything whose stamp is not the current window is by definition still loading.
 * Setting a "loading" flag on the way in would say the same thing in two places, and the two
 * would eventually disagree — a stale week rendering under a fresh header.
 *
 * A reload of the same window is not loading. A write reloads the week, and the week it
 * replaces stays on screen until the new one arrives (item 29 of the round): the row that was
 * written says so, and the figures change when the server has answered, not before. Putting
 * the skeleton up in between took away the control somebody had just pressed, and with it
 * their focus.
 */

export type WeekStatus = "loading" | "ready" | "unreachable";

/** One change to a task's checklist, each its own route (ADR-0028). */
export type ChecklistChange =
  | { kind: "add"; label: string }
  | { kind: "rename"; itemId: string; label: string }
  | { kind: "tick"; itemId: string; completed: boolean }
  | { kind: "remove"; itemId: string }
  | { kind: "order"; itemIds: string[] };

interface Snapshot {
  window: string;
  /** The reload it answers. A write is on screen once a snapshot this recent has arrived. */
  attempt: number;
  /** How many snapshots had arrived before this one. Lets a caller wait for the next. */
  sequence: number;
  me: Me;
  days: DayCapacity[];
  tasks: Task[];
}

export interface Week {
  status: WeekStatus;
  me: Me | null;
  days: DayCapacity[];
  /** Tasks keyed by the local date they start on — the day that owns the row. */
  byDay: Map<string, Task[]>;
  /** Every task fetched, the evening before the week included: what occupancy is read from. */
  tasks: Task[];
  /**
   * How many times the week has arrived. Every write reloads it, so anything that has to
   * happen *after* a write — putting focus back on a row that moved — waits for this to move
   * rather than acting on the week the write was made on.
   */
  loaded: number;
  /** The tasks with a write the screen does not show yet: sent, or answered and not reloaded. */
  saving: ReadonlySet<string>;
  /** What the previous day is still holding, keyed by the day receiving it. */
  carried: Map<string, Carried[]>;
  monday: Date;
  offset: number;
  goTo: (offset: number) => void;
  reload: () => void;
  /**
   * Create a task, or recreate a deleted one from its snapshot. Resolves with the task the
   * server made, new id and all; rejects with the server's `ApiError`, which its caller shows.
   */
  create: (task: NewTask) => Promise<Task>;
  /** Send a partial change. Rejects with the server's `ApiError` so the panel can show it. */
  update: (taskId: string, changes: TaskChanges) => Promise<void>;
  toggle: (task: Task) => Promise<void>;
  /** Delete a task. A 404 counts as done; anything else rejects with the server's `ApiError`. */
  remove: (taskId: string) => Promise<void>;
  /** Change a task's checklist. Rejects with the server's `ApiError` so the panel can show it. */
  checklist: (taskId: string, change: ChecklistChange) => Promise<void>;
}

export function useWeek(): Week {
  const [offset, setOffset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  // The same count, readable the moment a reload is asked for: a write needs to know which
  // reload will show it before React has rendered the new one.
  const attempts = useRef(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [failed, setFailed] = useState<{ window: string; attempt: number } | null>(null);
  // Each task with a write in progress, and the reload that will show it: null until the
  // write itself has answered.
  const [writes, setWrites] = useState<ReadonlyMap<string, number | null>>(new Map());

  const monday = mondayOf(new Date(), offset);
  const week = daysFrom(monday);
  const firstDay = toLocalDate(week[0] as Date);
  const lastDay = toLocalDate(week[6] as Date);

  // Tasks are fetched from the day *before* the week. Monday can be holding minutes from a
  // Sunday task that ran past midnight, and the aggregate already counts them — without this
  // day, Monday would show a booked figure with nothing on screen accounting for it. One day
  // is enough and not a guess: the CHECK constraint caps a task at 1440 minutes, so nothing
  // starting earlier can still be running on Monday.
  const eve = toLocalDate(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 1));
  const currentWindow = `${firstDay}:${lastDay}`;

  const status: WeekStatus =
    failed?.window === currentWindow && failed.attempt === attempt
      ? "unreachable"
      : snapshot?.window === currentWindow
        ? "ready"
        : "loading";

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      // `/me` first and alone: everything after it needs the zone, and asking for a window
      // before knowing which zone reads it would be asking about the wrong days.
      const me = await api.get<Me>("/me");
      // Every page of the window, not the first: the capacity counts every task, and a week
      // that stopped at one page would show fewer than its own figures say it holds.
      const [days, tasks] = await Promise.all([
        api.get<DayCapacity[]>(`/capacity?first_day=${firstDay}&last_day=${lastDay}`),
        everyPage<Task>(`/tasks?first_day=${eve}&last_day=${lastDay}`),
      ]);

      if (cancelled) return;
      setSnapshot((previous) => ({
        window: currentWindow,
        attempt,
        sequence: (previous?.sequence ?? 0) + 1,
        me,
        days,
        tasks,
      }));
      // What this week now shows is no longer saving.
      setWrites((pending) => {
        const left = new Map(
          [...pending].filter(([, shownBy]) => shownBy === null || shownBy > attempt),
        );
        return left.size === pending.size ? pending : left;
      });
    }

    void load().catch(() => {
      // A session that ended is not handled here: the HTTP client already turns that into a
      // signed-out interface. This is only the week failing to arrive.
      if (!cancelled) setFailed({ window: currentWindow, attempt });
    });

    return () => {
      cancelled = true;
    };
  }, [eve, firstDay, lastDay, currentWindow, attempt]);

  const ready = status === "ready" ? snapshot : null;
  const byDay = new Map<string, Task[]>();
  // Keyed on where each task *starts*, which is what the server now counts too. The eve's own
  // tasks land under a date no column renders; only their spill crosses into the week.
  if (ready !== null) {
    for (const task of ready.tasks) {
      const day = zonedDay(task.start_at, ready.me.timezone);
      byDay.set(day, [...(byDay.get(day) ?? []), task]);
    }
  }
  const carried = ready === null ? new Map<string, Carried[]>() : carriedInto(ready.tasks, ready.me.timezone);

  /** Reload the week in place. Returns the attempt whose arrival will show what changed. */
  const refetch = useCallback((): number => {
    attempts.current += 1;
    setFailed(null);
    setAttempt(attempts.current);
    return attempts.current;
  }, []);

  /**
   * Send a write about one task, and mark the task as saving until the week shows it.
   *
   * A refusal clears the mark at once: nothing changed, so there is nothing to wait for, and
   * the refusal itself is the panel's to show.
   */
  const tracked = useCallback(
    async <T>(taskId: string, write: () => Promise<T>): Promise<T> => {
      setWrites((pending) => new Map(pending).set(taskId, null));
      try {
        const result = await write();
        const shownBy = refetch();
        setWrites((pending) => new Map(pending).set(taskId, shownBy));
        return result;
      } catch (problem) {
        setWrites((pending) => {
          const left = new Map(pending);
          left.delete(taskId);
          return left;
        });
        throw problem;
      }
    },
    [refetch],
  );

  const create = useCallback(
    async (task: NewTask) => {
      // The overlap rule lives in the database as an exclusion constraint, so its 409 is the
      // only authority, and the dialog or the undo that asked shows it.
      const created = await api.post<Task>("/tasks", task);
      refetch();
      return created;
    },
    [refetch],
  );

  const update = useCallback(
    async (taskId: string, changes: TaskChanges) => {
      // The error is not held here: the panel showing the message is the one that has to
      // keep what was typed while the message is on screen.
      await tracked(taskId, () => api.patch<Task>(`/tasks/${taskId}`, changes));
    },
    [tracked],
  );

  const toggle = useCallback(
    async (task: Task) => {
      await tracked(task.id, () =>
        api.patch<Task>(`/tasks/${task.id}`, { completed: task.completed_at === null }),
      );
    },
    [tracked],
  );

  const remove = useCallback(
    async (taskId: string) => {
      await tracked(taskId, async () => {
        try {
          await api.delete<undefined>(`/tasks/${taskId}`);
        } catch (problem) {
          // A 404 is "not there for you" (ADR-0016): already deleted, from another tab or a
          // moment ago, or never yours — indistinguishable on purpose. Either way the row is
          // gone, so it is removed like any other delete rather than reported as a failure.
          if (!(problem instanceof ApiError && problem.status === 404)) throw problem;
        }
      });
    },
    [tracked],
  );

  const checklist = useCallback(
    async (taskId: string, change: ChecklistChange) => {
      const items = `/tasks/${taskId}/items`;
      await tracked(taskId, () => {
        switch (change.kind) {
          case "add":
            return api.post(items, { label: change.label });
          case "rename":
            return api.patch(`${items}/${change.itemId}`, { label: change.label });
          case "tick":
            return api.patch(`${items}/${change.itemId}`, { completed: change.completed });
          case "remove":
            // Already gone, from another tab: removed all the same, as a deleted task is.
            return api.delete(`${items}/${change.itemId}`).catch((problem: unknown) => {
              if (!(problem instanceof ApiError && problem.status === 404)) throw problem;
            });
          case "order":
            // The whole list, so a list that changed since it was read is refused with a 409
            // rather than merged into an order nobody chose (ADR-0028).
            return api.put(`${items}/order`, { item_ids: change.itemIds });
        }
      });
    },
    [tracked],
  );

  return {
    status,
    // From the last week that arrived, not only the current one: who is signed in does not
    // change with the week, and the header keeps the Menu while the next week loads.
    me: snapshot?.me ?? null,
    days: ready?.days ?? [],
    byDay,
    tasks: ready?.tasks ?? [],
    loaded: snapshot?.sequence ?? 0,
    saving: new Set(
      [...writes]
        .filter(([, shownBy]) => shownBy === null || (ready?.attempt ?? -1) < shownBy)
        .map(([taskId]) => taskId),
    ),
    carried,
    monday,
    offset,
    goTo: setOffset,
    reload: refetch,
    create,
    update,
    toggle,
    remove,
    checklist,
  };
}
