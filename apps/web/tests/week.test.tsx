/**
 * Tests for the week screen.
 *
 * Three claims earn their place here, and they are the three the design was built around:
 * a day is not always 1440 minutes and the geometry has to say so; a day can be booked past
 * its own length and must report that without a negative number; and the overlap rule
 * belongs to the database, so its refusal has to arrive from the server rather than from a
 * check this client is not in a position to make.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetClientForTests } from "../src/api/client";
import { setAccessToken } from "../src/api/token";
import type { DayCapacity, Task } from "../src/api/types";
import { type Carried, carriedInto } from "../src/week/carried";
import { toLocalDate } from "../src/lib/time";
import { DayColumn } from "../src/week/DayColumn";
import { WeekScreen } from "../src/week/WeekScreen";
import { SessionProvider } from "../src/auth/session";

const SAO_PAULO = "America/Sao_Paulo";

const USABLE = 16 * 60;

function aDay(overrides: Partial<DayCapacity> = {}): DayCapacity {
  const base: DayCapacity = {
    day: "2026-08-24",
    weekday: 1,
    total_minutes: 1440,
    usable_minutes: USABLE,
    occupied_minutes: 120,
    free_minutes: USABLE - 120,
    unbooked_minutes: 1440 - 120,
    task_count: 2,
    over_capacity: false,
    load: "fine",
  };
  return { ...base, ...overrides };
}

/** A day booked for `minutes`, with every derived figure kept consistent. */
function booked(minutes: number, overrides: Partial<DayCapacity> = {}): DayCapacity {
  const load =
    minutes > 20 * 60
      ? "unsustainable"
      : minutes > 18 * 60
        ? "strained"
        : minutes > USABLE
          ? "heavy"
          : "fine";
  return aDay({
    occupied_minutes: minutes,
    free_minutes: Math.max(0, USABLE - minutes),
    unbooked_minutes: Math.max(0, 1440 - minutes),
    over_capacity: minutes > USABLE,
    load,
    ...overrides,
  });
}

const NOOP = {
  onHover: () => undefined,
  onOpenForm: () => undefined,
  onCancelForm: () => undefined,
  onCreate: () => undefined,
  onToggle: () => undefined,
};

/** A task, given a local start and end in São Paulo. */
function aTask(id: string, startsAt: string, endsAt: string, over: Partial<Task> = {}): Task {
  const start = new Date(`${startsAt}-03:00`);
  const end = new Date(`${endsAt}-03:00`);
  return {
    id,
    title: id,
    notes: null,
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    duration_minutes: (end.getTime() - start.getTime()) / 60_000,
    completed_at: null,
    tag: null,
    items: [],
    ...over,
  };
}

/** 23:00 Sunday to 04:00 Monday: five hours, of which four land on the receiving day. */
const OVERNIGHT = aTask("pager", "2026-08-23T23:00:00", "2026-08-24T04:00:00");

function carriedFor(tasks: Task[]): Carried[] {
  return [...carriedInto(tasks, SAO_PAULO).values()].flat();
}

/** The same local wall time the task factory takes, as the instant the API would send. */
function instant(local: string): string {
  return new Date(`${local}-03:00`).toISOString();
}

interface When {
  tasks?: Task[];
  carried?: Carried[];
  onGoToOwner?: ((taskId: string) => void) | null;
  openTask?: string | null;
  onOpenTask?: (taskId: string | null) => void;
  onToggle?: (task: Task) => void;
  lighter?: DayCapacity | null;
  today?: boolean;
  past?: boolean;
}

function renderDay(capacity: DayCapacity, when: When = {}): HTMLElement {
  const { container } = render(
    <DayColumn
      capacity={capacity}
      lighter={when.lighter ?? null}
      tasks={when.tasks ?? []}
      carried={when.carried ?? []}
      onGoToOwner={when.onGoToOwner === undefined ? () => undefined : when.onGoToOwner}
      openTask={when.openTask ?? null}
      onOpenTask={when.onOpenTask ?? (() => undefined)}
      index={0}
      weekday="Mon"
      date="Aug 24"
      today={when.today ?? false}
      past={when.past ?? false}
      timezone={SAO_PAULO}
      formOpen={false}
      submitting={false}
      serverError={null}
      {...NOOP}
      onToggle={when.onToggle ?? (() => undefined)}
    />,
  );
  return container;
}

function at(container: HTMLElement, selector: string): HTMLElement {
  return container.querySelector(selector) as HTMLElement;
}

function trackWidth(container: HTMLElement): string {
  return at(container, "[data-track]").style.width;
}

