/**
 * Tests for what the previous day is still holding.
 *
 * The bug this closes was visible on screen and passed every test: Thursday read
 * `1 task · 4h booked` above an empty column, because the aggregate counted minutes wherever
 * they fell and the list only ever showed tasks by the day they start.
 */
import { describe, expect, it } from "vitest";

import type { Task } from "../src/api/types";
import { carriedInto, spillOf, splitOf } from "../src/week/carried";

const SAO_PAULO = "America/Sao_Paulo"; // UTC-3, no daylight saving since 2019.

function task(id: string, startAt: string, endAt: string): Task {
  return {
    id,
    title: id,
    notes: null,
    start_at: startAt,
    end_at: endAt,
    duration_minutes: 60,
    completed_at: null,
    tag: null,
    items: [],
  };
}

/** 19:00 Wednesday to 04:00 Thursday, local. */
const CROSSES = task("crosses", "2026-09-09T22:00:00Z", "2026-09-10T07:00:00Z");

describe("spillOf", () => {
  it("gives the receiving day only the minutes that land on it", () => {
    expect(spillOf(CROSSES, SAO_PAULO)).toEqual({
      task: CROSSES,
      minutes: 4 * 60,
      from: "2026-09-09",
    });
  });

  it("says nothing about a task that stays inside its own day", () => {
    const inside = task("inside", "2026-09-09T15:00:00Z", "2026-09-09T17:00:00Z");

    expect(spillOf(inside, SAO_PAULO)).toBeNull();
  });

  it("does not carry a task that ends exactly at midnight", () => {
    // The range is half-open and the server's sum clips it the same way. A band reading
    // `0m carried` would be the two disagreeing about a task neither counts.
    const upToMidnight = task("up-to-midnight", "2026-09-09T23:00:00Z", "2026-09-10T03:00:00Z");

    expect(spillOf(upToMidnight, SAO_PAULO)).toBeNull();
  });

  it("reads the end that was actually occupied, not the one that was planned", () => {
    // Completed early, so `end_at` came back before midnight while `duration_minutes` still
    // describes the plan. The freed time is not carried anywhere (ADR-0022).
    const finishedEarly = {
      ...task("finished-early", "2026-09-09T22:00:00Z", "2026-09-10T01:00:00Z"),
      duration_minutes: 9 * 60,
      completed_at: "2026-09-10T01:00:00Z",
    };

    expect(spillOf(finishedEarly, SAO_PAULO)).toBeNull();
  });

  it("reads the zone it is given, not the browser's", () => {
    // The same instant is Wednesday evening in São Paulo and Thursday morning in Tokyo, so
    // one of them has a spill and the other does not.
    expect(spillOf(CROSSES, "Asia/Tokyo")).toBeNull();
  });
});

describe("the night the clock skipped an hour", () => {
  /**
   * 23:00 Saturday to 04:00 Sunday, across 2018-11-04, when Brazil began daylight saving at
   * midnight and 00:00 never happened.
   *
   * Four hours really pass. The clock says five. The receiving day begins at 01:00 local, so
   * three of those hours fall on Sunday and one on Saturday — and that is what the capacity
   * query sums, because it clips against the same boundary.
   *
   * Reading the spill off the clock gave four hours to Sunday, so the band claimed `4h of
   * this day` directly under a header the server had already counted as `3h`.
   */
  const ACROSS_THE_GAP = task("across-the-gap", "2018-11-04T02:00:00Z", "2018-11-04T06:00:00Z");

  it("carries the hours that really fell on the receiving day", () => {
    expect(spillOf(ACROSS_THE_GAP, SAO_PAULO)?.minutes).toBe(3 * 60);
  });

  it("does not lose the hour that never happened out of the other half", () => {
    // The missing hour belongs to neither day, because nobody spent it. What the two halves
    // must add up to is the time that really passed.
    const split = splitOf(ACROSS_THE_GAP, SAO_PAULO);

    expect(split).toEqual({ own: 60, into: 3 * 60 });
    expect((split?.own ?? 0) + (split?.into ?? 0)).toBe(4 * 60);
  });

  it("still refuses a task that ends exactly as the receiving day begins", () => {
    // 01:00 local is that day's first instant, so a task ending there has spilled nothing.
    // Read off the clock this looked like a sixty-minute spill.
    const upToTheBoundary = task("to-the-boundary", "2018-11-04T00:00:00Z", "2018-11-04T03:00:00Z");

    expect(spillOf(upToTheBoundary, SAO_PAULO)).toBeNull();
  });
});

