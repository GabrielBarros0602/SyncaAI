/**
 * Tests for the week screen.
 *
 * Three claims earn their place here, and they are the three the design was built around:
 * a day is not always 1440 minutes and the geometry has to say so; a day can be booked past
 * its own length and must report that without a negative number; and the overlap rule
 * belongs to the database, so its refusal has to arrive from the server rather than from a
 * check this client is not in a position to make.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, resetClientForTests } from "../src/api/client";
import { setAccessToken } from "../src/api/token";
import type { DayCapacity, Task, TaskChanges } from "../src/api/types";
import { type Carried, carriedInto } from "../src/week/carried";
import type { Panel } from "../src/week/TaskRow";
import { toLocalDate } from "../src/lib/time";
import { DayColumn } from "../src/week/DayColumn";
import { WeekScreen } from "../src/week/WeekScreen";
import { SessionProvider } from "../src/auth/session";
import { expectNoViolations } from "./a11y";

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
  focusedCell: 0,
  onFocusCell: () => undefined,
  onOpenForm: () => undefined,
  onCancelForm: () => undefined,
  onCreate: () => undefined,
  onToggle: () => Promise.resolve(),
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
  /** A bare id opens the resting panel, which is what most of these want. */
  openTask?: string | { id: string; panel: Panel } | null;
  onOpenTask?: (open: { id: string; panel: Panel } | null) => void;
  onSaveTask?: (taskId: string, changes: TaskChanges) => Promise<void>;
  onToggle?: (task: Task) => Promise<void>;
  today?: boolean;
  past?: boolean;
}