it("a day that lost an hour is visibly shorter, without a caption saying so", () => {
  // The one restriction in the data model that changes geometry. If every column measured
  // itself against its own length, every track would be full width and the screen would
  // quietly claim all days are the same size.
  const ordinary = renderDay(aDay({ total_minutes: 1440 }));
  const short = renderDay(aDay({ total_minutes: 1380, day: "2026-11-01" }));

  expect(trackWidth(ordinary)).toBe("96%");
  expect(trackWidth(short)).toBe("92%");
});

it("a day that gained an hour is visibly longer", () => {
  expect(trackWidth(renderDay(aDay({ total_minutes: 1500 })))).toBe("100%");
});

it("a daylight saving day says why it is a different size", () => {
  renderDay(aDay({ total_minutes: 1380 }));

  expect(screen.getByText("1380 min · DST")).toBeDefined();
});

it("an ordinary day does not shout about being ordinary", () => {
  renderDay(aDay({ total_minutes: 1440 }));

  expect(screen.getByText("1440 min")).toBeDefined();
  expect(screen.queryByText(/DST/)).toBeNull();
});

it("a day booked past the usable budget reports zero and says by how much", () => {
  // Against sixteen hours, not against the calendar day. Measured against the day this flag
  // would be unreachable now that minutes are clipped at midnight (ADR-0022).
  const container = renderDay(booked(18 * 60, { task_count: 12 }));

  expect(at(container, "[data-free]").textContent).toBe("0m free of 16h");
  expect(container.textContent).not.toContain("-");
  expect(screen.getByText("over by 2h")).toBeDefined();
});

it("the big number is what is booked, so three different days do not read alike", () => {
  // Why it was inverted. Free floors at zero, so at sixteen, nineteen and twenty-four hours
  // booked the old headline figure was `0m` in all three — identical text, at the largest
  // size on the screen, for days that are nothing like each other.
  const sixteen = at(renderDay(booked(16 * 60)), "[data-booked]").textContent;
  const nineteen = at(renderDay(booked(19 * 60)), "[data-booked]").textContent;
  const full = at(renderDay(booked(24 * 60)), "[data-booked]").textContent;

  expect([sixteen, nineteen, full]).toEqual(["16h", "19h", "24h"]);
  expect(new Set([sixteen, nineteen, full]).size).toBe(3);
});

it("a full day is measured against sixteen hours, not twenty-four", () => {
  // The complaint that started ADR-0022: "why is it only full at 24 hours — doesn't he
  // sleep?". Read off the figure rather than off the column, because the meta line now
  // reports what is left of the calendar day and legitimately says 24h there.
  const container = renderDay(booked(0));

  expect(at(container, "[data-free]").textContent).toBe("16h free of 16h");
});

it("the meta line counts what is left of the whole day, not of the budget", () => {
  // Past sixteen hours booked the budget is spent, so a figure against it would read `0m`
  // on every day heavy enough for anybody to be reading this line.
  renderDay(booked(19 * 60, { task_count: 12 }));

  expect(screen.getByText("12 tasks · 5h of the day unbooked")).toBeDefined();
});

it("the track marks where the budget falls inside the day", () => {
  // Without this the track is a second drawing of the free figure. The bar says how much of
  // the day is gone; the tick says where the line it is measured against sits.
  const ordinary = renderDay(booked(8 * 60));
  const short = renderDay(booked(8 * 60, { total_minutes: 1380 }));

  // Sixteen hours of a 1440-minute day, and of a 1380-minute one.
  expect(at(ordinary, "[data-budget-mark]").style.left).toBe("66.7%");
  expect(at(short, "[data-budget-mark]").style.left).toBe("69.6%");
});

it("a day booked past the budget cuts the mark out of the fill instead of drawing over it", () => {
  const under = at(renderDay(booked(8 * 60)), "[data-budget-mark]").className;
  const over = at(renderDay(booked(18 * 60)), "[data-budget-mark]").className;

  expect(over).not.toBe(under);
});

it("today is named rather than numbered, and carries the rail", () => {
  const container = renderDay(aDay(), { today: true });

  expect(screen.getByText("today")).toBeDefined();
  expect(at(container, '[data-today="1"]')).not.toBeNull();
});

it("any other day keeps its index and no rail", () => {
  const container = renderDay(aDay());

  expect(screen.queryByText("today")).toBeNull();
  expect(screen.getByText("01")).toBeDefined();
  expect(at(container, '[data-today="1"]')).toBeNull();
});

it("a heavy day names the consequence rather than the day", () => {
  renderDay(booked(17 * 60));

  expect(screen.getByText("No margin for anything running late.")).toBeDefined();
});

