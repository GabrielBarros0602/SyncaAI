/**
 * When a task actually holds the clock.
 *
 * From `start_at` to `end_at`, half-open, and never from `start_at + duration_minutes`. The two
 * agree until a task is completed early: the trigger then shortens `end_at` to the moment it
 * was done (ADR-0022), and the exclusion constraint lets the rest of the slot be booked. A
 * client that derived the end from the duration would hold that time as taken after the
 * server had already released it.
 *
 * Instants, not local days. A task from 23:00 to 02:00 is one interval, so it blocks the first
 * two hours of the next day without anything here knowing where midnight is — the same
 * clipping the capacity query does, arrived at by not splitting in the first place.
 *
 * This is advice, never the rule. The client sees one week and the eve before it; the
 * constraint sees everything, and a slot this calls free can still be refused (ADR-0008).
 */
import type { Task } from "../api/types";

const MILLISECONDS_IN_A_MINUTE = 60_000;

/** A half-open span of time, in epoch milliseconds: it contains `start`, not `end`. */
export interface Interval {
  start: number;
  end: number;
}

/** What a task holds, as the database does: `tstzrange(start_at, end_at)`. */
export function occupancyOf(task: Task): Interval {
  return { start: Date.parse(task.start_at), end: Date.parse(task.end_at) };
}

/**
 * Whether two spans share any instant.
 *
 * An empty span shares nothing. A task completed before it began has `end_at = start_at`, and
 * PostgreSQL treats that range as empty, so it overlaps nothing at all — without this check it
 * would collide with anything spanning its single instant.
 */
export function overlaps(a: Interval, b: Interval): boolean {
  if (a.start >= a.end || b.start >= b.end) return false;
  return a.start < b.end && b.start < a.end;
}

/**
 * The task already holding some of that time, or null when it is clear: what a refusal names.
 *
 * The task being moved is left out, because the slot it is leaving is about to be free and
 * would otherwise refuse a move onto part of itself.
 */
export function takenBy(tasks: Task[], start: Date, minutes: number, except: string): Task | null {
  const slot = { start: start.getTime(), end: start.getTime() + minutes * MILLISECONDS_IN_A_MINUTE };
  return tasks.find((task) => task.id !== except && overlaps(slot, occupancyOf(task))) ?? null;
}
