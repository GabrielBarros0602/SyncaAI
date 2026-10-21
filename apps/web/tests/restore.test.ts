/**
 * When a deleted task can be recreated as it was, and what the recreate sends (ADR-0025).
 */
import { describe, expect, it } from "vitest";

import type { Task } from "../src/api/types";
import { canBeRestored, restoreBlocker, snapshotOf } from "../src/week/restore";

const NOW = new Date("2026-08-26T15:00:00.000Z");

function aTask(over: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "Thesis chapter",
    notes: null,
    start_at: "2026-08-27T12:00:00.000Z",
    end_at: "2026-08-27T15:00:00.000Z",
    duration_minutes: 180,
    completed_at: null,
    tag: null,
    items: [],
    ...over,
  };
}

const unticked = { id: "i1", label: "Outline", position: 0, completed_at: null };
const ticked = { id: "i2", label: "Sources", position: 1, completed_at: "2026-08-25T10:00:00.000Z" };

describe("canBeRestored", () => {
  it.each([
    ["a future task with nothing done", aTask(), null],
    ["a future task with an unticked checklist", aTask({ items: [unticked] }), null],
    ["a completed task", aTask({ completed_at: "2026-08-26T14:00:00.000Z" }), "done"],
    ["a task that already began", aTask({ start_at: "2026-08-26T12:00:00.000Z" }), "started"],
    ["a task starting this very instant", aTask({ start_at: NOW.toISOString() }), "started"],
    ["a future task with a ticked item", aTask({ items: [unticked, ticked] }), "checked"],
  ] as const)("%s", (_, task, blocker) => {
    expect(restoreBlocker(task, NOW)).toBe(blocker);
    expect(canBeRestored(task, NOW)).toBe(blocker === null);
  });

  it("is judged at the instant asked about, not when the row was drawn", () => {
    const soon = aTask({ start_at: "2026-08-26T15:05:00.000Z" });

    expect(canBeRestored(soon, NOW)).toBe(true);
    expect(canBeRestored(soon, new Date("2026-08-26T15:05:00.000Z"))).toBe(false);
  });
});

describe("snapshotOf", () => {
  it("carries exactly what a create can, with the tag by name and the items by label", () => {
    const task = aTask({
      notes: "Ask about the sources.",
      tag: { id: "g1", name: "college" },
      // Out of order on purpose: the recreate keeps the checklist's order, not the array's.
      items: [
        { id: "i2", label: "Sources", position: 1, completed_at: null },
        { id: "i1", label: "Outline", position: 0, completed_at: null },
      ],
    });

    expect(snapshotOf(task)).toEqual({
      title: "Thesis chapter",
      start_at: "2026-08-27T12:00:00.000Z",
      duration_minutes: 180,
      notes: "Ask about the sources.",
      tag: "college",
      items: [{ label: "Outline" }, { label: "Sources" }],
    });
  });

  it("leaves the empty fields out instead of sending nulls", () => {
    expect(snapshotOf(aTask())).toEqual({
      title: "Thesis chapter",
      start_at: "2026-08-27T12:00:00.000Z",
      duration_minutes: 180,
    });
  });
});