it("the two loudest levels count what is left of the whole day", () => {
  // Against the budget the figure would read zero at both levels and say nothing.
  renderDay(booked(19 * 60));
  expect(screen.getByText("Extremely heavy day. 5h unbooked.")).toBeDefined();

  renderDay(booked(21 * 60));
  expect(screen.getByText("Unsustainable. 3h unbooked.")).toBeDefined();
});

it("an ordinary day says nothing about its load", () => {
  const container = renderDay(booked(8 * 60));

  expect(container.textContent).not.toMatch(/margin|heavy|unsustainable/i);
});

it("a heavy day points at the lightest day in the week", () => {
  // Deterministic and true today: the screen already has all seven days' capacity, so this
  // is data rather than a model.
  renderDay(booked(19 * 60), { lighter: aDay({ weekday: 2, free_minutes: 9 * 60 }) });

  expect(screen.getByText(/This day is heavier than the rest of your week/)).toBeDefined();
  expect(screen.getByText("Tue has 9h free.")).toBeDefined();
});

describe("what the day before is still holding", () => {
  it("names the task, where it came from, and how much of this day it takes", () => {
    // The bug this closes was visible and passed every test: the day read `4h booked` above
    // an empty column, because the aggregate counts minutes wherever they fall and the list
    // only ever shows tasks by the day they start.
    const container = renderDay(booked(4 * 60, { task_count: 0 }), {
      carried: carriedFor([OVERNIGHT]),
    });

    expect(screen.getByText("carried from Sun")).toBeDefined();
    expect(screen.getByText("from Sun 23:00")).toBeDefined();
    expect(screen.getByText("ends 04:00")).toBeDefined();
    expect(screen.getByText("pager")).toBeDefined();
    expect(container.textContent).toContain("4h of this day");
  });

  it("says the inherited minutes are already counted above, not on top of it", () => {
    // Without this the band reads as an addition, and a reader who adds it twice gets a
    // number wrong in the direction that overbooks.
    renderDay(booked(4 * 60, { task_count: 0 }), { carried: carriedFor([OVERNIGHT]) });

    expect(
      screen.getByText("Not this day’s task. Its minutes are already inside the 4h booked above."),
    ).toBeDefined();
  });

  it("counts the inheritance in the header, where the figures are", () => {
    renderDay(booked(4 * 60, { task_count: 0 }), { carried: carriedFor([OVERNIGHT]) });

    expect(screen.getByText("incl. 4h carried from Sun")).toBeDefined();
  });

  it("a day holding only inherited minutes is not empty", () => {
    // It has no task of its own, so the count is zero — and saying "Nothing booked" would
    // contradict both the figure above it and the band right there on the screen.
    const container = renderDay(booked(4 * 60, { task_count: 0 }), {
      carried: carriedFor([OVERNIGHT]),
    });

    expect(container.textContent).not.toContain("Nothing booked");
  });

  it("offers the way back to the row that owns the task", () => {
    const focused = vi.fn<(taskId: string) => void>();
    renderDay(booked(4 * 60, { task_count: 0 }), {
      carried: carriedFor([OVERNIGHT]),
      onGoToOwner: focused,
    });

    fireEvent.click(screen.getByText("go to Sun"));

    expect(focused).toHaveBeenCalledWith("pager");
  });

  it("offers no way back when the row that owns it is not on this screen", () => {
    // Monday's source is the day before the week: fetched so the figures are right, never
    // rendered. A control that goes nowhere is worse than no control.
    renderDay(booked(4 * 60, { task_count: 0 }), {
      carried: carriedFor([OVERNIGHT]),
      onGoToOwner: null,
    });

    expect(screen.queryByText(/^go to/)).toBeNull();
    // The band itself stays: the minutes are real whether or not the row is reachable.
    expect(screen.getByText("carried from Sun")).toBeDefined();
  });

  it("says nothing at all on a day that inherits nothing", () => {
    const container = renderDay(aDay());

    expect(container.textContent).not.toContain("carried from");
    expect(container.textContent).not.toContain("of this day");
  });
});

