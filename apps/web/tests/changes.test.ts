/**
 * Tests for what an edit actually sends.
 *
 * The defect these exist for is not a crash. Sending all four fields looks correct and works
 * on every task that has not started yet: `PATCH /tasks/{id}` validates `start_at` against
 * the past whenever the field arrives, so an unchanged start time is refused on any task
 * already under way. Correcting a typo in this morning's title would answer
 * `A task cannot start in the past`, naming a field nobody touched.
 */
import { describe, expect, it } from "vitest";

import type { Task } from "../src/api/types";
import { changesFrom, isEmpty } from "../src/week/changes";

/** 09:00 to 10:30 in São Paulo, with a tag. */
function aTask(over: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "Compilers lecture",
    notes: null,
    start_at: "2026-08-24T12:00:00.000Z",
    end_at: "2026-08-24T13:30:00.000Z",
    duration_minutes: 90,
    completed_at: null,
    tag: { id: "g1", name: "college" },
    items: [],
    ...over,
  };
}

const UNCHANGED = {
  title: "Compilers lecture",
  startAt: "2026-08-24T12:00:00.000Z",
  durationMinutes: 90,
  tag: "college",
};

describe("changesFrom", () => {
  it("sends nothing when nothing moved", () => {
    expect(changesFrom(aTask(), UNCHANGED)).toEqual({});
    expect(isEmpty(changesFrom(aTask(), UNCHANGED))).toBe(true);
  });

  it("leaves the start time out when only the title changed", () => {
    // The whole reason this function exists. The field it must not send is the one the
    // server refuses on a task that already began.
    const changes = changesFrom(aTask(), { ...UNCHANGED, title: "Compilers lecture, room 2" });

    expect(changes).toEqual({ title: "Compilers lecture, room 2" });
    expect("start_at" in changes).toBe(false);
  });

  it("does not read a re-spelled instant as a change", () => {
    // The same moment has several ISO spellings, and the panel builds its own from the
    // clock. Comparing the strings would report every save as a change to the start time —
    // which is precisely the field that cannot be resent.
    const changes = changesFrom(aTask({ start_at: "2026-08-24T09:00:00-03:00" }), UNCHANGED);

    expect(changes).toEqual({});
  });

  it("sends the start time when it really moved", () => {
    const changes = changesFrom(aTask(), { ...UNCHANGED, startAt: "2026-08-24T13:00:00.000Z" });

    expect(changes).toEqual({ start_at: "2026-08-24T13:00:00.000Z" });
  });

  it("clears a tag with null rather than with an empty string", () => {
    // Absent means leave it; null means remove it. An empty string would be a third thing
    // the API has no reading for.
    expect(changesFrom(aTask(), { ...UNCHANGED, tag: null })).toEqual({ tag: null });
  });

  it("does not resend a tag that only differs in spelling", () => {
    // The server lowercases and collapses whitespace, so `College` and `college` are one
    // row. Sending it anyway would be a redundant write, and redundant writes are how the
    // habit of resending everything comes back.
    expect(changesFrom(aTask(), { ...UNCHANGED, tag: "  College " })).toEqual({});
  });

  it("adds a tag to a task that had none", () => {
    expect(changesFrom(aTask({ tag: null }), { ...UNCHANGED, tag: "college" })).toEqual({
      tag: "college",
    });
  });

  it("sends every field that moved, and only those", () => {
    const changes = changesFrom(aTask(), {
      title: "Databases lab",
      startAt: "2026-08-24T16:00:00.000Z",
      durationMinutes: 90,
      tag: "college",
    });

    expect(changes).toEqual({ title: "Databases lab", start_at: "2026-08-24T16:00:00.000Z" });
  });
});
