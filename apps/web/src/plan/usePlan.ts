import { useCallback, useEffect, useRef, useState } from "react";

import { api, request } from "../api/client";
import type {
  DayCapacity,
  Job,
  NewPlanItem,
  Page,
  Plan,
  PlanCommit,
  PlanItem,
  PlanItemChanges,
} from "../api/types";

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
  /** Rename, resize or move a step, then read the plan again. Rejects with the `ApiError`. */
  change: (stepId: string, changes: PlanItemChanges) => Promise<void>;
  /** Add a step where the plan would place it, then read the plan again. Answers the step. */
  add: (step: NewPlanItem) => Promise<PlanItem>;
  /**
   * Make a plan written by hand, with its first step: until then it is only on the screen
   * (decided on 2026-11-22). Answers the step. Rejects with the `ApiError` of whichever of the
   * two the server refused; a refused step leaves the plan made, for the next one to go to.
   */
  write: (request: string, horizonDays: number, step: NewPlanItem) => Promise<PlanItem>;
  /** Send the steps that did not fit to the days after the plan's first week. Answers the plan. */
  sendOn: () => Promise<Plan>;
  /**
   * Take a step out of the plan on screen at once, and out of the server later: when its notice
   * ends, before Approve and Discard, or when the screen goes. The API cannot put a deleted
   * step back, with its links, what it waits for and its time, so the undo is not sending it
   * (decided on 2026-11-22). Another removal sends the one before.
   */
  remove: (stepId: string) => void;
  /** Put back the step being removed, which the server never lost. */
  keep: () => void;
  /** Send the removal now. Resolves once the server has it, or at once with none. */
  settle: () => Promise<void>;
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
  // The step taken out of the screen and not yet out of the server, with its plan.
  const [removing, setRemoving] = useState<{ plan: string; step: string } | null>(null);
  const removingNow = useRef(removing);
  useEffect(() => {
    removingNow.current = removing;
  });
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

  /** Delete one step, and read the plan it was in again. */
  const send = useCallback(async (gone: { plan: string; step: string }) => {
    await api.delete<undefined>(`/plans/${gone.plan}/items/${gone.step}`);
    setPlan(await api.get<Plan>(`/plans/${gone.plan}`));
  }, []);

  const settle = useCallback(async () => {
    const gone = removingNow.current;
    if (gone === null) return;
    removingNow.current = null;
    setRemoving(null);
    await send(gone);
  }, [send]);

  const remove = useCallback(
    (stepId: string) => {
      if (planId === null) return;
      const before = removingNow.current;
      // Only one removal can be undone at a time: the one before is no longer on offer.
      if (before !== null) void send(before).catch(() => undefined);
      const next = { plan: planId, step: stepId };
      removingNow.current = next;
      setRemoving(next);
    },
    [planId, send],
  );

  const keep = useCallback(() => {
    removingNow.current = null;
    setRemoving(null);
  }, []);

  // The screen goes with a removal still on offer: it is sent, as its notice ending would.
  // Closing the tab first keeps the step, the safe side.
  useEffect(
    () => () => {
      const gone = removingNow.current;
      if (gone !== null) {
        void request<undefined>(`/plans/${gone.plan}/items/${gone.step}`, {
          method: "DELETE",
          keepalive: true,
        }).catch(() => undefined);
      }
    },
    [],
  );

  const change = useCallback(
    async (stepId: string, changes: PlanItemChanges) => {
      if (planId === null) throw new Error("There is no plan to change.");
      await api.patch<PlanItem>(`/plans/${planId}/items/${stepId}`, changes);
      // Read whole: a step given a time changes what the steps waiting for it say.
      setPlan(await api.get<Plan>(`/plans/${planId}`));
    },
    [planId],
  );

  const add = useCallback(
    async (step: NewPlanItem) => {
      if (planId === null) throw new Error("There is no plan to add to.");
      const added = await api.post<PlanItem>(`/plans/${planId}/items`, step);
      setPlan(await api.get<Plan>(`/plans/${planId}`));
      return added;
    },
    [planId],
  );

  const write = useCallback(async (text: string, horizonDays: number, step: NewPlanItem) => {
    const made = await api.post<Plan>("/plans", { request: text, horizon_days: horizonDays });
    // Followed from here, step or no step: a step refused now goes to this plan when sent again.
    setPlan(made);
    setJob(null);
    const added = await api.post<PlanItem>(`/plans/${made.id}/items`, step);
    setPlan(await api.get<Plan>(`/plans/${made.id}`));
    return added;
  }, []);

  const sendOn = useCallback(async () => {
    if (planId === null) throw new Error("There is no plan to send on.");
    const placed = await api.post<Plan>(`/plans/${planId}/next-week`, {});
    setPlan(placed);
    return placed;
  }, [planId]);

  const approve = useCallback(async () => {
    if (planId === null) throw new Error("There is no plan to approve.");
    await settle();
    const key = keys.current.get(planId) ?? crypto.randomUUID();
    keys.current.set(planId, key);
    const made = await request<PlanCommit>(`/plans/${planId}/commit`, {
      method: "POST",
      headers: { "Idempotency-Key": key },
    });
    setPlan(null);
    return made;
  }, [planId, settle]);

  const discard = useCallback(async () => {
    if (planId === null) throw new Error("There is no plan to discard.");
    await settle();
    await request<undefined>(`/plans/${planId}/discard`, { method: "POST" });
    setPlan(null);
  }, [planId, settle]);

  // The plan as the screen shows it: without the step being removed.
  const shown =
    plan === null || removing?.plan !== plan.id
      ? plan
      : { ...plan, items: plan.items.filter((item) => item.id !== removing.step) };

  return {
    status,
    plan: shown,
    job,
    capacity,
    reload,
    ask,
    approve,
    discard,
    change,
    add,
    write,
    sendOn,
    remove,
    keep,
    settle,
  };
}
