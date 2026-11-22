import { useCallback, useEffect, useRef, useState } from "react";

import { api, request } from "../api/client";
import type { DayCapacity, Page, Plan, PlanCommit } from "../api/types";

/**
 * The plan the screens follow, found on the server.
 *
 * Nothing about it is kept in the browser, which ADR-0021's lint forbids: a reload, a second
 * tab or another device asks `GET /plans?status=pending&limit=1` and finds the same plan
 * (ADR-0050). The status filtered is the status read, so a plan whose last day has ended is
 * not found as pending.
 */

export type PlanLoad = "loading" | "ready" | "unreachable";

export interface PlanState {
  status: PlanLoad;
  /**
   * The plan waiting for review, or what it became while it was being reviewed: read again
   * after a refusal, it may have expired. Null when there is none.
   */
  plan: Plan | null;
  /** The figures for each of the plan's days, by local date: what "What it adds" reads. */
  capacity: ReadonlyMap<string, DayCapacity>;
  /** Read the plan again, or look for one when there is none. Rejects when unreachable. */
  reload: () => Promise<void>;
  /** Turn the plan into tasks, all or nothing. Rejects with the server's `ApiError`. */
  approve: () => Promise<PlanCommit>;
  /** Set the plan aside. Rejects with the server's `ApiError`. */
  discard: () => Promise<void>;
}

async function findPending(): Promise<Plan | null> {
  const page = await api.get<Page<Plan>>("/plans?status=pending&limit=1");
  return page.items[0] ?? null;
}

/**
 * `revision` is the week's: each time the week arrives again after a write, the days the plan
 * lands on are read again with it, so what the plan adds is measured against what is booked
 * now and agrees with the week beside it.
 */
export function usePlan(revision: number): PlanState {
  const [status, setStatus] = useState<PlanLoad>("loading");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [capacity, setCapacity] = useState<ReadonlyMap<string, DayCapacity>>(new Map());
  // One key per plan, kept across attempts: a commit retried after a lost answer must find the
  // first one rather than make a second set of tasks (ADR-0030). A refused commit wrote
  // nothing, so the same key serves the next attempt too.
  const keys = useRef(new Map<string, string>());

  useEffect(() => {
    let cancelled = false;
    findPending()
      .then((found) => {
        if (cancelled) return;
        setPlan(found);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("unreachable");
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
      const found = planId === null ? await findPending() : await api.get<Plan>(`/plans/${planId}`);
      setPlan(found);
      setStatus("ready");
    } catch (problem) {
      setStatus("unreachable");
      throw problem;
    }
  }, [planId]);

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

  return { status, plan, capacity, reload, approve, discard };
}