describe("the row, and the box that came out of it", () => {
  const PLAIN = aTask("plain", "2026-08-24T09:00:00", "2026-08-24T10:30:00");

  function box(): HTMLElement {
    return screen.getByRole("button", { name: /^Complete/ });
  }

  function disclosure(): HTMLElement {
    return screen.getByRole("button", { expanded: false });
  }

  it("completes from the box without opening the row", () => {
    // The whole reason the box was promoted out of the opened set: this is the verb somebody
    // presses dozens of times a week, and it must not cost an opening.
    const toggled = vi.fn<(task: Task) => void>();
    const opened = vi.fn<(taskId: string | null) => void>();
    renderDay(aDay({ task_count: 1 }), { tasks: [PLAIN], onToggle: toggled, onOpenTask: opened });

    fireEvent.click(box());

    expect(toggled).toHaveBeenCalledWith(PLAIN);
    expect(opened).not.toHaveBeenCalled();
  });

  it("opens from the title without completing the task", () => {
    // The inverse, and the one that used to be impossible: before this the whole row was the
    // toggle, so there was nowhere to press that did not complete something.
    const toggled = vi.fn<(task: Task) => void>();
    const opened = vi.fn<(taskId: string | null) => void>();
    renderDay(aDay({ task_count: 1 }), { tasks: [PLAIN], onToggle: toggled, onOpenTask: opened });

    fireEvent.click(disclosure());

    expect(opened).toHaveBeenCalledWith("plain");
    expect(toggled).not.toHaveBeenCalled();
  });

  it("gives each verb its own control rather than sharing one tab stop", () => {
    // The single focusable row this replaced needed hand-written key handling, and the state
    // it announced sat on a role that does not support it. Two buttons get focus, activation
    // and both states from the elements themselves.
    renderDay(aDay({ task_count: 1 }), { tasks: [PLAIN] });

    expect(box().getAttribute("aria-pressed")).toBe("false");
    expect(disclosure().getAttribute("aria-expanded")).toBe("false");
  });

  it("closes the row it is asked to open again", () => {
    const opened = vi.fn<(taskId: string | null) => void>();
    renderDay(aDay({ task_count: 1 }), {
      tasks: [PLAIN],
      openTask: "plain",
      onOpenTask: opened,
    });

    fireEvent.click(screen.getByRole("button", { expanded: true }));

    expect(opened).toHaveBeenCalledWith(null);
  });

  it("says the row is expanded, so it is not only a visual state", () => {
    renderDay(aDay({ task_count: 1 }), { tasks: [PLAIN], openTask: "plain" });

    expect(screen.getByRole("button", { expanded: true })).toBeDefined();
  });

  it("shows nothing of the note or the checklist while it is shut", () => {
    const withBoth = aTask("both", "2026-08-24T09:00:00", "2026-08-24T10:30:00", {
      notes: "Rehearse against a copy of prod.",
      items: [{ id: "i1", label: "Migration dry run", position: 0, completed_at: null }],
    });
    const container = renderDay(aDay({ task_count: 1 }), { tasks: [withBoth] });

    // The resting row only hints: a `note` word and a count, which is what the design gives
    // it room for.
    expect(screen.getByText("note")).toBeDefined();
    expect(screen.getByText("0/1 checked")).toBeDefined();
    expect(container.textContent).not.toContain("Rehearse against a copy of prod.");
  });

  it("shows the note and the checklist once it is open", () => {
    const withBoth = aTask("both", "2026-08-24T09:00:00", "2026-08-24T10:30:00", {
      notes: "Rehearse against a copy of prod.",
      items: [
        { id: "i1", label: "Migration dry run", position: 0, completed_at: instant("2026-08-24T09:30:00") },
        { id: "i2", label: "Smoke tests", position: 1, completed_at: null },
      ],
    });
    renderDay(aDay({ task_count: 1 }), { tasks: [withBoth], openTask: "both" });

    expect(screen.getByText("Rehearse against a copy of prod.")).toBeDefined();
    expect(screen.getByText("Checklist")).toBeDefined();
    expect(screen.getByText("Migration dry run")).toBeDefined();
    expect(screen.getByText("Smoke tests")).toBeDefined();
  });

  it("does not offer to change a checklist it has no way to save", () => {
    // Editing items has no API — TaskUpdate has no items field and no route touches
    // ChecklistItem — so the lines are text. A control that silently does nothing is worse
    // than one that was never offered.
    const withItems = aTask("items", "2026-08-24T09:00:00", "2026-08-24T10:30:00", {
      items: [{ id: "i1", label: "Migration dry run", position: 0, completed_at: null }],
    });
    renderDay(aDay({ task_count: 1 }), { tasks: [withItems], openTask: "items" });

    expect(screen.queryByRole("button", { name: /Migration dry run/ })).toBeNull();
  });

  it("says so plainly when there is neither", () => {
    renderDay(aDay({ task_count: 1 }), { tasks: [PLAIN], openTask: "plain" });

    expect(
      screen.getByText("No note, no checklist. Both are optional and neither is parsed."),
    ).toBeDefined();
  });
});

