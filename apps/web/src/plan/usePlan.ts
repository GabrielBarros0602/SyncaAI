import { useCallback, useEffect, useRef, useState } from "react";

import { api, request } from "../api/client";
import type { DayCapacity, Job, Page, Plan, PlanCommit } from "../api/types";

/**
 * The request and the plan the screens follow, found on the server.
 *
 * Nothing about either is kept in the browser, which ADR-0021's lint forbids: a reload, a
 * second tab or another device asks the server and finds the same request being made, the same
 * plan waiting, or the same failure (ADR-0050, ADR-0058).
 */

export type PlanLoad = "loading" | "ready" | "unreachable";

export interface PlanState {
  status: PlanLoad;
  /**
   * The plan waiting for review, or what it became while it was being reviewed: read again
   * after a refusal, it may have expired. Null when there is none.
   */
  plan: Plan | null;
  /** The request being made, or the latest one if it failed and nothing came after it. */
  job: Job | null;
  /** The figures for each of the plan's days, by local date: what "What it adds" reads. */
  capacity: ReadonlyMap<string, DayCapacity>;
  /** Read the plan again, or look for what there is when there is none. Rejects when unreachable. */
  reload: () => Promise<void>;
  /** Ask for a plan. Rejects with the server's `ApiError` when it is refused. */
  ask: (text: string, horizonDays: number) => Promise<void>;
  /** Turn the plan into tasks, all or nothing. Rejects with the server's `ApiError`. */
  approve: () => Promise<PlanCommit>;
  /** Set the plan aside. Rejects with the server's `ApiError`. */
  discard: () => Promise<void>;
}

// How often a request being made is read: 2s, half as long again each time, never past 30s,
// and not at all while the tab is hidden (decided on 2026-11-22).
const FIRST_POLL_MS = 2000;
const LAST_POLL_MS = 30_000;

function inProgress(job: Job | null): job is Job & { status: "queued" | "running" } {
  return job?.status === "queued" || job?.status === "running";
}

/**
 * The newest request and the newest plan, and which of them the screens follow.
 *
 * One at a time (ADR-0033): a request being made and a plan waiting never both exist. A
 * failed request stays the news until something newer happens, a plan written or asked for
 * since, which the database's clock on both says (ADR-0058).
 */
async function discover(): Promise<{ plan: Plan | null; job: Job | null }> {
  const [jobs, plans] = await Promise.all([
    api.get<Page<Job>>("/ai/plans?limit=1"),
    api.get<Page<Plan>>("/plans?limit=1"),
  ]);
  const job = jobs.items[0] ?? null;
  const plan = plans.items[0] ?? null;
  if (inProgress(job)) return { plan: null, job };
  if (plan?.status === "pending") return { plan, job: null };
  const failedSince =
    job?.status === "failed" && (plan === null || Date.parse(job.created_at) > Date.parse(plan.created_at));
  return { plan: null, job: failedSince ? job : null };
}

/**
 * `revision` is the week's: each time the week arrives again after a write, the days the plan
 * lands on are read again with it, so what the plan adds is measured against what is booked
 * now and agrees with the week beside it. `onReady` hears of a plan made while the screen
 * was open, once.
 */
export function usePlan(revision: number, onReady: (plan: Plan) => void): PlanState {
  const [status, setStatus] = useState<PlanLoad>("loading");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [capacity, setCapacity] = useState<ReadonlyMap<string, DayCapacity>>(new Map());
  // One key per plan, kept across attempts: a commit retried after a lost answer must find the
  // first one rather than make a second set of tasks (ADR-0030). A refused commit wrote
  // nothing, so the same key serves the next attempt too.
  const keys = useRef(new Map<string, string>());
  const ready = useRef(onReady);
  useEffect(() => {
    ready.current = onReady;
  });

  useEffect(() => {
    let cancelled = false;
    discover()
      .then((found) => {
        if (cancelled) return;
        setPlan(found.plan);
        setJob(found.job);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("unreachable");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Followed until it is done or failed, the screen closes or the session leaves, which is
  // when this unmounts.
  const following = inProgress(job) ? job.job_id : null;

  useEffect(() => {
    if (following === null) return;
    const id = following;
    let delay = FIRST_POLL_MS;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let reading = false;
    let stopped = false;
    // Read through a call: a check of the variable itself is taken as settled across an await.
    const gone = (): boolean => stopped;

    function later(): void {
      if (stopped || document.hidden) return;
      timer = setTimeout(() => {
        timer = null;
        void read();
      }, delay);
      delay = Math.min(delay * 1.5, LAST_POLL_MS);
    }

    async function read(): Promise<void> {
      reading = true;
      try {
        const now = await api.get<Job>(`/ai/plans/${id}`);
        if (gone()) return;
        if (now.status === "done") {
          const made = now.plan_id === null ? null : await api.get<Plan>(`/plans/${now.plan_id}`);
          if (gone()) return;
          setPlan(made);
          setJob(null);
          if (made !== null) ready.current(made);
          return;
        }
        setJob(now);
        if (now.status === "failed") return;
      } catch {
        // Unreachable for now: the next read is no sooner than it would have been.
      } finally {
        reading = false;
      }
      later();
    }

    // Hidden, nothing is read; shown again, the request is read at once rather than at the end
    // of a wait that grew while nobody was looking.
    function onVisibility(): void {
      if (document.hidden) {
        if (timer !== null) clearTimeout(timer);
        timer = null;
      } else if (timer === null && !reading) {
        void read();
      }
    }

    later();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [following]);

  const pending = plan?.status === "pending" ? plan : null;
  const span = pending === null ? null : `${pending.first_day}:${pending.last_day}`;

  useEffect(() => {
    if (span === null) return;
    let cancelled = false;
    const [first, last] = span.split(":");
    api
      .get<DayCapacity[]>(`/capacity?first_day=${first ?? ""}&last_day=${last ?? ""}`)
      .then((days) => {
        if (!cancelled) setCapacity(new Map(days.map((day) => [day.day, day])));
      })
      // Without figures the review leaves "What it adds" out rather than drawing it from
      // nothing; the plan itself is still there to review.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [span, revision]);

  const planId = plan?.id ?? null;

  const reload = useCallback(async () => {
    try {
      if (planId === null) {
        const found = await discover();
        setPlan(found.plan);
        setJob(found.job);
      } else {
        setPlan(await api.get<Plan>(`/plans/${planId}`));
      }
      setStatus("ready");
    } catch (problem) {
      setStatus("unreachable");
      throw problem;
    }
  }, [planId]);

  const ask = useCallback(async (text: string, horizonDays: number) => {
    const queued = await api.post<Job>("/ai/plans", { request: text, horizon_days: horizonDays });
    setPlan(null);
    setJob(queued);
  }, []);

  const approve = useCallback(async () => {
    if (planId === null) throw new Error("There is no plan to approve.");
    const key = keys.current.get(planId) ?? crypto.randomUUID();
    keys.current.set(planId, key);
    const made = await request<PlanCommit>(`/plans/${planId}/commit`, {
      method: "POST",
      headers: { "Idempotency-Key": key },
    });
    setPlan(null);
    return made;
  }, [planId]);

  const discard = useCallback(async () => {
    if (planId === null) throw new Error("There is no plan to discard.");
    await request<undefined>(`/plans/${planId}/discard`, { method: "POST" });
    setPlan(null);
  }, [planId]);

  return { status, plan, job, capacity, reload, ask, approve, discard };
}
