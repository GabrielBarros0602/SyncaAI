/**
 * Tests for the one day below 1100px, drawn as a list (ADR-0056, day-phone.dc.html).
 *
 * What they hold it to: the day's head says what the drawing says in the week's words, the
 * trail puts each task where it falls on the same ruler as the glance, each task is two
 * controls a Tab reaches and nothing is a grid, the verbs' letters still reach a verb, and the
 * band from the night before leads back to its owner. Where it all sits is measured in a
 * browser.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DayCapacity, Task } from "../src/api/types";
import { type Carried, carriedInto } from "../src/week/carried";
import { DayList } from "../src/week/DayList";
import type { Panel } from "../src/week/RowPanels";
import { expectNoViolations } from "./a11y";

const SAO_PAULO = "America/Sao_Paulo";
const USABLE = 16 * 60;

function aDay(overrides: Partial<DayCapacity> = {}): DayCapacity {
  return {
    day: "2026-08-26",
    weekday: 3,
    total_minutes: 1440,
    usable_minutes: USABLE,
    occupied_minutes: 180,
    free_minutes: USABLE - 180,
    unbooked_minutes: 1440 - 180,
    task_count: 2,
    over_capacity: false,
    load: "fine",
    ...overrides,
  };
}

/** A task in São Paulo, from a local start and end. */
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

interface When {
  capacity?: DayCapacity;
  tasks?: Task[];
  allTasks?: Task[];
  carried?: Carried[];
  onGoToOwner?: ((taskId: string) => void) | null;
  openTask?: { id: string; panel: Panel } | null;
  onOpenTask?: (open: { id: string; panel: Panel } | null) => void;
  onToggle?: (task: Task) => Promise<void>;
  today?: boolean;
}

function renderDay(when: When = {}): HTMLElement {
  const capacity = when.capacity ?? aDay();
  const tasks = when.tasks ?? [];
  const { container } = render(
    <DayList
      capacity={capacity}
      tasks={tasks}
      week={[capacity]}
      allTasks={when.allTasks ?? tasks}
      carried={when.carried ?? []}
      onGoToOwner={when.onGoToOwner === undefined ? () => undefined : when.onGoToOwner}
      openTask={when.openTask ?? null}
      saving={new Set()}
      onOpenTask={when.onOpenTask ?? (() => undefined)}
      onSaveTask={() => Promise.resolve()}
      onDeleteTask={() => Promise.resolve()}
      index={2}
      date="26 Aug"
      today={when.today ?? false}
      timezone={SAO_PAULO}
      onToggle={when.onToggle ?? (() => Promise.resolve())}
      onChecklist={() => Promise.resolve()}
    />,
  );
  return container;
}

const READ = aTask("Read", "2026-08-26T09:00:00", "2026-08-26T10:30:00");
const SHIFT = aTask("Shift", "2026-08-26T14:00:00", "2026-08-26T15:30:00");

beforeEach(() => {
  // Wednesday 26 August, noon in São Paulo.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-26T15:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the day's head", () => {
  it("names the day, says today, and counts its tasks", () => {
    renderDay({ tasks: [READ, SHIFT], today: true });

    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Wednesday 26 Aug");
    expect(screen.getByText("today")).toBeDefined();
    expect(screen.getByText("2 tasks")).toBeDefined();
  });

  it("counts one task in the singular, and says nothing of today on another day", () => {
    renderDay({ tasks: [READ] });

    expect(screen.getByText("1 task")).toBeDefined();
    expect(screen.queryByText("today")).toBeNull();
  });

  it("puts what is booked large, and what is free under it with its denominator", () => {
    renderDay({ tasks: [READ, SHIFT] });

    expect(screen.getByText("3h").nextElementSibling?.textContent).toBe("booked");
    expect(screen.getByText("13h free of 16h")).toBeDefined();
  });

  it("says the load sentence from the server's ladder, and nothing on an ordinary day", () => {
    renderDay({ capacity: aDay({ occupied_minutes: 17 * 60, free_minutes: 0, over_capacity: true, load: "heavy" }) });
    expect(screen.getByText("No margin for anything running late.")).toBeDefined();
  });
});

