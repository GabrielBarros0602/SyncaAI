/**
 * Tests for what the review says while its steps are changed, from the plan's read alone.
 *
 * The claims: a step can be given any of the plan's days from today on, a day off among them
 * and saying so; what waits for next week is counted and numbered as the review shows it; and
 * each change ends in a notice that says where the step went, read from what the server
 * answered rather than from what was asked.
 */
import { describe, expect, it } from "vitest";

import type { Plan, PlanItem } from "../src/api/types";
import { addedText, nextWeekText, removedText, sentText, stepDays } from "../src/plan/editing";
import { stepNumbers } from "../src/plan/steps";

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

// Made on Tuesday 20 October 2026, for 14 days; its first week ends on Sunday 25.
function aPlan(items: PlanItem[]): Plan {
  return {
    id: "p1",
    job_id: "j1",
    created_at: "2026-10-20T09:00:00Z",
    status: "pending",
    request: "Estudar para a prova",
    first_day: "2026-10-20",
    last_day: "2026-11-02",
    week_ends_on: "2026-10-25",
    items,
    discarded: [],
    progress: null,
  };
}

describe("the days a step can be given", () => {
  it("are the plan's from today, a day off among them and saying so", () => {
    const days = stepDays(aPlan([]), "2026-10-22", [6, 7]);

    expect(days[0]).toEqual({ day: "2026-10-22", label: "Thu 22 Oct", off: false });
    expect(days[2]).toEqual({ day: "2026-10-24", label: "Sat 24 Oct (day off)", off: true });
    expect(days.at(-1)?.day).toBe("2026-11-02");
    expect(days).toHaveLength(12);
  });
});

describe("what waits for next week", () => {
  it("counts and numbers the steps as the review shows them", () => {
    const waiting = [anItem("c", { state: "not_this_week" }), anItem("d", { state: "not_this_week" })];
    const plan = aPlan([anItem("a"), anItem("b"), ...waiting]);

    expect(nextWeekText(waiting, stepNumbers(plan), plan)).toBe(
      "2 steps wait for next week: step 3, step 4. They’d go from Mon 26, in order.",
    );
    expect(nextWeekText(waiting.slice(0, 1), stepNumbers(plan), plan)).toBe(
      "1 step waits for next week: step 3. It’d go from Mon 26.",
    );
  });

  it("says where the steps sent on went, from the plan the server answered with", () => {
    // 08:00 and 09:00 in Lisbon on Monday 26, after the clocks went back.
    const plan = aPlan([
      anItem("c", { start_at: "2026-10-26T09:00:00Z", state: "placed" }),
      anItem("d", { start_at: "2026-10-26T08:00:00Z", state: "placed" }),
      anItem("e", { state: "no_room" }),
    ]);

    expect(sentText(["c", "d", "e"], plan, LISBON)).toBe("2 steps placed next week, from Mon 26, 08:00.");
    expect(sentText(["c"], plan, LISBON)).toBe("1 step placed next week, at Mon 26, 09:00.");
    expect(sentText(["e"], plan, LISBON)).toBe("The step found no room next week either.");
  });
});

describe("the notices a change ends in", () => {
  it("says where an added step went, or why it has no time", () => {
    // 14:25 in Lisbon on Thursday 22, which is UTC+1 then.
    const placed = anItem("x", { title: "Revisar", start_at: "2026-10-22T13:25:00Z", state: "placed" });
    const unplaced = anItem("y", {
      title: "Revisar",
      reason: "No free time in the plan's days holds 90 minutes in one piece.",
    });

    expect(addedText(placed, LISBON)).toBe("Added “Revisar” at Thu 22, 14:25, the first free time.");
    expect(addedText(unplaced, LISBON)).toBe(
      "Added “Revisar”. No free time in the plan's days holds 90 minutes in one piece.",
    );
  });

  it("names a removed step by the number it was shown with", () => {
    expect(removedText(2, "Limites: exercícios")).toBe("Removed step 2, “Limites: exercícios”.");
  });
});