describe("what a completed task says about the estimate", () => {
  function doneLineOf(task: Task): string {
    renderDay(aDay({ task_count: 1 }), { tasks: [task] });
    return screen.getByText(/^done /).textContent;
  }

  it("reports when it finished, how long it took, and the difference", () => {
    const early = aTask("early", "2026-08-24T12:00:00", "2026-08-24T13:30:00", {
      duration_minutes: 180,
      completed_at: instant("2026-08-24T13:30:00"),
    });

    expect(doneLineOf(early)).toBe("done 13:30 · 1h30 of 3h · −1h30");
  });

  it("reports an overrun rather than hiding it", () => {
    // end_at is clamped to the planned end by the trigger (ADR-0022), so reading the overrun
    // off it would report every late finish as exact. This is measured to completed_at.
    const late = aTask("late", "2026-08-24T12:00:00", "2026-08-24T13:00:00", {
      duration_minutes: 60,
      completed_at: instant("2026-08-24T13:45:00"),
    });

    expect(doneLineOf(late)).toBe("done 13:45 · 1h45 of 1h · +45m");
  });

  it("has a word for landing exactly on the estimate", () => {
    const exact = aTask("exact", "2026-08-24T12:00:00", "2026-08-24T13:00:00", {
      duration_minutes: 60,
      completed_at: instant("2026-08-24T13:00:00"),
    });

    expect(doneLineOf(exact)).toBe("done 13:00 · 1h of 1h · to the minute");
  });

  it("drops the comparison when the tick came days after the task ran", () => {
    // The box makes this a click away: forget Monday's task, tick it on Wednesday. Measured
    // literally that is `56h22 of 2h30 · +53h52` — true about the clock and false about the
    // work, on the row the planner reads plan-versus-actual from. The date replaces it,
    // because when it was ticked is the only thing that is still known.
    const remembered = aTask("remembered", "2026-08-24T14:00:00", "2026-08-24T16:30:00", {
      duration_minutes: 150,
      completed_at: instant("2026-08-26T22:22:00"),
    });

    expect(doneLineOf(remembered)).toBe("done Aug 26 22:22");
  });

  it("keeps the comparison for a task that ran right up against the bound", () => {
    // A day is the bound because no task may exceed 1440 minutes, so anything inside it can
    // still be describing the task's own run. Twenty-three hours is a real shift.
    const longShift = aTask("shift", "2026-08-24T06:00:00", "2026-08-25T02:00:00", {
      duration_minutes: 20 * 60,
      completed_at: instant("2026-08-25T05:00:00"),
    });

    expect(doneLineOf(longShift)).toBe("done 05:00 · 23h of 20h · +3h");
  });

  it("says nothing at all while the task is still open", () => {
    const container = renderDay(aDay({ task_count: 1 }), {
      tasks: [aTask("open", "2026-08-24T12:00:00", "2026-08-24T13:00:00")],
    });

    expect(container.textContent).not.toContain("done");
  });
});

describe("a task that crosses midnight, on the row that owns it", () => {
  it("marks the end time as tomorrow's and says how the minutes divide", () => {
    // The end time wraps rather than reading `28:00`, so on its own it claims a morning that
    // belongs to the next day.
    const container = renderDay(aDay({ weekday: 7, task_count: 1 }), { tasks: [OVERNIGHT] });

    expect(screen.getByText("+1")).toBeDefined();
    expect(screen.getByText("crosses midnight · 1h Sun / 4h Mon")).toBeDefined();
    expect(container.textContent).toContain("23:00 – 04:00");
  });

  it("leaves a task that stays inside its day unmarked", () => {
    const inside = aTask("inside", "2026-08-24T09:00:00", "2026-08-24T10:30:00");
    const container = renderDay(aDay({ task_count: 1 }), { tasks: [inside] });

    expect(screen.queryByText("+1")).toBeNull();
    expect(container.textContent).not.toContain("crosses midnight");
  });
});

it("a day whose tasks failed to arrive does not claim to be empty", () => {
  // The capacity is the authority on how many tasks a day holds. Gating the empty message
  // on the list would turn a failed fetch into a confident lie.
  const container = renderDay(aDay({ task_count: 3 }));

  expect(container.textContent).not.toContain("Nothing booked");
});

it("an empty day says the whole day is open, in minutes", () => {
  const container = renderDay(aDay({ occupied_minutes: 0, free_minutes: 1440, task_count: 0 }));

  expect(screen.getByText(/Nothing booked/)).toBeDefined();
  expect(container.textContent).toContain("24h");
});

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

let fetchMock: ReturnType<typeof vi.fn<FetchLike>>;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const ME = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "gabriel@example.com",
  timezone: SAO_PAULO,
  verified_at: "2026-08-01T12:00:00Z",
};

