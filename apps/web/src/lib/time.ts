/**
 * How a duration reaches the screen.
 *
 * Small, and the only part of the design with a right and a wrong answer. Every number the
 * week shows passes through here, so an error is not a rendering glitch — it is the product
 * lying about how much time somebody has.
 *
 * The API answers in minutes and never in a formatted string, which is what makes this the
 * client's job: the same number reads as `45m` on a task and `13h` on a day, and only the
 * caller knows which scale it is at.
 */

const MINUTES_IN_AN_HOUR = 60;
export const MINUTES_IN_A_DAY = 24 * MINUTES_IN_AN_HOUR;
const MILLISECONDS_IN_A_MINUTE = 60 * 1000;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Format a duration the way a person says it out loud.
 *
 * `90` reads as `1h 30m`, `120` as `2h`, `45` as `45m`. Dropping the minutes when they are
 * zero matters more than it looks: a week of `2h 00m`, `1h 00m`, `3h 00m` is a column of
 * noise, and the zeroes carry nothing.
 */
export function formatMinutes(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / MINUTES_IN_AN_HOUR);
  const rest = whole % MINUTES_IN_AN_HOUR;

  if (hours > 0 && rest > 0) return `${String(hours)}h ${pad(rest)}m`;
  if (hours > 0) return `${String(hours)}h`;
  return `${String(rest)}m`;
}

/**
 * The same duration, tightened for figures that sit next to each other.
 *
 * `90` reads as `1h30`, `120` as `2h`, `45` as `45m`. The space in `formatMinutes` is what
 * makes it read like speech, and that is right in a sentence. A day header stacks three of
 * these in as many lines, and there the space starts reading as a gap *between* numbers
 * rather than inside one — `18h 20m` and `0m` and `16h` stop looking like the same kind of
 * thing.
 */
export function formatCompact(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / MINUTES_IN_AN_HOUR);
  const rest = whole % MINUTES_IN_AN_HOUR;

  if (hours > 0 && rest > 0) return `${String(hours)}h${pad(rest)}`;
  if (hours > 0) return `${String(hours)}h`;
  return `${String(rest)}m`;
}

/**
 * Minutes since local midnight, as a 24-hour clock.
 *
 * Wraps past midnight rather than showing `25:30`, because a task that runs into the next
 * day still ends at a time a clock can show. Which day those minutes count against is
 * settled elsewhere: they are split at midnight and land on the day they happen (ADR-0022),
 * so a wrapped end time is a genuine tomorrow and the row has to say so.
 */
export function clock(minutesFromMidnight: number): string {
  const whole = Math.max(0, Math.round(minutesFromMidnight));
  const hours = Math.floor(whole / MINUTES_IN_AN_HOUR) % 24;
  return `${pad(hours)}:${pad(whole % MINUTES_IN_AN_HOUR)}`;
}

/**
 * Read a typed `HH:MM` back into minutes, or return null.
 *
 * Null rather than an exception, and null rather than a guess. Somebody halfway through
 * typing `1` has not made a mistake yet, and a form that guesses `01:00` from that will
 * fight them on the next keystroke.
 */
export function parseClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (match === null) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;

  return hours * MINUTES_IN_AN_HOUR + minutes;
}

/**
 * Read a duration the way people type it: `90`, `90 min`, `90m`.
 *
 * Anything past a day is refused here rather than at the server, so the message names the
 * bound instead of arriving as a validation error with no number in it.
 */
export function parseDuration(value: string): number | null {
  const digits = value.replace(/\D/g, "");
  if (digits === "") return null;

  const minutes = Number(digits);
  if (minutes <= 0 || minutes > MINUTES_IN_A_DAY) return null;

  return minutes;
}

/** The local date as `YYYY-MM-DD`, which is what the API's window parameters take. */
export function toLocalDate(date: Date): string {
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The Monday of the week containing `date`, plus an offset in weeks.
 *
 * Monday rather than Sunday because the ISO weekday the API reports starts there, and
 * having the client and the server disagree about where a week begins is the kind of bug
 * that only shows up on the seventh day.
 */
export function mondayOf(date: Date, weekOffset = 0): Date {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - (isoWeekdayOf(monday) - 1) + weekOffset * 7);
  return monday;
}

/** The seven days of a week, given its Monday. */
export function daysFrom(monday: Date): Date[] {
  return Array.from({ length: 7 }, (_, offset) => {
    const day = new Date(monday);
    day.setDate(day.getDate() + offset);
    return day;
  });
}

const MILLISECONDS_IN_A_DAY = MINUTES_IN_A_DAY * MILLISECONDS_IN_A_MINUTE;

/** ISO weekday for a local date, where Monday is 1 and Sunday is 7. */
function isoWeekdayOf(date: Date): number {
  return date.getDay() === 0 ? 7 : date.getDay();
}

/**
 * The ISO week a date belongs to, and the year that week belongs to.
 *
 * The two are returned together because they can disagree with the calendar, which is the
 * whole reason this is not `getMonth`-style arithmetic: ISO puts a week in the year holding
 * its **Thursday**, so the 1st of January can be week 53 of the year before and the 31st of
 * December can be week 1 of the year after. Reading the year off the date instead of off the
 * week would print `week 53 · 2027` for a week that is entirely in 2026.
 */
