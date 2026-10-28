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
 *
 * The level is the server's `load`, never recomputed here: the round's first drawing used
 * thresholds of its own and was sent back for it, because 18h and 20h are fixed in
 * capacity.py and a screen with other numbers would disagree with the API about the same day.
 */
import { formatCompact } from "../lib/time";
import type { DayCapacity, Load } from "../api/types";

export interface Warning {
  /** The sentence, or null when the day needs nothing said about it. */
  message: string | null;
  level: Load;
}

export function warningFor(day: DayCapacity): Warning {
  // Compact, like every other figure in the header it sits in.
  const unbooked = formatCompact(day.unbooked_minutes);

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
