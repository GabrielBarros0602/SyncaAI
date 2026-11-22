/**
 * Tests for what the screen says while a plan is asked for and made, from the request alone.
 *
 * The claims that matter are the ones the drawing left to the code: a refused request names the
 * minute it may be sent again and never one too early, the day when it is not today, and the
 * days off the help names are the person's, among the plan's own days.
 */
import { describe, expect, it } from "vitest";

import type { Job, Plan } from "../src/api/types";
import { horizonHelp, horizonOptions, readyText, retryText, waitLine } from "../src/plan/asking";

const LISBON = "Europe/Lisbon";
// Thursday 22 October 2026. Lisbon is UTC+1 until the clocks go back on the 25th.
const THURSDAY = "2026-10-22";
const AT_1420 = new Date("2026-10-22T13:20:00Z");

describe("the days ahead", () => {
  it("offers one to fourteen days, each saying the day it reaches", () => {
    const options = horizonOptions(THURSDAY);

    expect(options).toHaveLength(14);
    expect(options[0]).toEqual({ days: 1, label: "1 day, today only" });
    expect(options[1]?.label).toBe("2 days, until Fri 23 Oct");
    expect(options[13]?.label).toBe("14 days, until Wed 4 Nov");
  });

  it("says a plan past Sunday fills this week first", () => {
    expect(horizonHelp(THURSDAY, 5, [6, 7])).toBe(
      "It fills this week first, up to Sunday 25. What doesn’t fit is offered for the days after.",
    );
  });

  it("names the person's days off among the plan's days, and only those", () => {
    expect(horizonHelp(THURSDAY, 4, [6, 7])).toBe(
      "It stays inside this week. Saturday and Sunday are your days off.",
    );
    expect(horizonHelp(THURSDAY, 3, [6, 7])).toBe("It stays inside this week. Saturday is your day off.");
    expect(horizonHelp(THURSDAY, 2, [6, 7])).toBe("It stays inside this week.");
    expect(horizonHelp(THURSDAY, 4, [])).toBe("It stays inside this week.");
  });
});

describe("when a refused request may be sent again", () => {
  it("names the minute, in the person's zone", () => {
    expect(retryText(23 * 60, LISBON, AT_1420)).toBe("You can ask again at 14:43.");
  });

  it("rounds up, so the minute it names is never early", () => {
    expect(retryText(23 * 60 + 30, LISBON, AT_1420)).toBe("You can ask again at 14:44.");
  });

  it("names the day when it is not today", () => {
    expect(retryText(18 * 3600 + 52 * 60, LISBON, AT_1420)).toBe(
      "You can ask again on Fri 23 Oct, at 09:12.",
    );
  });
});

function aJob(over: Partial<Job> = {}): Job {
  return {
    job_id: "j1",
    status: "queued",
    failure_reason: null,
    plan_id: null,
    request: "Estudar para a prova de cálculo",
    horizon_days: 14,
    created_at: "2026-10-22T13:20:00Z",
    ...over,
  };
}

describe("the wait", () => {
  it("says when it was asked, and what happens next", () => {
    expect(waitLine(aJob(), LISBON)).toBe("Asked at 14:20, for 14 days. It starts when a place frees up.");
    expect(waitLine(aJob({ status: "running", horizon_days: 1 }), LISBON)).toBe(
      "Asked at 14:20, for 1 day. Plans usually take under a minute.",
    );
  });
});

it("counts the steps a ready plan kept, and what was discarded when anything was", () => {
  const plan = { items: [{}, {}], discarded: [{}] } as unknown as Plan;
  const single = { items: [{}], discarded: [] } as unknown as Plan;

  expect(readyText(plan)).toBe("Your plan is ready: 2 steps, 1 discarded.");
  expect(readyText(single)).toBe("Your plan is ready: 1 step.");
});