describe("the trail", () => {
  function trail(): HTMLElement {
    return screen.getByRole("img");
  }

  function segments(): string[][] {
    return [...trail().querySelectorAll<HTMLElement>("span")]
      .filter((span) => span.parentElement !== trail())
      .map((span) => [span.style.left, span.style.width]);
  }

  it("says how much is booked of how long a day", () => {
    renderDay({ capacity: aDay({ total_minutes: 1500 }) });

    expect(trail().getAttribute("aria-label")).toBe("3h booked of a 25h day");
  });

  it("is drawn on the glance's ruler, so a day that gained an hour is longer", () => {
    renderDay({ capacity: aDay({ total_minutes: 1500 }) });
    expect(trail().style.width).toBe("100%");
  });

  it("puts each task where it falls, clipped at the day's edges", () => {
    // From the night before into 03:00, and from 22:00 into the next morning.
    const night = aTask("Night", "2026-08-25T23:00:00", "2026-08-26T03:00:00");
    const late = aTask("Late", "2026-08-26T22:00:00", "2026-08-27T02:00:00");
    renderDay({ tasks: [late], allTasks: [night, READ, late] });

    expect(segments()).toEqual([
      ["0%", "12.5%"],
      ["37.5%", "6.25%"],
      ["91.66666666666666%", "8.333333333333332%"],
    ]);
  });

  it("marks now on today only", () => {
    renderDay({ today: true });
    // Noon, half the day gone.
    expect([...trail().children].at(-1)?.getAttribute("style")).toContain("left: 50%");
    expect(trail().children).toHaveLength(2);
  });

  it("draws no mark for now on another day", () => {
    renderDay();
    expect(trail().children).toHaveLength(1);
  });
});

describe("a row in the list", () => {
  it("is two controls, a box and a button that opens it, and nothing of a grid", () => {
    const container = renderDay({ tasks: [READ] });

    const row = within(screen.getByRole("list", { name: "Tasks on Wednesday 26 Aug" })).getAllByRole("listitem")[0] as HTMLElement;
    expect(within(row).getByRole("checkbox", { name: "Complete Read" })).toBeDefined();
    const open = within(row).getByRole("button", { name: /Read/ });
    expect(open.getAttribute("aria-expanded")).toBe("false");
    expect(open.id).toBe("task-Read");
    expect(container.querySelector('[role="grid"], [role="gridcell"], [tabindex="-1"]:not(h2)')).toBeNull();
  });

  it("writes its time and length as the week does", () => {
    renderDay({ tasks: [READ] });
    expect(screen.getByText(/^09:00 –/).textContent).toBe("09:00 – 10:30 · 1h30");
  });

  it("opens from its button, and completes from its box without opening", () => {
    const onOpenTask = vi.fn<(open: { id: string; panel: Panel } | null) => void>();
    const onToggle = vi.fn<(task: Task) => Promise<void>>(() => Promise.resolve());
    renderDay({ tasks: [READ], onOpenTask, onToggle });

    fireEvent.click(screen.getByRole("checkbox", { name: "Complete Read" }));
    expect(onToggle).toHaveBeenCalledWith(READ);
    expect(onOpenTask).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Read/ }));
    expect(onOpenTask).toHaveBeenCalledWith({ id: "Read", panel: "open" });
  });

  it("reaches a verb with its letter from the button, without opening first", () => {
    const onOpenTask = vi.fn<(open: { id: string; panel: Panel } | null) => void>();
    renderDay({ tasks: [READ], onOpenTask });
    const button = screen.getByRole("button", { name: /Read/ });

    expect(button.getAttribute("aria-keyshortcuts")).toBe("E M O C Delete");
    fireEvent.keyDown(button, { key: "m" });

    expect(onOpenTask).toHaveBeenCalledWith({ id: "Read", panel: "move" });
  });

  it("offers no move to a finished task, by key or by name", () => {
    const done = { ...READ, completed_at: "2026-08-26T13:00:00Z" };
    const onOpenTask = vi.fn<(open: { id: string; panel: Panel } | null) => void>();
    renderDay({ tasks: [done], onOpenTask });
    const button = screen.getByRole("button", { name: /Read/ });

    expect(button.getAttribute("aria-keyshortcuts")).toBe("E O C Delete");
    fireEvent.keyDown(button, { key: "m" });
    expect(onOpenTask).not.toHaveBeenCalled();
  });

  it("shows the verbs and the note once open", () => {
    renderDay({ tasks: [{ ...READ, notes: "Chapter 3" }], openTask: { id: "Read", panel: "open" } });

    expect(screen.getByRole("button", { name: /Read/ }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("toolbar", { name: "Actions for Read" })).toBeDefined();
    expect(screen.getByText("Chapter 3")).toBeDefined();
  });

  it("says how a late finish went, on a line that can wrap", () => {
    // Started Monday 20:00, planned 2h30, ticked on Wednesday at 22:22.
    const late = aTask("Essay", "2026-08-24T20:00:00", "2026-08-24T22:30:00", {
      completed_at: new Date("2026-08-26T22:22:00-03:00").toISOString(),
    });
    renderDay({ capacity: aDay({ day: "2026-08-24", weekday: 1 }), tasks: [late] });

    expect(screen.getByText("done Wed 22:22 · 50h22 of 2h30 · +47h52")).toBeDefined();
  });

  it("says how long a task under way has run", () => {
    renderDay({ tasks: [aTask("Shift", "2026-08-26T10:50:00", "2026-08-26T13:50:00")] });

    expect(screen.getByText("1h10 of 3h so far")).toBeDefined();
  });
});

