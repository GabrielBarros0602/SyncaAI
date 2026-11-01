/**
 * Tests for the heavy day's offer (ADR-0054).
 *
 * The claims are the rule's: only a day past its budget, from today on, gets one; it goes to
 * the lightest day after today that has the slot; it takes the smallest task that alone brings
 * the day back within budget, else the largest that does not; a started or finished task is
 * never offered; and what a task takes off its day stops at midnight. Then the button: it names
 * the task and the day, shows the arithmetic, sends the move panel's own request, and shows the
 * server's refusal.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../src/api/client";
import type { DayCapacity, Task, TaskChanges } from "../src/api/types";
import { DayColumn } from "../src/week/DayColumn";
import { HeavyDayOffer } from "../src/week/HeavyDayOffer";
import { heavyDayOffer, type Offer } from "../src/week/move";
import { expectNoViolations } from "./a11y";

const SAO_PAULO = "America/Sao_Paulo";
const BUDGET = 16 * 60;
// Wednesday 26 August, 12:00 in São Paulo.
const NOW = new Date("2026-08-26T15:00:00Z");

function aDay(day: string, weekday: number, occupied = 0): DayCapacity {
  return {
    day,
    weekday,
    total_minutes: 1440,
    usable_minutes: BUDGET,
    occupied_minutes: occupied,
    free_minutes: Math.max(0, BUDGET - occupied),
    unbooked_minutes: Math.max(0, 1440 - occupied),
    task_count: 0,
    over_capacity: occupied > BUDGET,
    load: occupied > BUDGET ? "heavy" : "fine",
  };
}

/** Monday 24 to Sunday 30 August, every day at `occupied` unless given. */
function week(occupied: Partial<Record<string, number>> = {}): DayCapacity[] {
  return Array.from({ length: 7 }, (_, index) => {
    const day = `2026-08-${String(24 + index)}`;
    return aDay(day, index + 1, occupied[day] ?? 600);
  });
}

/** A task starting at a São Paulo wall time. */
function aTask(id: string, local: string, minutes: number, over: Partial<Task> = {}): Task {
  const start = new Date(`${local}-03:00`);
  return {
    id,
    title: id,
    notes: null,
    start_at: start.toISOString(),
    end_at: new Date(start.getTime() + minutes * 60_000).toISOString(),
    duration_minutes: minutes,
    completed_at: null,
    tag: null,
    items: [],
    ...over,
  };
}

function offerOn(day: string, days: DayCapacity[], own: Task[], others: Task[] = []): Offer | null {
  const capacity = days.find((each) => each.day === day);
  if (capacity === undefined) throw new Error(`no ${day}`);
  return heavyDayOffer(capacity, own, days, [...own, ...others], SAO_PAULO, NOW);
}

describe("the rule", () => {
  // Thursday is 2h over; Saturday is the lightest day after today.
  const DAYS = week({ "2026-08-27": BUDGET + 120, "2026-08-29": 60 });
  const SHORT = aTask("short", "2026-08-27T08:00:00", 60);
  const ENOUGH = aTask("enough", "2026-08-27T10:00:00", 150);
  const LONG = aTask("long", "2026-08-27T14:00:00", 180);

  it("offers nothing on a day within its budget", () => {
    expect(offerOn("2026-08-28", DAYS, [aTask("calm", "2026-08-28T09:00:00", 60)])).toBeNull();
  });

  it("takes the smallest task that alone brings the day back, to the lightest day after today", () => {
    const offer = offerOn("2026-08-27", DAYS, [LONG, SHORT, ENOUGH]);

    expect(offer?.task.id).toBe("enough");
    expect(offer?.to.day).toBe("2026-08-29");
    expect(offer?.to.startAt).toBe(new Date("2026-08-29T10:00:00-03:00").toISOString());
    expect(offer?.lightest).toBe(true);
    expect(offer?.after).toBe(BUDGET + 120 - 150);
  });

  it("takes the largest that does not, when no task alone is enough", () => {
    const days = week({ "2026-08-27": BUDGET + 300, "2026-08-29": 60 });

    expect(offerOn("2026-08-27", days, [SHORT, ENOUGH])?.task.id).toBe("enough");
  });

  it("never offers a task that has started or is done", () => {
    // Today, at noon: one began at nine, one is finished, one is still ahead.
    const days = week({ "2026-08-26": BUDGET + 60, "2026-08-29": 60 });
    const begun = aTask("begun", "2026-08-26T09:00:00", 180);
    const finished = aTask("finished", "2026-08-26T13:00:00", 120, { completed_at: NOW.toISOString() });
    const ahead = aTask("ahead", "2026-08-26T16:00:00", 30);

    expect(offerOn("2026-08-26", days, [begun, finished, ahead])?.task.id).toBe("ahead");
  });

  it("goes only to days after today, and past a lightest day whose slot is taken", () => {
    // Monday is emptier than anything, and gone. Saturday is the lightest left, and taken at ten.
    const days = week({ "2026-08-24": 0, "2026-08-27": BUDGET + 120, "2026-08-29": 60, "2026-08-28": 300 });
    const inTheWay = aTask("dentist", "2026-08-29T10:00:00", 60);

    const offer = offerOn("2026-08-27", days, [ENOUGH], [inTheWay]);

    expect(offer?.to.day).toBe("2026-08-28");
    expect(offer?.lightest).toBe(false);
  });

  it("offers nothing on a day that has gone", () => {
    const days = week({ "2026-08-25": BUDGET + 120 });

    expect(offerOn("2026-08-25", days, [aTask("old", "2026-08-25T10:00:00", 150)])).toBeNull();
  });

  it("works in a later week, where every day is after today", () => {
    // Monday 31 August to Sunday 6 September, Monday 1h over and the rest alike.
    const later = ["2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06"].map(
      (day, index) => aDay(day, index + 1, index === 0 ? BUDGET + 60 : 600),
    );
    const monday = aTask("monday", "2026-08-31T10:00:00", 90);

    const offer = heavyDayOffer(later[0] as DayCapacity, [monday], later, [monday], SAO_PAULO, NOW);

    expect(offer?.task.id).toBe("monday");
    expect(offer?.to.day).toBe("2026-09-01");
  });

  it("counts only the minutes a task holds before midnight", () => {
    // 1h20 over. "late" is 1h40 long but only 1h of it is Thursday's, so it is not enough alone.
    const days = week({ "2026-08-27": BUDGET + 80, "2026-08-29": 60 });
    const late = aTask("late", "2026-08-27T23:00:00", 100);
    const day = aTask("day", "2026-08-27T10:00:00", 110);

    const offer = offerOn("2026-08-27", days, [late, day]);

    expect(offer?.task.id).toBe("day");
    expect(offer?.after).toBe(BUDGET + 80 - 110);
  });
});

