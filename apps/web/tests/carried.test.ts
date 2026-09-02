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