describe("the night the clock repeats an hour", () => {
  /**
   * 22:00 Saturday to 01:00 Sunday, across 2019-02-17, when daylight saving ended and the
   * clock rolled back to midnight — which lengthens the 16th to 1500 minutes rather than
   * giving the 17th two beginnings.
   *
   * The mirror of the skipped-hour night, and the pair is the point: there the clock ran
   * ahead of real time and here it runs behind it. Four hours really pass, the clock says
   * three, and `own` absorbs the extra hour exactly as it absorbed the missing one — because
   * both are measured as elapsed time and neither is read off a dial.
   */
  const ACROSS_THE_REPEAT = task("across-the-repeat", "2019-02-17T00:00:00Z", "2019-02-17T04:00:00Z");

  it("carries only the hour that fell after the receiving day began", () => {
    expect(spillOf(ACROSS_THE_REPEAT, SAO_PAULO)?.minutes).toBe(60);
  });

  it("puts the repeated hour on the day that lived it twice", () => {
    const split = splitOf(ACROSS_THE_REPEAT, SAO_PAULO);

    expect(split).toEqual({ own: 3 * 60, into: 60 });
    expect((split?.own ?? 0) + (split?.into ?? 0)).toBe(4 * 60);
  });

  it("is the reverse of the other night, in the same two numbers", () => {
    // Same shape of task, same clock readings, opposite direction — and the halves swap
    // rather than both drifting the same way, which is what says the arithmetic is elapsed
    // time and not an offset applied somewhere.
    const skipped = splitOf(task("gap", "2018-11-04T02:00:00Z", "2018-11-04T06:00:00Z"), SAO_PAULO);
    const repeated = splitOf(ACROSS_THE_REPEAT, SAO_PAULO);

    expect([skipped?.own, skipped?.into]).toEqual([repeated?.into, repeated?.own]);
  });
});

describe("splitOf", () => {
  it("divides the minutes at the midnight they cross", () => {
    // 19:00 to 04:00: five hours on Wednesday, four on Thursday.
    expect(splitOf(CROSSES, SAO_PAULO)).toEqual({ own: 5 * 60, into: 4 * 60 });
  });

  it("adds up to what is occupied, not to what was planned", () => {
    // Booked for nine hours from 19:00 and completed at 02:00, so `end_at` came back and
    // `duration_minutes` still describes the plan. Splitting the plan would put an hour on
    // Thursday that the header does not count and nobody is spending.
    const finishedEarly = {
      ...task("finished-early", "2026-09-09T22:00:00Z", "2026-09-10T05:00:00Z"),
      duration_minutes: 9 * 60,
      completed_at: "2026-09-10T05:00:00Z",
    };

    const split = splitOf(finishedEarly, SAO_PAULO);

    expect(split).toEqual({ own: 5 * 60, into: 2 * 60 });
    expect((split?.own ?? 0) + (split?.into ?? 0)).toBe(7 * 60);
  });

  it("says nothing about a task that stays inside its own day", () => {
    expect(splitOf(task("inside", "2026-09-09T15:00:00Z", "2026-09-09T17:00:00Z"), SAO_PAULO))
      .toBeNull();
  });
});

describe("carriedInto", () => {
  it("keys the spill under the day receiving it, not the day that owns it", () => {
    const carried = carriedInto([CROSSES], SAO_PAULO);

    expect(carried.get("2026-09-10")?.map((entry) => entry.minutes)).toEqual([4 * 60]);
    expect(carried.has("2026-09-09")).toBe(false);
  });

  it("lists every task a day receives, because a real day has more than one", () => {
    const second = task("second", "2026-09-10T02:00:00Z", "2026-09-10T04:00:00Z");

    const carried = carriedInto([CROSSES, second], SAO_PAULO);

    expect(carried.get("2026-09-10")?.map((entry) => entry.task.id)).toEqual([
      "crosses",
      "second",
    ]);
    expect(carried.get("2026-09-10")?.reduce((sum, entry) => sum + entry.minutes, 0)).toBe(5 * 60);
  });

  it("is empty when nothing crosses a midnight", () => {
    const inside = task("inside", "2026-09-09T15:00:00Z", "2026-09-09T17:00:00Z");

    expect(carriedInto([inside], SAO_PAULO).size).toBe(0);
  });
});
