import { useCallback, useEffect, useState } from "react";

import { ApiError, api } from "../api/client";
import type { DayCapacity, Me, NewTask, Page, Task } from "../api/types";
import { daysFrom, mondayOf, toLocalDate, zonedDay } from "../lib/time";

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
  /** Tasks keyed by the local date they start on. */
  byDay: Map<string, Task[]>;
  monday: Date;
  offset: number;
  goTo: (offset: number) => void;
  reload: () => void;
  create: (task: NewTask) => Promise<void>;
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
        api.get<Page<Task>>(
          `/tasks?first_day=${firstDay}&last_day=${lastDay}&limit=${String(PAGE)}`,
        ),
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
  }, [firstDay, lastDay, currentWindow]);

  const ready = status === "ready" ? snapshot : null;
  const byDay = new Map<string, Task[]>();
  if (ready !== null) {
    for (const task of ready.tasks) {
      const day = zonedDay(task.start_at, ready.me.timezone);
      byDay.set(day, [...(byDay.get(day) ?? []), task]);
    }
  }

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
    monday,
    offset,
    goTo: setOffset,
    reload: refetch,
    create,
    toggle,
    createError,
    clearCreateError,
    creating,
  };
}
