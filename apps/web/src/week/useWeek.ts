import { useCallback, useEffect, useState } from "react";

import { ApiError, api } from "../api/client";
import type { DayCapacity, Me, NewTask, Page, Task, TaskChanges } from "../api/types";
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
 */

export type WeekStatus = "loading" | "ready" | "unreachable";

interface Snapshot {
  window: string;
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
  /** What the previous day is still holding, keyed by the day receiving it. */
  carried: Map<string, Carried[]>;
  monday: Date;
  offset: number;
  goTo: (offset: number) => void;
  reload: () => void;
  create: (task: NewTask) => Promise<void>;
  /** Send a partial change. Rejects with the server's `ApiError` so the panel can show it. */
  update: (taskId: string, changes: TaskChanges) => Promise<void>;
  toggle: (task: Task) => Promise<void>;
  /** The server's word on the last create. A conflict is a 409 and the message is the API's. */
  createError: string | null;
  clearCreateError: () => void;
  creating: boolean;
}

const PAGE = 100;

export function useWeek(): Week {
  const [offset, setOffset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [failedWindow, setFailedWindow] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

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
  const currentWindow = `${firstDay}:${lastDay}:${String(attempt)}`;

  const status: WeekStatus =
    failedWindow === currentWindow
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
      const [days, page] = await Promise.all([
        api.get<DayCapacity[]>(`/capacity?first_day=${firstDay}&last_day=${lastDay}`),
        api.get<Page<Task>>(`/tasks?first_day=${eve}&last_day=${lastDay}&limit=${String(PAGE)}`),
      ]);

      if (cancelled) return;
      setSnapshot({ window: currentWindow, me, days, tasks: page.items });
    }

    void load().catch(() => {
      // A session that ended is not handled here: the HTTP client already turns that into a
      // signed-out interface. This is only the week failing to arrive.
      if (!cancelled) setFailedWindow(currentWindow);
    });

    return () => {
      cancelled = true;
    };
  }, [eve, firstDay, lastDay, currentWindow]);

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

  const refetch = useCallback(() => {
    setFailedWindow(null);
    setAttempt((count) => count + 1);
  }, []);

  const create = useCallback(
    async (task: NewTask) => {
      setCreating(true);
      setCreateError(null);
      try {
        await api.post<Task>("/tasks", task);
        refetch();
      } catch (problem) {
        // The overlap rule lives in the database as an exclusion constraint, so its 409 is
        // the only authority. This client can only see the week on screen, and a task in an
        // adjacent week would pass a local check and then be refused anyway.
        setCreateError(problem instanceof ApiError ? problem.detail : "Couldn't reach the server.");
        throw problem;
      } finally {
        setCreating(false);
      }
    },
    [refetch],
  );

  const update = useCallback(
    async (taskId: string, changes: TaskChanges) => {
      // The error is not held here, unlike `create`'s. A create belongs to a day and there is
      // one form open at a time; an update belongs to a row, and the panel showing the
      // message is the one that has to keep what was typed while the message is on screen.
      await api.patch<Task>(`/tasks/${taskId}`, changes);
      refetch();
    },
    [refetch],
  );

  const toggle = useCallback(
    async (task: Task) => {
      await api.patch<Task>(`/tasks/${task.id}`, { completed: task.completed_at === null });
      refetch();
    },
    [refetch],
  );

  const clearCreateError = useCallback(() => {
    setCreateError(null);
  }, []);

  return {
    status,
    me: ready?.me ?? null,
    days: ready?.days ?? [],
    byDay,
    carried,
    monday,
    offset,
    goTo: setOffset,
    reload: refetch,
    create,
    update,
    toggle,
    createError,
    clearCreateError,
    creating,
  };
}
