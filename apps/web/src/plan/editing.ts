/**
 * What the review says while its steps are changed, from the plan's read alone.
 *
 * Pure, as `steps.ts` is, so the days a step may be given, what waits for next week and the
 * notices each change ends in are held to the drawing without a screen.
 */
import type { Plan, PlanItem } from "../api/types";
import { clock, toLocalDate, zonedDay, zonedMinutes } from "../lib/time";
import { shortDate, shortDay } from "./steps";

function plus(localDate: string, days: number): string {
  const [year = 1970, month = 1, day = 1] = localDate.split("-").map(Number);
  return toLocalDate(new Date(year, month - 1, day + days));
}

function isoWeekday(localDate: string): number {
  const [year = 1970, month = 1, day = 1] = localDate.split("-").map(Number);
  return ((new Date(year, month - 1, day).getDay() + 6) % 7) + 1;
}

/**
 * The days a step can be given a start on: the plan's, from today. A day off is offered too,
 * and says so, since the person deciding may want it; only the planner keeps off it (ADR-0032).
 */
export function stepDays(
  plan: Plan,
  today: string,
  daysOff: readonly number[],
): { day: string; label: string; off: boolean }[] {
  const days: { day: string; label: string; off: boolean }[] = [];
  for (let day = today > plan.first_day ? today : plan.first_day; day <= plan.last_day; day = plus(day, 1)) {
    const off = daysOff.includes(isoWeekday(day));
    days.push({ day, label: off ? `${shortDate(day)} (day off)` : shortDate(day), off });
  }
  return days;
}

/** The first day after the plan's first week: where a step waiting for next week would go. */
export function nextWeekStarts(plan: Plan): string {
  return plus(plan.week_ends_on, 1);
}

/** `2 steps wait for next week: step 4, step 5. They’d go from Mon 26, in order.` */
export function nextWeekText(waiting: PlanItem[], numbers: Map<string, number>, plan: Plan): string {
  const which = waiting.map((item) => `step ${String(numbers.get(item.id) ?? 0)}`).join(", ");
  const from = shortDay(nextWeekStarts(plan));
  return waiting.length === 1
    ? `1 step waits for next week: ${which}. It’d go from ${from}.`
    : `${String(waiting.length)} steps wait for next week: ${which}. They’d go from ${from}, in order.`;
}

/** `Thu 22, 14:25`: where a step starts, in the person's zone. */
function startsAt(startAt: string, timeZone: string): string {
  return `${shortDay(zonedDay(startAt, timeZone))}, ${clock(zonedMinutes(startAt, timeZone))}`;
}

/** What sending the waiting steps on came to, read from the plan the server answered with. */
export function sentText(sent: readonly string[], plan: Plan, timeZone: string): string {
  const placed = plan.items
    .filter((item) => sent.includes(item.id) && item.start_at !== null)
    .map((item) => item.start_at as string)
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  const first = placed[0];
  if (first === undefined) {
    return `${sent.length === 1 ? "The step" : `The ${String(sent.length)} steps`} found no room next week either.`;
  }
  return placed.length === 1
    ? `1 step placed next week, at ${startsAt(first, timeZone)}.`
    : `${String(placed.length)} steps placed next week, from ${startsAt(first, timeZone)}.`;
}

/** `Added “Revisar” at Thu 22, 14:25, the first free time.`, or why it has none. */
export function addedText(item: PlanItem, timeZone: string): string {
  return item.start_at === null
    ? `Added “${item.title}”. ${item.reason ?? ""}`.trimEnd()
    : `Added “${item.title}” at ${startsAt(item.start_at, timeZone)}, the first free time.`;
}

/** `Removed step 2, “Limits: exercises”.` Numbered as it was shown when it went. */
export function removedText(number: number, title: string): string {
  return `Removed step ${String(number)}, “${title}”.`;
}