function renderDay(
  capacity: DayCapacity,
  when: When = {},
  grid: { focusedCell?: number | null; days?: DayCapacity[] | undefined } = {},
): HTMLElement {
  const { container } = render(
    <DayColumn
      capacity={capacity}
      tasks={when.tasks ?? []}
      week={grid.days ?? [capacity]}
      allTasks={when.tasks ?? []}
      carried={when.carried ?? []}
      onGoToOwner={when.onGoToOwner === undefined ? () => undefined : when.onGoToOwner}
      openTask={typeof when.openTask === "string" ? { id: when.openTask, panel: "open" } : (when.openTask ?? null)}
      saving={new Set()}
      onOpenTask={when.onOpenTask ?? (() => undefined)}
      onSaveTask={when.onSaveTask ?? (() => Promise.resolve())}
      onDeleteTask={() => Promise.resolve()}
      index={0}
      weekday="Mon"
      date="24 Aug"
      today={when.today ?? false}
      past={when.past ?? false}
      timezone={SAO_PAULO}
      formOpen={false}
      submitting={false}
      serverError={null}
      {...NOOP}
      focusedCell={grid.focusedCell ?? NOOP.focusedCell}
      onToggle={when.onToggle ?? (() => Promise.resolve())}
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

it("tells a screen reader how long the day is, in place of the drawing", () => {
  renderDay(booked(2 * 60, { total_minutes: 1380 }));

  expect(screen.getByRole("img", { name: "23-hour day, 2h booked against a 16h budget" })).toBeDefined();
});

it("carries no caption about the day's length, whatever it is", () => {
  // Item 17 of the round: each number once. The trail shows the length and its label says it;
  // "1440 min" or "DST" under the date was a third way of saying the same thing.
  const ordinary = renderDay(aDay({ total_minutes: 1440 }));
  const short = renderDay(aDay({ total_minutes: 1380 }));

  expect(ordinary.textContent).not.toMatch(/min|DST/);
  expect(short.textContent).not.toMatch(/min|DST/);
});

it("a day booked past the usable budget reports zero and says by how much", () => {
  // Against sixteen hours, not against the calendar day. Measured against the day this flag
  // would be unreachable now that minutes are clipped at midnight (ADR-0022).
  const container = renderDay(booked(18 * 60 + 30, { task_count: 12 }));

  expect(at(container, "[data-free]").textContent).toBe("0m free of 16h");
  expect(container.textContent).not.toContain("-");
  expect(screen.getByText("over by 2h30")).toBeDefined();
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
  // sleep?".
  const container = renderDay(booked(0));

  expect(at(container, "[data-free]").textContent).toBe("16h free of 16h");
});

it("measures free against the person's own budget, not a fixed sixteen hours", () => {
  // The usable day is a setting (ADR-0032). A header that printed 16h for everybody would be
  // right for most and wrong, confidently, for whoever changed it.
  const container = renderDay(aDay({ usable_minutes: 12 * 60, occupied_minutes: 2 * 60, free_minutes: 10 * 60 }));

  expect(at(container, "[data-free]").textContent).toBe("10h free of 12h");
});

it("says each number once: no task count and no unbooked figure on an ordinary day", () => {
  // Item 17 of the round. The rows count themselves, and the trail shows what is unbooked;
  // the figure only comes back in words at the two loudest levels, where it is the news.
  const container = renderDay(booked(8 * 60, { task_count: 3 }));

  expect(container.textContent).not.toMatch(/tasks?\b|unbooked/);
});

it("puts every day's budget and end on one ruler", () => {
  // The longest day there is, 25 hours, is the whole width. A 23-hour day ends visibly short of
  // a 24-hour one, and the budget sits at the same place on both, because it is the same
  // sixteen hours.
  const ordinary = renderDay(booked(8 * 60));
  const short = renderDay(booked(8 * 60, { total_minutes: 1380 }));

  expect(at(ordinary, "[data-budget-mark]").style.left).toBe("calc(64% - 1px)");
  expect(at(short, "[data-budget-mark]").style.left).toBe("calc(64% - 1px)");
  expect(at(ordinary, "[data-day-end]").style.left).toBe("calc(96% - 2px)");
  expect(at(short, "[data-day-end]").style.left).toBe("calc(92% - 2px)");
});

it("moves the budget tick with the person's own budget", () => {
  const container = renderDay(booked(8 * 60, { usable_minutes: 12 * 60 }));

  expect(at(container, "[data-budget-mark]").style.left).toBe("calc(48% - 1px)");
});

it("a day booked past the budget cuts the mark out of the fill instead of drawing over it", () => {
  const under = at(renderDay(booked(8 * 60)), "[data-budget-mark]").className;
  const over = at(renderDay(booked(18 * 60)), "[data-budget-mark]").className;

  expect(over).not.toBe(under);
});

it("today is named in the header", () => {
  renderDay(aDay(), { today: true });

  expect(screen.getByText("today")).toBeDefined();
  expect(screen.getByText("Monday")).toBeDefined();
});

it("any other day is named and nothing more", () => {
  const container = renderDay(aDay());

  expect(screen.queryByText("today")).toBeNull();
  // The 01–07 index went with item 17: the weekday already says which day it is.
  expect(container.textContent).not.toContain("01");
});

it("offers a new task from today on, and nothing on a day that has gone", () => {
  // The server refuses a start in the past (ADR-0012), so on a past day the button would be
  // an offer refused every time it was taken.
  renderDay(aDay(), { past: true });
  expect(screen.queryByRole("button", { name: /new task/ })).toBeNull();

  renderDay(aDay(), { today: true });
  expect(screen.getByRole("button", { name: /new task/ }).getAttribute("aria-keyshortcuts")).toBe("N");
});

it("a heavy day names the consequence rather than the day", () => {
  renderDay(booked(17 * 60));

  expect(screen.getByText("No margin for anything running late.")).toBeDefined();
});

it("the two loudest levels count what is left of the whole day", () => {
  // Against the budget the figure would read zero at both levels and say nothing.
  renderDay(booked(19 * 60 + 30));
  expect(screen.getByText("Extremely heavy day. 4h30 unbooked.")).toBeDefined();

  renderDay(booked(21 * 60));
  expect(screen.getByText("Unsustainable. 3h unbooked.")).toBeDefined();
});

it("an ordinary day says nothing about its load", () => {
  const container = renderDay(booked(8 * 60));

  expect(container.textContent).not.toMatch(/margin|heavy|unsustainable/i);
});

describe("what the day before is still holding", () => {
  it("names the task, where it came from, and how much of this day it takes", () => {
    // The bug this closes was visible and passed every test: the day read `4h booked` above
    // an empty column, because the aggregate counts minutes wherever they fall and the list
    // only ever shows tasks by the day they start.
    const container = renderDay(booked(4 * 60, { task_count: 0 }), {
      carried: carriedFor([OVERNIGHT]),
    });

    expect(screen.getByText("↳ carried from Sun")).toBeDefined();
    expect(screen.getByText("23:00 → 04:00")).toBeDefined();
    expect(screen.getByText("pager")).toBeDefined();
    // "here": this day's share, which the booked figure above already counts. The round cut
    // the sentence that said so in full (item 17); the word carries it.
    expect(screen.getByText("4h here")).toBeDefined();
    expect(container.textContent).toContain("4hbooked");
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
    expect(screen.getByText("↳ carried from Sun")).toBeDefined();
  });

  it("says nothing at all on a day that inherits nothing", () => {
    const container = renderDay(aDay());

    expect(container.textContent).not.toContain("carried from");
    expect(container.textContent).not.toContain(" here");
  });
});

describe("the row, and the box that came out of it", () => {
  const PLAIN = aTask("plain", "2026-08-24T09:00:00", "2026-08-24T10:30:00");

  /** The completion box: a checkbox named for what pressing it does. */
  function box(): HTMLElement {
    return screen.getByRole("checkbox", { name: /^(Complete|Reopen) / });
  }

  /** The shut row: a cell of the week's grid, and its own disclosure (ADR-0053). */
  function disclosure(): HTMLElement {
    return screen.getByRole("gridcell", { expanded: false });
  }

  it("completes from the box without opening the row", () => {
    // The whole reason the box was promoted out of the opened set: this is the verb somebody
    // presses dozens of times a week, and it must not cost an opening.
    const toggled = vi.fn<(task: Task) => Promise<void>>().mockResolvedValue(undefined);
    const opened = vi.fn<(open: { id: string; panel: Panel } | null) => void>();
    renderDay(aDay({ task_count: 1 }), { tasks: [PLAIN], onToggle: toggled, onOpenTask: opened });

    fireEvent.click(box());

    expect(toggled).toHaveBeenCalledWith(PLAIN);
    expect(opened).not.toHaveBeenCalled();
  });

  it("shows the server's sentence on the row when it refuses the box", async () => {
    // Reopening a task whose freed time has since been booked is refused (ADR-0022). The
    // promise used to reject with nobody listening, and the row went back without a word.
    const reason = "This task's time has been taken since it was completed.";
    renderDay(aDay({ task_count: 1 }), {
      tasks: [PLAIN],
      onToggle: () => Promise.reject(new ApiError(409, reason)),
    });

    fireEvent.click(box());

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe(reason);
    });
  });

  it("opens from a press on its title without completing the task", () => {
    // The inverse, and the one that used to be impossible: before this the whole row was the
    // toggle, so there was nowhere to press that did not complete something.
    const toggled = vi.fn<(task: Task) => Promise<void>>().mockResolvedValue(undefined);
    const opened = vi.fn<(open: { id: string; panel: Panel } | null) => void>();
    renderDay(aDay({ task_count: 1 }), { tasks: [PLAIN], onToggle: toggled, onOpenTask: opened });

    fireEvent.click(screen.getByText("plain"));

    expect(opened).toHaveBeenCalledWith({ id: "plain", panel: "open" });
    expect(toggled).not.toHaveBeenCalled();
  });

  it("is one tab stop: the row takes focus, and the box does not while it is shut", () => {
    // Two stops a row was about sixty to cross a full week (ADR-0053). Space on the row is
    // the box's press, so the box leaves the tab order until the row opens.
    renderDay(aDay({ task_count: 1 }), { tasks: [PLAIN] }, { focusedCell: 1 });

    expect(disclosure().tabIndex).toBe(0);
    expect(disclosure().getAttribute("aria-expanded")).toBe("false");
    expect(box().tabIndex).toBe(-1);
    expect(box().getAttribute("aria-checked")).toBe("false");
    expect(box().getAttribute("aria-label")).toBe("Complete plain");
  });

  it("opens and closes on Enter, and completes on Space", () => {
    const toggled = vi.fn<(task: Task) => Promise<void>>().mockResolvedValue(undefined);
    const opened = vi.fn<(open: { id: string; panel: Panel } | null) => void>();
    renderDay(aDay({ task_count: 1 }), { tasks: [PLAIN], onToggle: toggled, onOpenTask: opened });

    fireEvent.keyDown(disclosure(), { key: "Enter" });
    expect(opened).toHaveBeenLastCalledWith({ id: "plain", panel: "open" });

    fireEvent.keyDown(disclosure(), { key: " " });
    expect(toggled).toHaveBeenCalledWith(PLAIN);
  });

  it("closes on Enter once open, and its box joins the tab order", () => {
    const opened = vi.fn<(open: { id: string; panel: Panel } | null) => void>();
    renderDay(aDay({ task_count: 1 }), {
      tasks: [PLAIN],
      openTask: "plain",
      onOpenTask: opened,
    });

    fireEvent.keyDown(screen.getByRole("gridcell", { expanded: true }), { key: "Enter" });

    expect(opened).toHaveBeenCalledWith(null);
    expect(box().tabIndex).toBe(0);
    expect(box().getAttribute("aria-keyshortcuts")).toBe("Space");
  });

  it("leaves keys pressed inside an open row to the control they were pressed on", () => {
    const opened = vi.fn<(open: { id: string; panel: Panel } | null) => void>();
    renderDay(aDay({ task_count: 1 }), {
      tasks: [PLAIN],
      openTask: "plain",
      onOpenTask: opened,
    });

    fireEvent.keyDown(screen.getByRole("button", { name: "edit" }), { key: "Enter" });

    expect(opened).not.toHaveBeenCalledWith(null);
  });

  it("says the row is expanded, so it is not only a visual state", () => {
    renderDay(aDay({ task_count: 1 }), { tasks: [PLAIN], openTask: "plain" });

    expect(screen.getByRole("gridcell", { expanded: true })).toBeDefined();
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

  it("names its box for what pressing it does", () => {
    const done = aTask("done", "2026-08-24T09:00:00", "2026-08-24T10:30:00", {
      completed_at: instant("2026-08-24T10:30:00"),
    });
    renderDay(aDay({ task_count: 1 }), { tasks: [done] });

    expect(box().getAttribute("aria-label")).toBe("Reopen done");
    expect(box().getAttribute("aria-checked")).toBe("true");
  });
});

describe("the two verbs an opened row offers", () => {
  const TASK = aTask("lecture", "2026-08-24T09:00:00", "2026-08-24T10:30:00", {
    tag: { id: "g1", name: "college" },
  });

  function openWith(
    panel: Panel,
    over: Partial<When> = {},
    days?: DayCapacity[],
  ): (changes: TaskChanges) => void {
    const saved = vi.fn<(taskId: string, changes: TaskChanges) => Promise<void>>(() =>
      Promise.resolve(),
    );
    renderDay(
      aDay({ task_count: 1 }),
      { tasks: [TASK], openTask: { id: "lecture", panel }, onSaveTask: saved, ...over },
      { days },
    );
    return (changes) => {
      expect(saved).toHaveBeenCalledWith("lecture", changes);
    };
  }

  it("reaches a verb from the row without opening first", () => {
    // The letters are the point of the letters. Having to press Enter and then E would make
    // the shortcut slower than the mouse.
    const opened = vi.fn<(open: { id: string; panel: Panel } | null) => void>();
    renderDay(aDay({ task_count: 1 }), { tasks: [TASK], onOpenTask: opened });

    fireEvent.keyDown(screen.getByRole("gridcell", { expanded: false }), { key: "e" });

    expect(opened).toHaveBeenCalledWith({ id: "lecture", panel: "edit" });
  });

  it("marks which verb is showing, and only that one", () => {
    renderDay(aDay({ task_count: 1 }), { tasks: [TASK], openTask: { id: "lecture", panel: "note" } });

    expect(screen.getByRole("button", { name: "note" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "edit" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("edits a title without touching the start time", () => {
    // The defect this pull request was told about: the panel holds four fields, the task has
    // already begun, and resending the start it did not change is refused by the server.
    const expectSaved = openWith("edit");

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Compilers lecture" } });
    fireEvent.click(screen.getByRole("button", { name: /save/ }));

    expectSaved({ title: "Compilers lecture" });
  });

  it("sends the start time only when the clock was actually retyped", () => {
    const expectSaved = openWith("edit");

    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "11:00" } });
    fireEvent.click(screen.getByRole("button", { name: /save/ }));

    // 11:00 in São Paulo, which is UTC-3.
    expectSaved({ start_at: "2026-08-24T14:00:00.000Z" });
  });

  it("refuses a clock time it cannot read, at the field, before asking the server", () => {
    const saved = vi.fn<(taskId: string, changes: TaskChanges) => Promise<void>>(() =>
      Promise.resolve(),
    );
    renderDay(aDay({ task_count: 1 }), {
      tasks: [TASK],
      openTask: { id: "lecture", panel: "edit" },
      onSaveTask: saved,
    });
    const start = screen.getByLabelText("Start");

    fireEvent.change(start, { target: { value: "half nine" } });
    fireEvent.click(screen.getByRole("button", { name: /save/ }));

    // Beside the field that is wrong, and focus taken there, so nobody hunts for it.
    expect(start.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Use 24-hour time, like 14:30.")).toBeDefined();
    expect(document.activeElement).toBe(start);
    expect(saved).not.toHaveBeenCalled();
  });

  it("reads a duration back the way the screen writes it", () => {
    // The field starts holding `1h30`. Read as digits it would be 130 minutes.
    const expectSaved = openWith("edit");
    expect(screen.getByLabelText<HTMLInputElement>("Duration").value).toBe("1h30");

    fireEvent.change(screen.getByLabelText("Duration"), { target: { value: "2h" } });
    fireEvent.click(screen.getByRole("button", { name: /save/ }));

    expectSaved({ duration_minutes: 120 });
  });

  it("moves the start to another day of the week from the same panel", () => {
    const expectSaved = openWith("edit", {}, [
      aDay(),
      aDay({ day: "2026-08-26", weekday: 3 }),
    ]);

    fireEvent.change(screen.getByLabelText("Start day"), { target: { value: "2026-08-26" } });
    fireEvent.click(screen.getByRole("button", { name: /save/ }));

    // Wednesday, at the same 09:00 in São Paulo.
    expectSaved({ start_at: "2026-08-26T12:00:00.000Z" });
  });

  describe("saying what the start can be before it is refused", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("gives a task that has begun a day to be corrected back to", () => {
      // Monday 14:20: the lecture began at 09:00 today, so its start can go back a day.
      vi.setSystemTime(new Date(instant("2026-08-24T14:20:00")));
      openWith("edit");

      expect(
        screen.getByText("Started 09:00 today. The start can go back to 14:20 yesterday, not earlier."),
      ).toBeDefined();
    });

    it("holds a task that has not begun to now", () => {
      vi.setSystemTime(new Date(instant("2026-08-24T08:15:00")));
      openWith("edit");

      expect(screen.getByText("Not before now: 08:15 today.")).toBeDefined();
    });

    it("says when the task will end, as it is typed", () => {
      vi.setSystemTime(new Date(instant("2026-08-24T08:15:00")));
      openWith("edit");

      fireEvent.change(screen.getByLabelText("Duration"), { target: { value: "16h" } });

      // 09:00 plus sixteen hours is past midnight: the day is named.
      expect(screen.getByText("From 1m to 24h, like 2h30. Ends Tue 01:00.")).toBeDefined();
    });
  });

  it("keeps what was typed when the server refuses the change", () => {
    // A 409 is a rule the person can still satisfy by moving the task an hour. Closing the
    // panel would throw the edit away over something they can fix.
    const rejected = vi.fn<(taskId: string, changes: TaskChanges) => Promise<void>>(() =>
      Promise.reject(new ApiError(409, "That time is already taken by another task.")),
    );
    renderDay(aDay({ task_count: 1 }), {
      tasks: [TASK],
      openTask: { id: "lecture", panel: "edit" },
      onSaveTask: rejected,
    });

    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "11:00" } });
    fireEvent.click(screen.getByRole("button", { name: /save/ }));

    return waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe(
        "That time is already taken by another task.",
      );
      expect(screen.getByLabelText<HTMLInputElement>("Start").value).toBe("11:00");
    });
  });

  it("writes a note", () => {
    const expectSaved = openWith("note");

    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "  Bring the slides.  " } });
    fireEvent.click(screen.getByRole("button", { name: /save/ }));

    expectSaved({ notes: "Bring the slides." });
  });

  it("clears a note with null rather than with an empty string", () => {
    // Absent leaves it, null removes it. An empty string would leave the `note` mark on the
    // resting row pointing at nothing.
    const saved = vi.fn<(taskId: string, changes: TaskChanges) => Promise<void>>(() =>
      Promise.resolve(),
    );
    renderDay(aDay({ task_count: 1 }), {
      tasks: [aTask("noted", "2026-08-24T09:00:00", "2026-08-24T10:30:00", { notes: "old" })],
      openTask: { id: "noted", panel: "note" },
      onSaveTask: saved,
    });

    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /save/ }));

    expect(saved).toHaveBeenCalledWith("noted", { notes: null });
  });

  it("leaves Enter to the text in a note, and saves on the modifier", () => {
    // The one field on this screen somebody writes a paragraph in. Stealing Enter to save
    // would make the second line impossible.
    const saved = vi.fn<(taskId: string, changes: TaskChanges) => Promise<void>>(() =>
      Promise.resolve(),
    );
    renderDay(aDay({ task_count: 1 }), {
      tasks: [TASK],
      openTask: { id: "lecture", panel: "note" },
      onSaveTask: saved,
    });
    const box = screen.getByLabelText("Note");
    fireEvent.change(box, { target: { value: "first line" } });

    fireEvent.keyDown(box, { key: "Enter" });
    expect(saved).not.toHaveBeenCalled();

    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    expect(saved).toHaveBeenCalledWith("lecture", { notes: "first line" });
  });

  it("counts beside its label from the first character, and stops at the bound", () => {
    // The round shows the count throughout (its noteCount), and the field holds no more than
    // the server keeps, so there is no "over the limit" left to say.
    renderDay(aDay({ task_count: 1 }), { tasks: [TASK], openTask: { id: "lecture", panel: "note" } });
    expect(screen.getByText("0/4000")).toBeDefined();
    expect(screen.getByLabelText("Note").getAttribute("maxlength")).toBe("4000");

    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "n".repeat(3900) } });

    expect(screen.getByText("3900/4000")).toBeDefined();
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

    expect(doneLineOf(exact)).toBe("done 13:00 · 1h of 1h · ±0");
  });

  it("names the day it was ticked when that is not the day it began", () => {
    // Item 22 of the round. Forget Monday's task, tick it on Wednesday, and `56h22` is the
    // time between them: with the day in the line it reads as the fact it is, not a glitch.
    const remembered = aTask("remembered", "2026-08-24T14:00:00", "2026-08-24T16:30:00", {
      duration_minutes: 150,
      completed_at: instant("2026-08-26T22:22:00"),
    });

    expect(doneLineOf(remembered)).toBe("done Wed 22:22 · 56h22 of 2h30 · +53h52");
  });

  it("names the next day for a shift that ended there", () => {
    const longShift = aTask("shift", "2026-08-24T06:00:00", "2026-08-25T02:00:00", {
      duration_minutes: 20 * 60,
      completed_at: instant("2026-08-25T05:00:00"),
    });

    expect(doneLineOf(longShift)).toBe("done Tue 05:00 · 23h of 20h · +3h");
  });

  it("says so when it was ticked before it began", () => {
    // A duration measured backwards would be a negative number of minutes.
    const early = aTask("early", "2026-08-24T14:00:00", "2026-08-24T15:00:00", {
      completed_at: instant("2026-08-24T09:10:00"),
    });

    expect(doneLineOf(early)).toBe("done 09:10 · before its start");
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

it("an empty day says so, and leaves the figures to the header", () => {
  renderDay(aDay({ occupied_minutes: 0, free_minutes: USABLE, task_count: 0 }));

  expect(screen.getByText("Nothing booked.")).toBeDefined();
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

/** The local date of whichever day is named today, or null if none is. */
function markedToday(): string | null {
  const pill = screen.queryByText("today");
  return pill?.closest("[data-day]")?.getAttribute("data-day") ?? null;
}

function heading(): string | null {
  return screen.queryByRole("heading", { level: 1 })?.textContent ?? null;
}

function backButton(): HTMLElement | null {
  // By role, because the same words are in the keyboard legend below it.
  return screen.queryByRole("button", { name: /back to this week/ });
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

it("an empty week still reports every day's capacity", async () => {
  // Capacity is known before anything is on it, which is the product's whole claim, and the
  // empty week is where it is most visible.
  route({
    "/auth/refresh": () => json(200, { access_token: "a.token", token_type: "bearer", expires_in: 1800 }),
    "/me": () => json(200, ME),
    "/capacity": () => json(200, week([{}, {}, {}, {}, {}, {}, {}])),
    "/tasks": () => json(200, { items: [], limit: 100, offset: 0 }),
  });

  renderWeek();

  await waitFor(() => {
    expect(screen.getAllByText("Nothing booked.")).toHaveLength(7);
  });
  expect(screen.getAllByText((_, element) => element?.textContent === "16h free of 16h")).toHaveLength(7);
});

it("puts the alert on the day over budget, and only on it", async () => {
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
    expect(screen.getByText("over by 2h")).toBeDefined();
  });
  const wednesday = document.querySelector('[data-day="2026-08-26"]') as HTMLElement;
  expect(wednesday.textContent).toContain("over by 2h");
  expect(screen.getAllByText(/^over by/)).toHaveLength(1);
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
    // the browser's clock decided, both would land on the same day.
    vi.setSystemTime(new Date("2026-08-26T20:00:00Z"));

    routeWeek(SEVEN);
    renderWeek();
    await waitFor(() => {
      expect(markedToday()).toBe("2026-08-26");
    });
    cleanup();

    routeWeek(SEVEN, { ...ME, timezone: "Asia/Tokyo" });
    renderWeek();
    await waitFor(() => {
      expect(markedToday()).toBe("2026-08-27");
    });
  });

  it("names the week it is showing in the page's heading", async () => {
    vi.setSystemTime(new Date("2026-08-26T15:00:00Z"));
    routeWeek(SEVEN);

    renderWeek();

    await waitFor(() => {
      expect(heading()).toBe("24 – 30 Aug 2026");
    });
  });

  it("labels this week, and offers no way back while there is nothing to come back from", async () => {
    vi.setSystemTime(new Date("2026-08-26T15:00:00Z"));
    routeWeek(SEVEN);

    renderWeek();

    await waitFor(() => {
      expect(markedToday()).toBe("2026-08-26");
    });
    expect(backButton()).toBeNull();
    expect(screen.getAllByText("this week").length).toBeGreaterThan(0);
  });

  it("never aims N at a day that has gone", async () => {
    // Wednesday 26 August. Monday has no "+ new task", so the key must not open one there
    // either: the server would refuse whatever was typed into it.
    vi.setSystemTime(new Date("2026-08-26T15:00:00Z"));
    routeWeek(SEVEN);
    renderWeek();
    await waitFor(() => {
      expect(markedToday()).toBe("2026-08-26");
    });
    const header = (day: string): HTMLElement =>
      document.querySelector(`[data-day="${day}"]`)?.firstElementChild as HTMLElement;

    act(() => {
      header("2026-08-24").focus();
    });
    fireEvent.keyDown(window, { key: "n" });
    expect(screen.queryByRole("textbox", { name: "Title" })).toBeNull();

    act(() => {
      header("2026-08-27").focus();
    });
    fireEvent.keyDown(window, { key: "n" });
    expect(screen.getByRole("textbox", { name: "Title" })).toBeDefined();
  });

  it("names the next week and keeps its header while that week loads", async () => {
    // The skeleton used to be the second round's frame, saying "checking session" over this
    // week's dates, and it took the header with it: the › just pressed was gone.
    vi.setSystemTime(new Date("2026-08-26T15:00:00Z"));
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    fetchMock.mockImplementation(async (input) => {
      const [path = "", query = ""] = input.replace("/api/v1", "").split("?");
      if (path === "/auth/refresh") {
        return json(200, { access_token: "a.token", token_type: "bearer", expires_in: 1800 });
      }
      if (path === "/me") return json(200, ME);
      if (path === "/tasks") return json(200, { items: [], limit: 100, offset: 0 });
      if (path === "/capacity") {
        const first = new URLSearchParams(query).get("first_day") ?? "";
        if (first === "2026-08-31") await held;
        return json(200, weekFrom(first, SEVEN));
      }
      throw new Error(`no route for ${path}`);
    });
    renderWeek();
    await waitFor(() => {
      expect(markedToday()).toBe("2026-08-26");
    });
    const next = screen.getByRole("button", { name: "Next week" });
    next.focus();

    fireEvent.click(next);

    await waitFor(() => {
      expect(screen.getByText("Loading 31 Aug – 6 Sep 2026…")).toBeDefined();
    });
    expect(heading()).toBe("31 Aug – 6 Sep 2026");
    expect(screen.getByText("31 Aug")).toBeDefined();
    expect(screen.queryByText("checking session")).toBeNull();
    // The same button, still focused, and the Menu still there: the header never went away.
    expect(document.activeElement).toBe(next);
    expect(screen.getByRole("button", { name: /menu/i })).toBeDefined();

    release();

    await waitFor(() => {
      expect(screen.queryByText(/^Loading/)).toBeNull();
    });
    expect(screen.getAllByText("Nothing booked.")).toHaveLength(7);
  });

  it("walks a week at a time, and back in one press", async () => {
    vi.setSystemTime(new Date("2026-08-26T15:00:00Z"));
    routeWeek(SEVEN);
    renderWeek();
    await waitFor(() => {
      expect(markedToday()).toBe("2026-08-26");
    });

    fireEvent.keyDown(window, { key: "]" });
    await waitFor(() => {
      expect(heading()).toBe("31 Aug – 6 Sep 2026");
    });
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));

    await waitFor(() => {
      expect(heading()).toBe("7 – 13 Sep 2026");
    });
    // Two weeks out, no day is today.
    expect(markedToday()).toBeNull();
    expect(backButton()?.getAttribute("aria-keyshortcuts")).toBe("T");

    fireEvent.keyDown(window, { key: "T" });

    await waitFor(() => {
      expect(markedToday()).toBe("2026-08-26");
    });
    expect(backButton()).toBeNull();
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
      expect(screen.getAllByText(/carried from/)).toHaveLength(2);
    });
    const columns = container.querySelectorAll("[class*=grid] > div");
    const monday = columns[0] as HTMLElement;
    const thursday = columns[3] as HTMLElement;

    expect(monday.textContent).toContain("carried from Sun");
    expect(monday.querySelector("[class*=bandGo]")).toBeNull();

    expect(thursday.textContent).toContain("carried from Wed");
    expect(thursday.querySelector("[class*=bandGo]")).not.toBeNull();
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

  /** The rows: the only cells of the grid that open. */
  function rows(expanded: boolean): HTMLElement[] {
    return screen.queryAllByRole("gridcell", { expanded });
  }

  describe("the grid (ADR-0053)", () => {
    // Wednesday 26 August, 12:00 in São Paulo: two rows on Wednesday, one on Thursday.
    const EARLY = aTask("early", "2026-08-26T14:00:00", "2026-08-26T15:00:00");
    const LATE = aTask("late", "2026-08-26T16:00:00", "2026-08-26T17:00:00");
    const NEXT = aTask("next", "2026-08-27T09:00:00", "2026-08-27T10:00:00");

    async function renderGrid(): Promise<HTMLElement> {
      vi.setSystemTime(new Date("2026-08-26T15:00:00Z"));
      routeWeek(SEVEN, ME, [EARLY, LATE, NEXT]);
      renderWeek();
      await waitFor(() => {
        expect(screen.getByRole("grid")).toBeDefined();
      });
      return screen.getByRole("grid");
    }

    function cell(at: string): HTMLElement {
      return document.querySelector(`[data-cell="${at}"]`) as HTMLElement;
    }

    function press(key: string): void {
      fireEvent.keyDown(document.activeElement as HTMLElement, { key });
    }

    it("is one tab stop for the whole week, on today's header", async () => {
      const grid = await renderGrid();

      const stops = grid.querySelectorAll('[tabindex="0"]');
      expect(stops).toHaveLength(1);
      expect(stops[0]).toBe(cell("2:0"));
      expect(grid.getAttribute("aria-label")).toBe("Week of 24 – 30 Aug 2026");
    });

    it("walks days with left and right and rows with up and down, and the stop follows", async () => {
      const grid = await renderGrid();
      act(() => {
        cell("2:0").focus();
      });

      press("ArrowDown");
      expect(document.activeElement).toBe(document.getElementById("task-early"));
      press("ArrowDown");
      expect(document.activeElement).toBe(document.getElementById("task-late"));
      // Thursday has one row, so the place is kept as far down as Thursday goes: its last
      // cell, the way to a new task.
      press("ArrowRight");
      expect(document.activeElement).toBe(cell("3:2"));
      press("Home");
      expect(document.activeElement).toBe(cell("3:0"));
      press("End");
      expect(document.activeElement?.getAttribute("data-new-task")).toBe("2026-08-27");

      const stops = grid.querySelectorAll('[tabindex="0"]');
      expect(stops).toHaveLength(1);
      expect(stops[0]).toBe(document.activeElement);
    });

    it("stops at the edges of the week", async () => {
      await renderGrid();
      act(() => {
        cell("0:0").focus();
      });

      press("ArrowLeft");
      press("ArrowUp");

      expect(document.activeElement).toBe(cell("0:0"));
    });

    it("puts focus back on the row that Escape closed", async () => {
      await renderGrid();
      const early = document.getElementById("task-early") as HTMLElement;
      act(() => {
        early.focus();
      });
      press("Enter");
      await waitFor(() => {
        expect(early.getAttribute("aria-expanded")).toBe("true");
      });
      act(() => {
        screen.getByRole("button", { name: "edit" }).focus();
      });

      fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });

      await waitFor(() => {
        expect(early.getAttribute("aria-expanded")).toBe("false");
      });
      expect(document.activeElement).toBe(early);
    });
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
      expect(rows(false)).toHaveLength(2);
    });
    const [first, second] = rows(false);

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
      expect(rows(false)).toHaveLength(1);
    });
    fireEvent.click(rows(false)[0] as HTMLElement);
    await waitFor(() => {
      expect(rows(true)).toHaveLength(1);
    });

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(rows(false)).toHaveLength(1);
    });
  });

});

it("has nothing an automated accessibility check can find", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-26T15:00:00Z"));
  const heavy = {
    occupied_minutes: 19 * 60,
    free_minutes: 0,
    unbooked_minutes: 5 * 60,
    task_count: 1,
    over_capacity: true,
    load: "strained" as const,
  };
  routeWeek([{}, {}, {}, heavy, {}, {}, {}], ME, [
    aTask("Thesis", "2026-08-27T09:00:00", "2026-08-27T10:00:00", { tag: { id: "t", name: "faculdade" } }),
  ]);

  const container = renderWeek();
  await waitFor(() => {
    expect(heading()).toBe("24 – 30 Aug 2026");
  });
  vi.useRealTimers();

  await expectNoViolations(container);
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
