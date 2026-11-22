/**
 * Tests for what the review says about a plan, from its read alone.
 *
 * The claims that matter are the ones plan.dc.html got wrong or left open: kept steps are
 * numbered 1 to n whatever the model discarded, and what a plan adds to a day leaves out what
 * can no longer become a task. Why a step has no time is the server's sentence (ADR-0059).
 */
import { describe, expect, it } from "vitest";

import type { DayCapacity, Plan, PlanItem } from "../src/api/types";
import {
  afterText,
  countText,
  coverText,
  hostOf,
  impactLines,
  precheckText,
  proposedByDay,
  stepNumbers,
  stepWhen,
} from "../src/plan/steps";

const LISBON = "Europe/Lisbon";

function anItem(id: string, over: Partial<PlanItem> = {}): PlanItem {
  return {
    id,
    position: 0,
    title: id,
    description: "",
    minutes: 30,
    start_at: null,
    state: "no_room",
    reason: null,
    prerequisites: [],
    links: [],
    ...over,
  };
}

function aPlan(items: PlanItem[], over: Partial<Plan> = {}): Plan {
  return {
    id: "p1",
    job_id: "j1",
    created_at: "2026-10-22T13:20:00Z",
    status: "pending",
    request: "Estudar para a prova de cálculo",
    first_day: "2026-10-22",
    last_day: "2026-11-04",
    week_ends_on: "2026-10-25",
    items,
    discarded: [],
    progress: null,
    ...over,
  };
}

function aDay(day: string, occupied: number): DayCapacity {
  return {
    day,
    weekday: 4,
    total_minutes: 1440,
    usable_minutes: 960,
    occupied_minutes: occupied,
    free_minutes: 960 - occupied,
    unbooked_minutes: 1440 - occupied,
    task_count: 1,
    over_capacity: false,
    load: "fine",
  };
}

// 14:25 in Lisbon on Thursday 22 October, which is UTC+1 until the clocks go back on the 25th.
const AT_1425 = "2026-10-22T13:25:00Z";

describe("numbering", () => {
  it("numbers the kept steps 1 to n in the order shown, whatever positions the answer gave", () => {
    // Positions 0, 2 and 5: the model's 1 and 3 and 4 were discarded, and a step added by hand
    // took the next position after the last kept one.
    const plan = aPlan([
      anItem("a", { position: 0 }),
      anItem("b", { position: 2 }),
      anItem("c", { position: 5 }),
    ]);

    expect([...stepNumbers(plan)]).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
  });

  it("says what a step waits on in the same numbers", () => {
    const plan = aPlan([anItem("a"), anItem("b"), anItem("c", { prerequisites: ["b", "a"] })]);
    const numbers = stepNumbers(plan);

    expect(afterText(plan.items[2] as PlanItem, numbers)).toBe("after step 1 and 2");
    expect(afterText(plan.items[0] as PlanItem, numbers)).toBeNull();
  });
});

describe("a step's time, or what it waits for", () => {
  it("reads a placed step's time in the person's zone", () => {
    const item = anItem("a", { start_at: AT_1425, state: "placed" });

    expect(stepWhen(item, LISBON)).toBe("Thu 22 · 14:25 – 14:55");
  });

  it("keeps the time of a step whose start has passed", () => {
    const item = anItem("a", { start_at: AT_1425, state: "passed" });

    expect(stepWhen(item, LISBON)).toBe("Thu 22 · 14:25 – 14:55");
  });

  it("names what a step with no time is waiting for", () => {
    expect(stepWhen(anItem("a", { state: "no_room" }), LISBON)).toBe("No room");
    expect(stepWhen(anItem("a", { state: "not_this_week" }), LISBON)).toBe("Not this week");
    expect(stepWhen(anItem("a", { state: "after_unplaced" }), LISBON)).toBe("Waits for another step");
  });
});

describe("the line above Approve", () => {
  it("counts the steps a commit would refuse, a passed start among them", () => {
    const plan = aPlan([
      anItem("a", { start_at: AT_1425, state: "placed" }),
      anItem("b", { start_at: AT_1425, state: "passed" }),
      anItem("c", { state: "no_room" }),
    ]);

    expect(precheckText(plan)).toBe(
      "2 steps have no usable time yet. Approving would be refused until each has one or is removed.",
    );
  });

  it("says nothing when every step has a time ahead of it", () => {
    expect(precheckText(aPlan([anItem("a", { start_at: AT_1425, state: "placed" })]))).toBeNull();
  });
});

describe("what the plan covers", () => {
  it("says where this week ends when the plan goes past it", () => {
    expect(coverText(aPlan([]))).toBe(
      "Covers Thu 22 Oct – Wed 4 Nov (14 days). This week ends Sun 25; what doesn’t fit by then is offered for the days after.",
    );
  });

  it("says it ends with the week when it does", () => {
    expect(coverText(aPlan([], { last_day: "2026-10-25" }))).toBe(
      "Covers Thu 22 Oct – Sun 25 Oct (4 days). It ends with this week, on Sun 25 Oct.",
    );
  });

  it("counts what was kept and discarded, and a plan by hand by its own steps", () => {
    const discarded = [{ position: 6, title: "Simulado", reasons: ["Too long."] }];

    expect(countText(aPlan([anItem("a"), anItem("b")], { discarded }))).toBe("2 kept · 1 discarded");
    expect(countText(aPlan([anItem("a")], { job_id: null }))).toBe("1 step, written by you");
  });
});

describe("what the plan adds to each day", () => {
  it("adds each day's steps to what it has booked, and leaves out a start that has passed", () => {
    const plan = aPlan([
      anItem("a", { start_at: AT_1425, state: "placed" }),
      anItem("b", { start_at: "2026-10-22T14:00:00Z", minutes: 60, state: "placed" }),
      anItem("c", { start_at: "2026-10-22T09:00:00Z", state: "passed" }),
      anItem("d", { start_at: "2026-10-27T08:00:00Z", state: "placed" }),
    ]);
    const capacity = new Map([
      ["2026-10-22", aDay("2026-10-22", 360)],
      ["2026-10-27", aDay("2026-10-27", 0)],
    ]);

    expect(impactLines(plan, capacity, LISBON).map((line) => line.text)).toEqual([
      "Thu 22  6h → 7h30 of 16h",
      "Tue 27  0m → 30m of 16h",
    ]);
  });

  it("leaves a day out rather than drawing it from no figures", () => {
    const plan = aPlan([anItem("a", { start_at: AT_1425, state: "placed" })]);

    expect(impactLines(plan, new Map(), LISBON)).toEqual([]);
  });
});

describe("the steps proposed in the week", () => {
  it("puts each step with a time on the day it starts, with its number", () => {
    const plan = aPlan([
      anItem("a", { state: "no_room" }),
      anItem("b", { start_at: AT_1425, state: "placed" }),
    ]);

    const days = proposedByDay(plan, LISBON);

    expect([...days.keys()]).toEqual(["2026-10-22"]);
    expect(days.get("2026-10-22")?.map((step) => [step.item.id, step.number])).toEqual([["b", 2]]);
  });

  it("proposes nothing from a plan that is no longer pending", () => {
    const plan = aPlan([anItem("b", { start_at: AT_1425, state: "placed" })], { status: "expired" });

    expect(proposedByDay(plan, LISBON).size).toBe(0);
  });
});

it("shows a link's host beside its label, and nothing for an address it cannot read", () => {
  expect(hostOf("https://moodle.example.edu/calculo1/limites")).toBe("moodle.example.edu");
  expect(hostOf("not a url")).toBe("");
});
