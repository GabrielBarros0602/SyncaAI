/**
 * Moving an open task to another day of the week.
 *
 * Each test is one of the rules the move panel answers to, and each rule belongs to a record:
 * only a start strictly in the future is offered (ADR-0012), occupancy is read off `end_at`
 * so finishing early frees time and crossing midnight holds the next morning (ADR-0022), the
 * server's 409 is the authority on overlap (ADR-0008), and a move sends the start and nothing
 * else (the rule `changes.ts` already holds for edits).
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../src/api/client";
import type { DayCapacity, Task, TaskChanges } from "../src/api/types";
import { DayColumn } from "../src/week/DayColumn";
import type { Panel } from "../src/week/TaskRow";

const SAO_PAULO = "America/Sao_Paulo";
const USABLE = 16 * 60;

/** A São Paulo wall time as the instant the API would send. */
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

/** Monday 24 August 2026 to Sunday 30, every day empty unless told otherwise. */
function theWeek(overrides: Record<string, Partial<DayCapacity>> = {}): DayCapacity[] {
  return Array.from({ length: 7 }, (_, index) => {
    const day = `2026-08-${String(24 + index)}`;
    return {
      day,
      weekday: index + 1,
      total_minutes: 1440,
      usable_minutes: USABLE,
      occupied_minutes: 0,
      free_minutes: USABLE,
      unbooked_minutes: 1440,
      task_count: 0,
      over_capacity: false,
      load: "fine" as const,
      ...overrides[day],
    };
  });
}

interface Setup {
  task: Task;
  others?: Task[];
  days?: DayCapacity[];
  onSave?: (taskId: string, changes: TaskChanges) => Promise<void>;
  onOpen?: (open: { id: string; panel: Panel } | null) => void;
  panel?: Panel | null;
}

/** The column that owns `task`, with its row open on the move panel. */
function openMove({ task, others = [], days = theWeek(), onSave, onOpen, panel = "move" }: Setup): void {
  const own = days.find((day) => day.day === task.start_at.slice(0, 10));
  if (own === undefined) throw new Error(`no column for ${task.start_at}`);
  render(
    <DayColumn
      capacity={own}
      lighter={null}
      tasks={[task]}
      week={days}
      allTasks={[task, ...others]}
      carried={[]}
      onGoToOwner={null}
      openTask={panel === null ? null : { id: task.id, panel }}
      saving={new Set()}
      onOpenTask={onOpen ?? (() => undefined)}
      onSaveTask={onSave ?? (() => Promise.resolve())}
      onDeleteTask={() => Promise.resolve()}
      index={0}
      weekday="Mon"
      date="Aug 24"
      today={false}
      past={false}
      timezone={SAO_PAULO}
      formOpen={false}
      submitting={false}
      serverError={null}
      onHover={() => undefined}
      onOpenForm={() => undefined}
      onCancelForm={() => undefined}
      onCreate={() => undefined}
      onToggle={() => undefined}
    />,
  );
}

/** The button for a day in the move panel. Its name says why when it is not on offer. */
function dayButton(weekday: string): HTMLButtonElement {
  return screen.getByRole("button", { name: new RegExp(`^${weekday} Aug \\d{2}`) });
}