describe("the button", () => {
  const TASK = aTask("Gym", "2026-08-27T10:00:00", 150);
  const OFFER: Offer = {
    task: TASK,
    to: {
      day: "2026-08-29",
      weekday: 6,
      startAt: new Date("2026-08-29T10:00:00-03:00").toISOString(),
      blocker: null,
      takenBy: null,
    },
    lightest: true,
    after: 930,
  };
  type Save = (taskId: string, changes: TaskChanges, sentence: string) => Promise<void>;

  function show(offer: Offer, onSave: Save = vi.fn<Save>(() => Promise.resolve())): HTMLElement {
    const { container } = render(
      <HeavyDayOffer
        offer={offer}
        weekday="Thu"
        free={900}
        thisWeek
        timezone={SAO_PAULO}
        tabbable
        onSave={onSave}
      />,
    );
    return container;
  }

  it("names the task and the day, and shows the arithmetic under it", () => {
    const container = show(OFFER);

    expect(screen.getByRole("button", { name: "Move “Gym” to Sat 29" })).toBeDefined();
    expect(container.textContent).toContain(
      "Same time, 10:00–12:30. Sat is the lightest day left this week, 15h free. Thu would drop to 15h30.",
    );
  });

  it("does not call a day the lightest when the offer had to go past it", () => {
    const container = show({ ...OFFER, lightest: false });

    expect(container.textContent).toContain("Sat has 15h free.");
    expect(container.textContent).not.toContain("lightest");
  });

  it("sends the move panel's own request, and names where the task went", () => {
    const onSave = vi.fn<Save>(() => Promise.resolve());
    show(OFFER, onSave);

    fireEvent.click(screen.getByRole("button", { name: "Move “Gym” to Sat 29" }));

    expect(onSave).toHaveBeenCalledWith("Gym", { start_at: OFFER.to.startAt }, "Moved “Gym” to Sat 29, 10:00.");
  });

  it("shows the server's refusal under the button", async () => {
    show(OFFER, vi.fn<Save>(() => Promise.reject(new ApiError(409, "That time is already taken by another task."))));

    fireEvent.click(screen.getByRole("button", { name: "Move “Gym” to Sat 29" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("That time is already taken by another task.");
    });
  });

  it("has nothing an automated accessibility check can find", async () => {
    await expectNoViolations(show(OFFER));
  });
});

describe("on the day", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function heavyThursday(focusedCell: number | null): void {
    const days = week({ "2026-08-27": BUDGET + 120, "2026-08-29": 60 });
    const tasks = [aTask("Gym", "2026-08-27T10:00:00", 150)];
    render(
      <DayColumn
        capacity={days[3] as DayCapacity}
        tasks={tasks}
        week={days}
        allTasks={tasks}
        carried={[]}
        onGoToOwner={null}
        openTask={null}
        saving={new Set()}
        onOpenTask={() => undefined}
        onSaveTask={() => Promise.resolve()}
        onDeleteTask={() => Promise.resolve()}
        index={3}
        date="27 Aug"
        today={false}
        past={false}
        timezone={SAO_PAULO}
        focusedCell={focusedCell}
        onFocusCell={() => undefined}
        onOpenForm={() => undefined}
        onToggle={() => Promise.resolve()}
        onChecklist={() => Promise.resolve()}
      />,
    );
  }

  it("sits in the day's header, with the receiving day's free figure", () => {
    heavyThursday(0);

    const button = screen.getByRole("button", { name: "Move “Gym” to Sat 29" });
    expect(button.closest("[data-cell='3:0']")).not.toBeNull();
    expect(button.tabIndex).toBe(0);
    expect(screen.getByText(/Sat is the lightest day left this week, 15h free\./)).toBeDefined();
  });

  it("is reached by Tab only while the header holds the week's stop", () => {
    heavyThursday(null);

    expect(screen.getByRole("button", { name: "Move “Gym” to Sat 29" }).tabIndex).toBe(-1);
  });
});
