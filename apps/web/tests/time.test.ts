/**
 * Tests for the time formatting.
 *
 * Small surface, and worth every line: every number the week shows passes through here, so
 * a mistake is not a rendering glitch — it is the product lying about how much time
 * somebody has left.
 */
import { describe, expect, it } from "vitest";

import {
  clock,
  daysFrom,
  formatMinutes,
  mondayOf,
  parseClock,
  parseDuration,
  stamp,
  toLocalDate,
  weekdayName,
} from "../src/lib/time";

describe("formatMinutes", () => {
  it("says what a person would say", () => {
    expect(formatMinutes(90)).toBe("1h 30m");
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(780)).toBe("13h");
  });

  it("drops the minutes when they are zero", () => {
    // A column of "2h 00m", "1h 00m", "3h 00m" is noise, and the zeroes carry nothing.
    expect(formatMinutes(120)).toBe("2h");
    expect(formatMinutes(60)).toBe("1h");
  });

  it("pads the minutes so a column lines up", () => {
    expect(formatMinutes(65)).toBe("1h 05m");
  });

  it("shows a full day as hours", () => {
    expect(formatMinutes(1440)).toBe("24h");
    expect(formatMinutes(1380)).toBe("23h");
    expect(formatMinutes(1500)).toBe("25h");
  });

  it("reads zero as a duration, not as nothing", () => {
    // A day with no minutes left says "0m", which is a statement. An empty string is not.
    expect(formatMinutes(0)).toBe("0m");
  });

  it("never shows a negative", () => {
    // The API floors free minutes at zero, and this is the second place that holds — an
    // over-capacity day reports 0m and says so with a flag, never with a minus sign.
    expect(formatMinutes(-30)).toBe("0m");
  });
});

describe("clock", () => {
  it("pads both halves", () => {
    expect(clock(0)).toBe("00:00");
    expect(clock(540)).toBe("09:00");
    expect(clock(545)).toBe("09:05");
  });

  it("wraps past midnight rather than showing a 25th hour", () => {
    // A task starting at 23:30 for 90 minutes ends at 01:00, which is a time a clock can
    // show. Which day those minutes count against is settled elsewhere: all of them land
    // on the day the task starts (ADR-0012).
    expect(clock(1470)).toBe("00:30");
    expect(clock(1530)).toBe("01:30");
  });
});

describe("parseClock", () => {
  it("reads what somebody types", () => {
    expect(parseClock("09:00")).toBe(540);
    expect(parseClock("9:00")).toBe(540);
    expect(parseClock(" 14:30 ")).toBe(870);
  });

  it("returns null for a half-typed value rather than guessing", () => {
    // Somebody who has typed "1" has not made a mistake yet, and a form that guesses
    // "01:00" from it will fight them on the next keystroke.
    expect(parseClock("1")).toBeNull();
    expect(parseClock("")).toBeNull();
    expect(parseClock("14h30")).toBeNull();
  });

  it("refuses a time that no clock has", () => {
    expect(parseClock("24:00")).toBeNull();
    expect(parseClock("12:60")).toBeNull();
  });
});

describe("parseDuration", () => {
  it("reads the ways people write minutes", () => {
    expect(parseDuration("90")).toBe(90);
    expect(parseDuration("90 min")).toBe(90);
    expect(parseDuration("90m")).toBe(90);
  });

  it("refuses nothing, zero, and more than a day", () => {
    // The bound matches the CHECK constraint on the column, so the message can name the
    // limit instead of arriving as a validation error with no number in it.
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("0")).toBeNull();
    expect(parseDuration("1441")).toBeNull();
    expect(parseDuration("1440")).toBe(1440);
  });
});

describe("the week", () => {
  it("starts on Monday, because that is where the API's weekday starts", () => {
    // A Wednesday.
    const monday = mondayOf(new Date(2026, 7, 26));

    expect(toLocalDate(monday)).toBe("2026-08-24");
  });

  it("treats Sunday as the end of its week, not the start of the next", () => {
    // The off-by-one that only shows up on the seventh day.
    const monday = mondayOf(new Date(2026, 7, 30));

    expect(toLocalDate(monday)).toBe("2026-08-24");
  });

  it("a Monday is its own Monday", () => {
    expect(toLocalDate(mondayOf(new Date(2026, 7, 24)))).toBe("2026-08-24");
  });

  it("offsets by whole weeks in both directions", () => {
    const from = new Date(2026, 7, 26);

    expect(toLocalDate(mondayOf(from, 1))).toBe("2026-08-31");
    expect(toLocalDate(mondayOf(from, -1))).toBe("2026-08-17");
  });

  it("crosses a month boundary without arithmetic of its own", () => {
    expect(toLocalDate(mondayOf(new Date(2026, 8, 2), -1))).toBe("2026-08-24");
  });

  it("gives seven consecutive days", () => {
    const week = daysFrom(mondayOf(new Date(2026, 7, 26)));

    expect(week).toHaveLength(7);
    expect(toLocalDate(week[0] as Date)).toBe("2026-08-24");
    expect(toLocalDate(week[6] as Date)).toBe("2026-08-30");
  });

  it("formats a local date without drifting through UTC", () => {
    // toISOString would shift the date for anyone west of Greenwich, which is every user
    // this project has. The window parameters are local dates and must stay local.
    expect(toLocalDate(new Date(2026, 0, 1))).toBe("2026-01-01");
    expect(toLocalDate(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});

describe("labels", () => {
  it("stamps a date short", () => {
    expect(stamp(new Date(2026, 7, 24))).toBe("Aug 24");
    expect(stamp(new Date(2026, 0, 5))).toBe("Jan 05");
  });

  it("names an ISO weekday, where Monday is 1", () => {
    expect(weekdayName(1)).toBe("Mon");
    expect(weekdayName(7)).toBe("Sun");
  });
});

describe("reading an instant in the user's zone", () => {
  it("converts to the wall clock somebody would have seen", async () => {
    const { zonedDay, zonedMinutes } = await import("../src/lib/time");

    // Midday UTC is 09:00 in São Paulo, which is UTC-3.
    expect(zonedMinutes("2026-08-24T12:00:00Z", "America/Sao_Paulo")).toBe(540);
    expect(zonedDay("2026-08-24T12:00:00Z", "America/Sao_Paulo")).toBe("2026-08-24");
  });

  it("puts a late task on the day the user calls it", async () => {
    const { zonedDay, zonedMinutes } = await import("../src/lib/time");

    // 01:00 UTC on the 25th is 22:00 on the 24th in São Paulo. Reading the instant instead
    // of the zone would move a Monday evening onto Tuesday, and the whole week with it.
    expect(zonedDay("2026-08-25T01:00:00Z", "America/Sao_Paulo")).toBe("2026-08-24");
    expect(zonedMinutes("2026-08-25T01:00:00Z", "America/Sao_Paulo")).toBe(1320);
  });

  it("answers for a zone the browser is not in", async () => {
    const { zonedDay, zonedMinutes } = await import("../src/lib/time");

    // The whole reason GET /me exists: the zone is the server's, never this browser's.
    expect(zonedMinutes("2026-08-24T12:00:00Z", "Asia/Tokyo")).toBe(1260);
    expect(zonedDay("2026-08-24T20:00:00Z", "Asia/Tokyo")).toBe("2026-08-25");
  });
});