beforeEach(() => {
  // Only Date is faked, so waitFor's own timers keep running.
  vi.useFakeTimers({ toFake: ["Date"] });
  // Sunday 23 August, midday: the whole week ahead is in the future.
  vi.setSystemTime(new Date(at("2026-08-23T12:00:00")));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("moving a task to another day", () => {
  const LECTURE = aTask("lecture", "2026-08-24T09:00:00", "2026-08-24T10:30:00", {
    title: "Compilers lecture",
    notes: "Bring the slides.",
    tag: { id: "g1", name: "college" },
  });

  it("sends the new start and nothing else", () => {
    const saved = vi.fn<(taskId: string, changes: TaskChanges) => Promise<void>>(() =>
      Promise.resolve(),
    );
    openMove({ task: LECTURE, onSave: saved });

    fireEvent.click(dayButton("Wed"));

    // 09:00 on Wednesday in São Paulo is 12:00 UTC. Exactly this object: a title, a tag or a
    // duration riding along would fail here.
    expect(saved).toHaveBeenCalledTimes(1);
    expect(saved).toHaveBeenCalledWith("lecture", { start_at: "2026-08-26T12:00:00.000Z" });
  });

  it("does not offer the day the task is already on", () => {
    openMove({ task: LECTURE });

    expect(dayButton("Mon").disabled).toBe(true);
    expect(dayButton("Mon").getAttribute("aria-label")).toContain("the day it is on");
  });

  it("never offers a start at or before now", () => {
    // Wednesday at exactly 09:00. The server refuses `start_at <= now`, so the boundary itself
    // is out, not only the days behind it.
    vi.setSystemTime(new Date(at("2026-08-26T09:00:00")));
    const thursday = aTask("standup", "2026-08-27T09:00:00", "2026-08-27T09:30:00");

    openMove({ task: thursday });

    expect(dayButton("Mon").disabled).toBe(true);
    expect(dayButton("Tue").disabled).toBe(true);
    expect(dayButton("Wed").disabled).toBe(true);
    expect(dayButton("Wed").getAttribute("aria-label")).toContain("already past");
    expect(dayButton("Fri").disabled).toBe(false);
    expect(dayButton("Sat").disabled).toBe(false);
    expect(dayButton("Sun").disabled).toBe(false);
  });

  it("offers a day again once the start is a minute ahead", () => {
    vi.setSystemTime(new Date(at("2026-08-26T08:59:00")));
    const thursday = aTask("standup", "2026-08-27T09:00:00", "2026-08-27T09:30:00");

    openMove({ task: thursday });

    expect(dayButton("Wed").disabled).toBe(false);
  });

  it("treats a task finished early as holding only the time it took", () => {
    // Tuesday's report was planned 10:00 to 13:00 and finished at 11:00, so the server holds
    // 10:00 to 11:00. Wednesday's identical report is still open and holds all three hours.
    const finishedEarly = aTask("tue-report", "2026-08-25T10:00:00", "2026-08-25T11:00:00", {
      duration_minutes: 180,
      completed_at: at("2026-08-25T11:00:00"),
    });
    const stillPlanned = aTask("wed-report", "2026-08-26T10:00:00", "2026-08-26T13:00:00");
    const lateMorning = aTask("review", "2026-08-24T11:30:00", "2026-08-24T12:30:00");

    openMove({ task: lateMorning, others: [finishedEarly, stillPlanned] });

    expect(dayButton("Tue").disabled).toBe(false);
    expect(dayButton("Wed").disabled).toBe(true);
    expect(dayButton("Wed").getAttribute("aria-label")).toContain("taken");
  });

  it("treats a task across midnight as holding the next morning", () => {
    // Monday 23:00 to Tuesday 02:00. A task at 01:00 cannot go to Tuesday, though nothing on
    // Tuesday's own list starts at that hour.
    const overnight = aTask("deploy", "2026-08-24T23:00:00", "2026-08-25T02:00:00");
    const early = aTask("backup", "2026-08-27T01:00:00", "2026-08-27T02:00:00");

    openMove({ task: early, others: [overnight] });

    expect(dayButton("Tue").disabled).toBe(true);
    expect(dayButton("Mon").disabled).toBe(false);
  });

  it("keeps the panel open with the server's sentence when the slot is taken after all", async () => {
    // The panel sees one week. A task in it can still be refused by one it cannot see, and
    // the constraint is the authority: show what it said, do not retry, do not recalculate.
    const refused = vi.fn<(taskId: string, changes: TaskChanges) => Promise<void>>(() =>
      Promise.reject(new ApiError(409, "That time is already taken by another task.")),
    );
    openMove({ task: LECTURE, onSave: refused });

    fireEvent.click(dayButton("Wed"));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe(
        "That time is already taken by another task.",
      );
    });
    expect(screen.getByText("Move to")).toBeDefined();
    expect(dayButton("Fri").disabled).toBe(false);
    expect(refused).toHaveBeenCalledTimes(1);
  });

  it("is not offered on a task that is already done", () => {
    // Its end_at was shortened to when it was finished. Moved to a later day it would have an
    // empty range: it would look moved and hold nothing (ADR-0022). Undecided; not offered.
    const done = aTask("done", "2026-08-24T09:00:00", "2026-08-24T10:00:00", {
      completed_at: at("2026-08-24T10:00:00"),
    });
    const opened = vi.fn<(open: { id: string; panel: Panel } | null) => void>();
    openMove({ task: done, panel: "open", onOpen: opened });

    expect(screen.queryByRole("button", { name: "move" })).toBeNull();

    fireEvent.keyDown(screen.getByRole("button", { expanded: true }), { key: "m" });
    expect(opened).not.toHaveBeenCalled();
  });
});