describe("the band from the night before", () => {
  const NIGHT = aTask("Night shift", "2026-08-25T22:00:00", "2026-08-26T02:00:00");
  const carried = (): Carried[] => [...carriedInto([NIGHT], SAO_PAULO).values()].flat();

  it("is an item of the list with a button back to the task that owns it", () => {
    const onGoToOwner = vi.fn<(taskId: string) => void>();
    renderDay({ carried: carried(), onGoToOwner, allTasks: [NIGHT] });

    const band = screen.getAllByRole("listitem")[0] as HTMLElement;
    expect(band.textContent).toContain("carried from Tue");
    expect(band.textContent).toContain("2h here");
    fireEvent.click(within(band).getByRole("button", { name: "go to Tue" }));

    expect(onGoToOwner).toHaveBeenCalledWith("Night shift");
  });

  it("offers no way back on a Monday, whose night before is not on screen", () => {
    renderDay({ carried: carried(), onGoToOwner: null });
    expect(screen.queryByRole("button", { name: /go to/ })).toBeNull();
  });

  it("keeps the day from reading empty", () => {
    renderDay({ carried: carried() });
    expect(screen.queryByText("Nothing booked.")).toBeNull();
  });
});

it("says an empty day is empty", () => {
  renderDay({ capacity: aDay({ occupied_minutes: 0, free_minutes: USABLE, task_count: 0 }) });
  expect(screen.getByText("Nothing booked.")).toBeDefined();
});

it("passes the automated accessibility check, a row open and a band in it", async () => {
  const night = aTask("Night shift", "2026-08-25T22:00:00", "2026-08-26T02:00:00");
  const container = renderDay({
    tasks: [READ, SHIFT],
    allTasks: [night, READ, SHIFT],
    carried: [...carriedInto([night], SAO_PAULO).values()].flat(),
    openTask: { id: "Read", panel: "open" },
    today: true,
  });

  await expectNoViolations(container);
});

describe("an opened row, as the phone draws it", () => {
  const ITEMS = [
    { id: "i1", label: "Outline", position: 0, completed_at: null },
    { id: "i2", label: "Sources", position: 1, completed_at: null },
  ];

  function toolbar(): HTMLElement {
    return screen.getByRole("toolbar", { name: "Actions for Read" });
  }

  function verbs(): string[] {
    return within(toolbar())
      .getAllByRole("button")
      .map((button) => button.textContent.replace(/[A-Z⌫]$/, ""));
  }

  it("shows the checklist on the row itself, before the verbs, and no verb or esc for it", () => {
    renderDay({ tasks: [{ ...READ, items: ITEMS }], openTask: { id: "Read", panel: "open" } });

    const list = screen.getByRole("group", { name: "Checklist" });
    expect(within(list).getByRole("checkbox", { name: "Tick Outline" })).toBeDefined();
    expect(verbs()).toEqual(["edit", "move", "note", "delete"]);
    expect(within(toolbar()).queryByRole("button", { name: "Close" })).toBeNull();
    // The verbs come after what they act on.
    expect(list.compareDocumentPosition(toolbar()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("offers the checklist verb on a task with none, and starts one in place", () => {
    const onOpenTask = vi.fn<(open: { id: string; panel: Panel } | null) => void>();
    renderDay({ tasks: [READ], openTask: { id: "Read", panel: "open" }, onOpenTask });
    expect(screen.queryByRole("group", { name: "Checklist" })).toBeNull();
    expect(verbs()).toEqual(["edit", "move", "note", "checklist", "delete"]);

    fireEvent.click(within(toolbar()).getByRole("button", { name: /^checklist/ }));
    expect(onOpenTask).toHaveBeenCalledWith({ id: "Read", panel: "list" });
  });

  it("shows an empty checklist to add to once the verb is pressed", () => {
    renderDay({ tasks: [READ], openTask: { id: "Read", panel: "list" } });

    expect(screen.getByRole("group", { name: "Checklist" })).toBeDefined();
    expect(screen.getByLabelText("Add an item")).toBeDefined();
    expect(within(toolbar()).getByRole("button", { name: /^checklist/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it.each(["move", "delete", "note"] as const)(
    "passes the automated accessibility check with the %s panel open",
    async (panel) => {
      const started = aTask("Read", "2026-08-26T09:00:00", "2026-08-26T10:30:00");
      const container = renderDay({
        tasks: [{ ...started, items: ITEMS }],
        openTask: { id: "Read", panel },
      });
      await expectNoViolations(container);
    },
  );
});