export function isoWeek(date: Date): { week: number; year: number } {
  const thursday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  thursday.setDate(thursday.getDate() + 4 - isoWeekdayOf(thursday));

  // Week 1 is the one holding 4 January, by definition, so its Thursday is the origin.
  const firstThursday = new Date(thursday.getFullYear(), 0, 4);
  firstThursday.setDate(firstThursday.getDate() + 4 - isoWeekdayOf(firstThursday));

  // Rounded rather than divided exactly: both ends are local midnights, and a daylight
  // saving transition between them makes the span 23 or 25 hours short of a whole number.
  const days = Math.round((thursday.getTime() - firstThursday.getTime()) / MILLISECONDS_IN_A_DAY);
  return { week: 1 + Math.round(days / 7), year: thursday.getFullYear() };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** `Aug 24`, the short stamp the day header uses. */
export function stamp(date: Date): string {
  return `${MONTHS[date.getMonth()] ?? ""} ${pad(date.getDate())}`;
}

/** `Aug 24` for an instant, read in a named zone rather than in the browser's. */
export function zonedStamp(iso: string, timeZone: string): string {
  const parts = partsInZone(iso, timeZone);
  return `${MONTHS[(parts.month ?? 1) - 1] ?? ""} ${pad(parts.day ?? 1)}`;
}

/** The three-letter weekday for an ISO weekday, where Monday is 1. */
export function weekdayName(isoWeekday: number): string {
  return WEEKDAYS[isoWeekday - 1] ?? "";
}

/**
 * The wall-clock parts of an instant, in a named zone.
 *
 * The API stores instants and the screen shows local time, so somewhere the two have to
 * meet. Doing it with `Intl` rather than with an offset is the difference between correct
 * and correct-most-of-the-year: an offset belongs to a zone *at a moment*, not to the zone.
 */
function partsInZone(iso: string, timeZone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(iso));

  const read: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") read[part.type] = Number(part.value);
  }
  return read;
}

/** How far local time is ahead of UTC at a given instant, in minutes. */
function offsetAt(instant: number, timeZone: string): number {
  const parts = partsInZone(new Date(instant).toISOString(), timeZone);
  const asIfUtc = Date.UTC(
    parts.year ?? 1970,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    (parts.hour ?? 0) % 24,
    parts.minute ?? 0,
  );
  return (asIfUtc - instant) / MILLISECONDS_IN_A_MINUTE;
}

/**
 * The first instant of a local day, given as `YYYY-MM-DD`.
 *
 * The inverse of `zonedDay`, and the piece that was missing. Everything else here reads a
 * zone off an instant; this is the only thing that has to go the other way, and going the
 * other way is where the awkward cases live.
 *
 * **Midnight does not always exist.** Brazil used to begin daylight saving *at* midnight, so
 * on 2018-11-04 the clock went from 23:59:59 to 01:00:00 and 00:00 never happened. The first
 * instant of that local day is 01:00 local, and this returns it.
 *
 * The offset is applied twice because the first guess lands on the wrong side of a
 * transition: reading the offset *before* the change and subtracting it gives an instant
 * whose offset is the one *after*. When the second pass falls back into the previous day —
 * which is exactly the skipped-midnight case — the first pass was already the transition
 * itself, and the transition is the first instant the day has.
 *
 * This has to agree with `syncaai.time_windows.utc_window`, which is what the capacity query
 * sums against. A client that disagreed with it would put a figure on the screen the server
 * contradicts.
 */
export function startOfLocalDay(localDate: string, timeZone: string): Date {
  const [year = 1970, month = 1, day = 1] = localDate.split("-").map(Number);
  const asIfUtc = Date.UTC(year, month - 1, day);

  const firstPass = asIfUtc - offsetAt(asIfUtc, timeZone) * MILLISECONDS_IN_A_MINUTE;
  const secondPass = asIfUtc - offsetAt(firstPass, timeZone) * MILLISECONDS_IN_A_MINUTE;

  return new Date(zonedDay(new Date(secondPass).toISOString(), timeZone) === localDate
    ? secondPass
    : firstPass);
}

/** Real minutes between two instants, which is not the same as clock minutes. */
export function minutesBetween(from: string | Date, to: string | Date): number {
  const start = from instanceof Date ? from.getTime() : Date.parse(from);
  const end = to instanceof Date ? to.getTime() : Date.parse(to);
  return (end - start) / MILLISECONDS_IN_A_MINUTE;
}

/** Minutes since local midnight, for an instant seen from `timeZone`. */
export function zonedMinutes(iso: string, timeZone: string): number {
  const parts = partsInZone(iso, timeZone);
  return ((parts.hour ?? 0) % 24) * MINUTES_IN_AN_HOUR + (parts.minute ?? 0);
}

/** The local date an instant falls on, `YYYY-MM-DD`, seen from `timeZone`. */
export function zonedDay(iso: string, timeZone: string): string {
  const parts = partsInZone(iso, timeZone);
  return `${String(parts.year ?? 0)}-${pad(parts.month ?? 1)}-${pad(parts.day ?? 1)}`;
}
