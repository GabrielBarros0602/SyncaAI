/**
 * What the screen says while a plan is asked for and made, from the request's read alone.
 *
 * Pure, as `steps.ts` is, so each sentence plan.dc.html writes for the form, the wait and the
 * refusals can be held to it without a screen.
 */
import type { Job, Plan } from "../api/types";
import { clock, toLocalDate, weekdayLong, zonedDay, zonedMinutes } from "../lib/time";
import { shortDate } from "./steps";

/** The longest request the server takes (ADR-0030), counted as the field counts it. */
export const MAX_REQUEST = 500;

/** How many days ahead a plan may cover, today included (ADR-0030). */
export const MAX_HORIZON = 14;

function plus(localDate: string, days: number): string {
  const [year = 1970, month = 1, day = 1] = localDate.split("-").map(Number);
  return toLocalDate(new Date(year, month - 1, day + days));
}

function isoWeekday(localDate: string): number {
  const [year = 1970, month = 1, day = 1] = localDate.split("-").map(Number);
  return ((new Date(year, month - 1, day).getDay() + 6) % 7) + 1;
}

/** `1 day, today only`, `14 days, until Wed 4 Nov`: each choice under "Days ahead". */
export function horizonOptions(today: string): { days: number; label: string }[] {
  return Array.from({ length: MAX_HORIZON }, (_, index) => {
    const days = index + 1;
    const label =
      days === 1 ? "1 day, today only" : `${String(days)} days, until ${shortDate(plus(today, index))}`;
    return { days, label };
  });
}

/** `Saturday and Sunday`. */
function inWords(names: string[]): string {
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

/**
 * Under the days: whether the plan stays in this week or is offered the days after it, since
 * a new plan fills the week first and goes no further on its own (ADR-0033).
 *
 * Inside the week, the person's days off among the plan's days are named, which are theirs
 * from their settings rather than the drawing's weekend (ADR-0032).
 */
export function horizonHelp(today: string, days: number, daysOff: readonly number[]): string {
  const sunday = plus(today, 7 - isoWeekday(today));
  const last = plus(today, days - 1);
  if (last > sunday) {
    return `It fills this week first, up to Sunday ${String(Number(sunday.slice(8, 10)))}. What doesn’t fit is offered for the days after.`;
  }
  const off = Array.from({ length: days }, (_, index) => isoWeekday(plus(today, index)))
    .filter((weekday) => daysOff.includes(weekday))
    .map(weekdayLong);
  if (off.length === 0) return "It stays inside this week.";
  return `It stays inside this week. ${inWords(off)} ${off.length === 1 ? "is your day off" : "are your days off"}.`;
}

/**
 * When a refused request may be sent again, from the refusal's `Retry-After`.
 *
 * Rounded up to the minute, so asking at the time it names is never early; the day is named
 * when it is not today, as it is for a month's allowance or the day's limit.
 */
export function retryText(seconds: number, timeZone: string, now: Date = new Date()): string {
  const minute = 60_000;
  const at = new Date(Math.ceil((now.getTime() + seconds * 1000) / minute) * minute).toISOString();
  const time = clock(zonedMinutes(at, timeZone));
  const day = zonedDay(at, timeZone);
  return day === zonedDay(now.toISOString(), timeZone)
    ? `You can ask again at ${time}.`
    : `You can ask again on ${shortDate(day)}, at ${time}.`;
}

/** The wait's word: what the request is doing now. */
export function waitWord(job: Job): string {
  return job.status === "running" ? "Making the plan…" : "Queued";
}

/**
 * The wait's line: when it was asked and for how long.
 *
 * The drawing says when a running plan started; the read carries only when it was asked
 * (ADR-0058), so a running plan says that, with how long plans take.
 */
export function waitLine(job: Job, timeZone: string): string {
  const asked = `Asked at ${clock(zonedMinutes(job.created_at, timeZone))}, for ${String(job.horizon_days)} ${job.horizon_days === 1 ? "day" : "days"}.`;
  return job.status === "running"
    ? `${asked} Plans usually take under a minute.`
    : `${asked} It starts when a place frees up.`;
}

/**
 * A plan written by hand before there is one: what the review shows until its first step is
 * added, which is when the server makes it, since the API takes the plan's name only then and
 * does not rename it (decided on 2026-11-22). Its days and its week are the ones the server
 * will give it, from today; with no id, it is nothing the server has.
 */
export function unwrittenPlan(today: string, days: number): Plan {
  return {
    id: "",
    job_id: null,
    created_at: "",
    status: "pending",
    request: "",
    first_day: today,
    last_day: plus(today, days - 1),
    week_ends_on: plus(today, 7 - isoWeekday(today)),
    items: [],
    discarded: [],
    progress: null,
  };
}

/** The notice that stays until it is acted on: `Your plan is ready: 6 steps, 3 discarded.` */
export function readyText(plan: Plan): string {
  const kept = `${String(plan.items.length)} ${plan.items.length === 1 ? "step" : "steps"}`;
  return plan.discarded.length === 0
    ? `Your plan is ready: ${kept}.`
    : `Your plan is ready: ${kept}, ${String(plan.discarded.length)} discarded.`;
}