function week(days: Partial<DayCapacity>[]): DayCapacity[] {
  return days.map((day, index) =>
    aDay({
      day: `2026-08-${String(24 + index).padStart(2, "0")}`,
      weekday: index + 1,
      occupied_minutes: 0,
      free_minutes: USABLE,
      unbooked_minutes: 1440,
      task_count: 0,
      ...day,
    }),
  );
}

beforeEach(() => {
  resetClientForTests();
  setAccessToken("a.token");
  fetchMock = vi.fn<FetchLike>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function route(routes: Record<string, () => Response>): void {
  fetchMock.mockImplementation((input) => {
    const path = input.replace("/api/v1", "").split("?")[0] ?? "";
    const handler = routes[path];
    if (handler === undefined) throw new Error(`no route for ${path}`);
    return Promise.resolve(handler());
  });
}

function renderWeek(): HTMLElement {
  const { container } = render(
    <SessionProvider>
      <WeekScreen />
    </SessionProvider>,
  );
  return container;
}

/** Seven days starting at the local date asked for, rather than at a fixed one. */
function weekFrom(firstDay: string, days: Partial<DayCapacity>[]): DayCapacity[] {
  const [year = 2026, month = 8, day = 24] = firstDay.split("-").map(Number);
  return days.map((overrides, index) =>
    aDay({
      day: toLocalDate(new Date(year, month - 1, day + index)),
      weekday: index + 1,
      occupied_minutes: 0,
      free_minutes: USABLE,
      unbooked_minutes: 1440,
      task_count: 0,
      ...overrides,
    }),
  );
}

/**
 * Every route the week needs, answering the window it was actually asked for.
 *
 * The fixed-window mock above is fine for a screen that never navigates. Anything that
 * presses `[` or `]` needs this one: a server that answered last week's dates to a request
 * for next week's would put the today rail on a column showing another date, and the test
 * would be reading its own mock rather than the screen.
 */
function routeWeek(days: Partial<DayCapacity>[], me: typeof ME = ME, tasks: Task[] = []): void {
  fetchMock.mockImplementation((input) => {
    const [path = "", query = ""] = input.replace("/api/v1", "").split("?");

    if (path === "/auth/refresh") {
      return Promise.resolve(
        json(200, { access_token: "a.token", token_type: "bearer", expires_in: 1800 }),
      );
    }
    if (path === "/me") return Promise.resolve(json(200, me));
    if (path === "/tasks") {
      return Promise.resolve(json(200, { items: tasks, limit: 100, offset: 0 }));
    }
    if (path === "/capacity") {
      const first = new URLSearchParams(query).get("first_day") ?? "";
      return Promise.resolve(json(200, weekFrom(first, days)));
    }
    throw new Error(`no route for ${path}`);
  });
}

const SEVEN: Partial<DayCapacity>[] = [{}, {}, {}, {}, {}, {}, {}];

/** The date stamp on whichever column carries the today rail, or null if none does. */
function markedToday(container: HTMLElement): string | null {
  const column = container.querySelector('[data-today="1"]');
  return /[A-Z][a-z]{2} \d{2}/.exec(column?.textContent ?? "")?.[0] ?? null;
}

/** How far from now the header says it is, or null when it says nothing. */
function awayText(container: HTMLElement): string | null {
  return container.querySelector("[data-away]")?.textContent ?? null;
}

function homeButton(): HTMLButtonElement {
  // By role, because `this week` is also a word in the keyboard legend below it.
  return screen.getByRole("button", { name: /this week/ });
}

it("shows the zone the server stores, not the browser's", async () => {
  // The reason GET /me exists. A client that guessed from the browser would ask about one
  // day and render an answer about another, with nothing saying so.
  route({
    "/auth/refresh": () => json(200, { access_token: "a.token", token_type: "bearer", expires_in: 1800 }),
    "/me": () => json(200, { ...ME, timezone: "Asia/Tokyo" }),
    "/capacity": () => json(200, week([{}, {}, {}, {}, {}, {}, {}])),
    "/tasks": () => json(200, { items: [], limit: 100, offset: 0 }),
  });

  renderWeek();

  await waitFor(() => {
    expect(screen.getByText("Asia/Tokyo")).toBeDefined();
  });
});

it("an empty week still reports its capacity", async () => {
  // Capacity is known before anything is on it — which is the product's whole claim, and
  // the empty state is where it is most visible.
  route({
    "/auth/refresh": () => json(200, { access_token: "a.token", token_type: "bearer", expires_in: 1800 }),
    "/me": () => json(200, ME),
    "/capacity": () => json(200, week([{}, {}, {}, {}, {}, {}, {}])),
    "/tasks": () => json(200, { items: [], limit: 100, offset: 0 }),
  });

  renderWeek();

  await waitFor(() => {
    expect(screen.getByText("Nothing booked this week.")).toBeDefined();
  });
  // Seven days of sixteen usable hours, not seven calendar days.
  expect(screen.getByText(/112h free across seven days/)).toBeDefined();
});

it("a week with a day over capacity says so in the summary", async () => {
  route({
    "/auth/refresh": () => json(200, { access_token: "a.token", token_type: "bearer", expires_in: 1800 }),
    "/me": () => json(200, ME),
    "/capacity": () =>
      json(
        200,
        week([
          {},
          {},
          {
            occupied_minutes: 18 * 60,
            free_minutes: 0,
            unbooked_minutes: 6 * 60,
            task_count: 12,
            over_capacity: true,
            load: "heavy",
          },
          {},
          {},
          {},
          {},
        ]),
      ),
    "/tasks": () => json(200, { items: [], limit: 100, offset: 0 }),
  });

  renderWeek();

  await waitFor(() => {
    expect(screen.getByText("1 day over budget")).toBeDefined();
  });
});

describe("the week you are looking at", () => {
  // Only Date is faked. The timers `waitFor` runs on stay real, so a frozen clock does not
  // turn every assertion below into a five-second wait.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks today in the zone the server stores, not in the browser's", async () => {
    // 20:00 UTC is the 26th in São Paulo and already the 27th in Tokyo. Rendering the same
    // instant under both zones is what makes this independent of wherever the tests run: if
    // the browser's clock decided, both would land on the same column.
    vi.setSystemTime(new Date("2026-08-26T20:00:00Z"));

    routeWeek(SEVEN);
    const inSaoPaulo = renderWeek();
    await waitFor(() => {
      expect(markedToday(inSaoPaulo)).not.toBeNull();
    });

    routeWeek(SEVEN, { ...ME, timezone: "Asia/Tokyo" });
    const inTokyo = renderWeek();
    await waitFor(() => {
      expect(markedToday(inTokyo)).not.toBeNull();
    });

    expect(markedToday(inSaoPaulo)).toBe("Aug 26");
    expect(markedToday(inTokyo)).toBe("Aug 27");
  });

  it("names the week it is showing", async () => {
    vi.setSystemTime(new Date("2026-08-26T15:00:00Z"));
    routeWeek(SEVEN);

    renderWeek();

    await waitFor(() => {
      expect(screen.getByText("week 35 · 2026")).toBeDefined();
    });
  });

  it("offers no way back while there is nothing to come back from", async () => {
    vi.setSystemTime(new Date("2026-08-26T15:00:00Z"));
    routeWeek(SEVEN);

    const container = renderWeek();

    await waitFor(() => {
      expect(markedToday(container)).toBe("Aug 26");
    });
    expect(homeButton().disabled).toBe(true);
    expect(awayText(container)).toBeNull();
  });

  it("says how far away it has been walked, and walks back in one press", async () => {
    // `[` and `]` move one week each and the dates alone do not say how many times they were
    // pressed: three weeks out is a plausible-looking set of dates.
    vi.setSystemTime(new Date("2026-08-26T15:00:00Z"));
    routeWeek(SEVEN);
    const container = renderWeek();
    await waitFor(() => {
      expect(markedToday(container)).toBe("Aug 26");
    });

    fireEvent.keyDown(window, { key: "]" });
    fireEvent.keyDown(window, { key: "]" });

    await waitFor(() => {
      expect(awayText(container)).toBe("+2 weeks");
    });
    // Two weeks out, no column is today, so nothing wears the rail.
    expect(markedToday(container)).toBeNull();
    expect(homeButton().disabled).toBe(false);

    fireEvent.keyDown(window, { key: "T" });

    await waitFor(() => {
      expect(markedToday(container)).toBe("Aug 26");
    });
    expect(awayText(container)).toBeNull();
  });

  it("offers the way back only when the owning row is on the screen", async () => {
    // Two bands, one reachable and one not, in the same render. Monday inherits from the
    // Sunday before the week — fetched so its four hours are counted, never drawn — while
    // Thursday inherits from a Wednesday that is right there. Getting the boundary wrong by
    // one column is the whole risk, and it only shows with both cases present.
    vi.setSystemTime(new Date("2026-08-26T15:00:00Z"));
    const fromTheEve = aTask("eve", "2026-08-23T23:00:00", "2026-08-24T04:00:00");
    const insideTheWeek = aTask("pager", "2026-08-26T23:00:00", "2026-08-27T04:00:00");
    routeWeek(SEVEN, ME, [fromTheEve, insideTheWeek]);

    const container = renderWeek();

    await waitFor(() => {
      expect(screen.getAllByText(/^carried from/)).toHaveLength(2);
    });
    const columns = container.querySelectorAll("[class*=grid] > div");
    const monday = columns[0] as HTMLElement;
    const thursday = columns[3] as HTMLElement;

    expect(monday.textContent).toContain("carried from Sun");
    expect(monday.querySelector("[class*=carriedGoTo]")).toBeNull();

    expect(thursday.textContent).toContain("carried from Wed");
    expect(thursday.querySelector("[class*=carriedGoTo]")).not.toBeNull();
  });

  it("sends the reader to the row that owns the inherited task", async () => {
    vi.setSystemTime(new Date("2026-08-26T15:00:00Z"));
    const pager = aTask("pager", "2026-08-26T23:00:00", "2026-08-27T04:00:00");
    routeWeek(SEVEN, ME, [pager]);

    const container = renderWeek();
    await waitFor(() => {
      expect(screen.getByText("go to Wed")).toBeDefined();
    });

    fireEvent.click(screen.getByText("go to Wed"));

    // Focus lands on the row's disclosure, not on the row. The row is a plain container with
    // no tab stop, so `focus()` on it does nothing at all — which is how this would fail
    // silently if the way back were ever pointed at the wrong element again.
    const wednesday = container.querySelectorAll("[class*=grid] > div")[2] as HTMLElement;
    const owningRow = container.querySelector("#task-pager");

    expect(document.activeElement?.getAttribute("aria-expanded")).toBe("false");
    expect(owningRow?.contains(document.activeElement)).toBe(true);
    expect(wednesday.contains(document.activeElement)).toBe(true);
  });

  it("keeps one row open across the whole week, not one per column", async () => {
    // Two panels standing open would each be offering to act on a different task with
    // nothing saying which is in front — which is why the state is on the screen rather than
    // inside each row.
    vi.setSystemTime(new Date("2026-08-26T15:00:00Z"));
    const monday = aTask("mon", "2026-08-24T09:00:00", "2026-08-24T10:00:00");
    const tuesday = aTask("tue", "2026-08-25T09:00:00", "2026-08-25T10:00:00");
    routeWeek(SEVEN, ME, [monday, tuesday]);

    renderWeek();
    await waitFor(() => {
      expect(screen.getAllByRole("button", { expanded: false })).toHaveLength(2);
    });
    const [first, second] = screen.getAllByRole("button", { expanded: false });

    fireEvent.click(first as HTMLElement);
    await waitFor(() => {
      expect((first as HTMLElement).getAttribute("aria-expanded")).toBe("true");
    });

    fireEvent.click(second as HTMLElement);

    await waitFor(() => {
      expect((second as HTMLElement).getAttribute("aria-expanded")).toBe("true");
    });
    expect((first as HTMLElement).getAttribute("aria-expanded")).toBe("false");
  });

  it("shuts the open row on escape", async () => {
    vi.setSystemTime(new Date("2026-08-26T15:00:00Z"));
    routeWeek(SEVEN, ME, [aTask("mon", "2026-08-24T09:00:00", "2026-08-24T10:00:00")]);

    renderWeek();
    await waitFor(() => {
      expect(screen.getByRole("button", { expanded: false })).toBeDefined();
    });
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    await waitFor(() => {
      expect(screen.getByRole("button", { expanded: true })).toBeDefined();
    });

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(screen.getByRole("button", { expanded: false })).toBeDefined();
    });
  });

  it("counts a single week in the singular", async () => {
    vi.setSystemTime(new Date("2026-08-26T15:00:00Z"));
    routeWeek(SEVEN);
    const container = renderWeek();
    await waitFor(() => {
      expect(markedToday(container)).toBe("Aug 26");
    });

    fireEvent.keyDown(window, { key: "[" });

    await waitFor(() => {
      expect(awayText(container)).toBe("-1 week");
    });
  });
});

it("shows nothing rather than stale minutes when the server cannot be reached", async () => {
  // A stale free-minutes count is a number somebody plans against, and it is wrong in the
  // direction that overbooks.
  route({
    "/auth/refresh": () => json(200, { access_token: "a.token", token_type: "bearer", expires_in: 1800 }),
    "/me": () => json(500, { detail: "boom" }),
    "/capacity": () => json(500, { detail: "boom" }),
    "/tasks": () => json(500, { detail: "boom" }),
  });

  renderWeek();

  await waitFor(() => {
    expect(screen.getByText(/Couldn’t reach the server/)).toBeDefined();
  });
  expect(screen.getByText("retry")).toBeDefined();
});
