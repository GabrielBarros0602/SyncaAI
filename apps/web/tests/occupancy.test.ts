/**
 * What counts as taken, which is the question the move panel asks of every day.
 *
 * Each case is one of ADR-0022's claims about occupancy, checked against the shapes the API
 * actually sends: a shortened `end_at` frees time, and a task across midnight holds the start
 * of the next day.
 */
import { describe, expect, it } from "vitest";

import type { Task } from "../src/api/types";
import { occupancyOf, overlaps, takenBy } from "../src/week/occupancy";

/** A local São Paulo wall time as the instant the API would send. */
function at(local: string): string {
  return new Date(`${local}-03:00`).toISOString();
}

function aTask(id: string, start: string, end: string, over: Partial<Task> = {}): Task {
  const startAt = at(start);
  const endAt = at(end);
  return {
    id,
    title: id,
    notes: null,
    start_at: startAt,
    end_at: endAt,
    duration_minutes: (Date.parse(endAt) - Date.parse(startAt)) / 60_000,
    completed_at: null,
    tag: null,
    items: [],
    ...over,
  };
}

const slot = (local: string): Date => new Date(at(local));

describe("what a task holds", () => {
  it("is read off end_at, not off the duration", () => {
    // Planned 10:00 to 13:00, finished at 11:00. The trigger shortened end_at; the duration
    // still says three hours, because it is the plan.
    const done = aTask("report", "2026-08-24T10:00:00", "2026-08-24T11:00:00", {
      duration_minutes: 180,
      completed_at: at("2026-08-24T11:00:00"),
    });

    expect(occupancyOf(done).end).toBe(Date.parse(at("2026-08-24T11:00:00")));
  });

  it("frees the rest of the slot once it is completed early", () => {
    const done = aTask("report", "2026-08-24T10:00:00", "2026-08-24T11:00:00", {
      duration_minutes: 180,
      completed_at: at("2026-08-24T11:00:00"),
    });

    // 11:30 for an hour sits inside the three planned hours and after the real end.
    expect(takenBy([done], slot("2026-08-24T11:30:00"), 60, "moving")).toBeNull();
    // 10:30 is still inside the hour it really took.
    expect(takenBy([done], slot("2026-08-24T10:30:00"), 60, "moving")).not.toBeNull();
  });

  it("holds the first hours of the next day when it crosses midnight", () => {
    const overnight = aTask("deploy", "2026-08-24T23:00:00", "2026-08-25T02:00:00");

    expect(takenBy([overnight], slot("2026-08-25T01:00:00"), 60, "moving")).not.toBeNull();
    expect(takenBy([overnight], slot("2026-08-25T00:00:00"), 30, "moving")).not.toBeNull();
    // Half-open: the moment it ends is free, as it is in tstzrange.
    expect(takenBy([overnight], slot("2026-08-25T02:00:00"), 60, "moving")).toBeNull();
  });

  it("lets a slot end exactly where a task begins", () => {
    const lecture = aTask("lecture", "2026-08-24T09:00:00", "2026-08-24T10:00:00");

    expect(takenBy([lecture], slot("2026-08-24T08:00:00"), 60, "moving")).toBeNull();
  });

  it("does not count the task being moved against its own new slot", () => {
    const lecture = aTask("lecture", "2026-08-24T09:00:00", "2026-08-24T10:00:00");

    expect(takenBy([lecture], slot("2026-08-24T09:30:00"), 60, "lecture")).toBeNull();
  });

  it("holds nothing when it was completed before it began", () => {
    // end_at equals start_at, an empty range, which PostgreSQL never counts as overlapping.
    const early = aTask("early", "2026-08-24T15:00:00", "2026-08-24T15:00:00", {
      duration_minutes: 60,
      completed_at: at("2026-08-24T12:00:00"),
    });

    expect(takenBy([early], slot("2026-08-24T14:30:00"), 60, "moving")).toBeNull();
    expect(overlaps(occupancyOf(early), { start: 0, end: Number.MAX_SAFE_INTEGER })).toBe(false);
  });
});
