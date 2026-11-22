/**
 * What the review says about a plan and its steps, from the plan's read alone.
 *
 * Pure, so each sentence plan.dc.html writes can be held to it without a screen: the numbers,
 * the times, what waits on what, and what the plan adds to each day.
 */
import type { DayCapacity, Plan, PlanItem } from "../api/types";
import { clock, dayMonth, formatCompact, weekdayOf, zonedDay, zonedMinutes } from "../lib/time";

/**
 * Each kept step's number, 1 to n in the order the review shows them.
 *
 * Not the position, which counts the model's answer and so skips every step it discarded and
 * collides with a step added by hand (decided on 2026-11-22). "after step N" and a refusal
 * count the same way, so the three always agree.
 */
export function stepNumbers(plan: Plan): Map<string, number> {
  return new Map(plan.items.map((item, index) => [item.id, index + 1]));
}

/** `Thu 22`, for a local date. */
export function shortDay(localDate: string): string {
  return `${weekdayOf(localDate)} ${String(Number(localDate.slice(8, 10)))}`;
}

/** `Thu 22 Oct`, for a local date. */
export function shortDate(localDate: string): string {
  const [year = 1970, month = 1, day = 1] = localDate.split("-").map(Number);
  return `${weekdayOf(localDate)} ${dayMonth(new Date(year, month - 1, day))}`;
}

/** `14:25 – 14:55`, a step's time in the person's zone. Steps never cross midnight. */
export function stepTime(startAt: string, minutes: number, timeZone: string): string {
  const from = zonedMinutes(startAt, timeZone);
  return `${clock(from)} – ${clock(from + minutes)}`;
}

const UNPLACED = {
  passed: "Start passed",
  no_room: "No room",
  not_this_week: "Not this week",
  after_unplaced: "Waits for another step",
} as const;

/** `Thu 22 · 14:25 – 14:55` while it has a time, or what it is waiting for when it has none. */
export function stepWhen(item: PlanItem, timeZone: string): string {
  if (item.start_at !== null) {
    return `${shortDay(zonedDay(item.start_at, timeZone))} · ${stepTime(item.start_at, item.minutes, timeZone)}`;
  }
  return item.state === "placed" ? "" : UNPLACED[item.state];
}

/** `after step 1 and 2`, or null for a step that waits on none. */
export function afterText(item: PlanItem, numbers: Map<string, number>): string | null {
  const before = item.prerequisites
    .map((id) => numbers.get(id))
    .filter((number): number is number => number !== undefined)
    .sort((a, b) => a - b);
  return before.length === 0 ? null : `after step ${before.map(String).join(" and ")}`;
}

/** The steps a commit would be refused for as they stand: no time, or a start gone by. */
export function unusableCount(plan: Plan): number {
  return plan.items.filter((item) => item.start_at === null || item.state === "passed").length;
}

/** `2 steps have no usable time yet. …`, said above Approve before the server has to. */
export function precheckText(plan: Plan): string | null {
  const count = unusableCount(plan);
  if (count === 0) return null;
  const subject = count === 1 ? "1 step has" : `${String(count)} steps have`;
  return `${subject} no usable time yet. Approving would be refused until each has one or is removed.`;
}

/** The days a plan covers, counted from its first to its last. */
export function dayCount(plan: Plan): number {
  return Math.round((Date.parse(plan.last_day) - Date.parse(plan.first_day)) / 86_400_000) + 1;
}

/** `Covers Thu 22 Oct – Wed 4 Nov (14 days). …`: the plan's days, and where this week ends. */
export function coverText(plan: Plan): string {
  const days = dayCount(plan);
  const covers = `Covers ${shortDate(plan.first_day)} – ${shortDate(plan.last_day)} (${String(days)} ${days === 1 ? "day" : "days"}).`;
  const rest =
    plan.last_day > plan.week_ends_on
      ? `This week ends ${shortDay(plan.week_ends_on)}; what doesn’t fit by then is offered for the days after.`
      : `It ends with this week, on ${shortDate(plan.last_day)}.`;
  return `${covers} ${rest}`;
}

/**
 * `6 kept · 3 discarded`, or `2 steps, written by you`.
 *
 * Not the drawing's "9 came back": no row keeps how many steps the answer held, and the two
 * figures it does keep would only add up to it while no step has been removed or added.
 */
export function countText(plan: Plan): string {
  const kept = plan.items.length;
  if (plan.job_id === null) return `${String(kept)} ${kept === 1 ? "step" : "steps"}, written by you`;
  return `${String(kept)} kept · ${String(plan.discarded.length)} discarded`;
}

/** A step with a time, and its number in the review, 1 to n. */
export interface Proposed {
  item: PlanItem & { start_at: string };
  number: number;
}

/**
 * The steps of a plan under review that have a time, by the local date each starts on: what
 * the week shows as proposed while the plan waits, whether or not the review is open.
 */
export function proposedByDay(plan: Plan | null, timeZone: string): Map<string, Proposed[]> {
  const days = new Map<string, Proposed[]>();
  if (plan?.status !== "pending") return days;
  const numbers = stepNumbers(plan);
  for (const item of plan.items) {
    const start = item.start_at;
    if (start === null) continue;
    const day = zonedDay(start, timeZone);
    const step = { item: { ...item, start_at: start }, number: numbers.get(item.id) ?? 0 };
    days.set(day, [...(days.get(day) ?? []), step]);
  }
  return days;
}

/**
 * `Thu 22  6h → 7h30 of 16h`, for each day a step that can still become a task would land on.
 *
 * A step whose start has passed adds nothing: it cannot become a task as it stands. Days with
 * no figures yet are left out rather than drawn from nothing.
 */
export function impactLines(
  plan: Plan,
  capacity: ReadonlyMap<string, DayCapacity>,
  timeZone: string,
): { day: string; text: string }[] {
  const added = new Map<string, number>();
  for (const item of plan.items) {
    if (item.start_at === null || item.state === "passed") continue;
    const day = zonedDay(item.start_at, timeZone);
    added.set(day, (added.get(day) ?? 0) + item.minutes);
  }
  return [...added]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([day, minutes]) => {
      const figures = capacity.get(day);
      if (figures === undefined) return [];
      const before = figures.occupied_minutes;
      return [
        {
          day,
          text: `${shortDay(day)}  ${formatCompact(before)} → ${formatCompact(before + minutes)} of ${formatCompact(figures.usable_minutes)}`,
        },
      ];
    });
}

/** `https://moodle.example.edu/x` → `moodle.example.edu`: what a link shows beside its label. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}
