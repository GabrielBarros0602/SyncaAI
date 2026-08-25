/**
 * What the screen says about a heavy day.
 *
 * One sentence shape at every level, and the number does the escalating. An earlier draft
 * had the middle step read "this isn't sustainable", which is the app having an opinion
 * about somebody's life — and a tool that does that is a tool people close.
 *
 * The figure is measured against the whole twenty-four hours, not against the sixteen-hour
 * budget. Past sixteen hours booked the budget is already spent, so a figure against it
 * would read `0h` at every level that shows one.
 */
import { formatMinutes } from "../lib/time";
import type { DayCapacity, Load } from "../api/types";

export interface Warning {
  /** The sentence, or null when the day needs nothing said about it. */
  message: string | null;
  /** How loud to be. Only the last two get the accent's full weight. */
  level: Load;
}

export function warningFor(day: DayCapacity): Warning {
  const unbooked = formatMinutes(day.unbooked_minutes);

  switch (day.load) {
    case "heavy":
      // Names a consequence rather than the day: a fifteen-minute overrun now pushes
      // everything after it.
      return { message: "No margin for anything running late.", level: "heavy" };
    case "strained":
      return { message: `Extremely heavy day. ${unbooked} unbooked.`, level: "strained" };
    case "unsustainable":
      return { message: `Unsustainable. ${unbooked} unbooked.`, level: "unsustainable" };
    default:
      return { message: null, level: "fine" };
  }
}

/**
 * The day in the week with the most room, when there is one worth naming.
 *
 * Deterministic, and available today: the screen already fetches all seven days' capacity,
 * so "Tuesday has 9h free" is data rather than a model. The AI improves this later by
 * choosing *which* task should move — it is not needed for the sentence to be true.
 */
export function lightestDay(days: DayCapacity[], exclude: string): DayCapacity | null {
  const others = days.filter((day) => day.day !== exclude && day.free_minutes > 0);
  if (others.length === 0) return null;

  const lightest = others.reduce((best, day) =>
    day.free_minutes > best.free_minutes ? day : best,
  );
  return lightest;
}
