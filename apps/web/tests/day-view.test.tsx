/**
 * Tests for the one day on screen below 1100px (ADR-0052, day-phone.dc.html).
 *
 * What they hold the screen to: which layout a width chooses, that the day on screen can be
 * changed three ways and a finger's swipe and always says which day it is, that the week at a
 * glance shows the server's figures or none, that the bar between days never goes under a
 * notice, and that a notice about a task on another day leads to its row. Whether any of it
 * fits the width it was chosen for is measured in a browser, not here.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetClientForTests } from "../src/api/client";
import { setAccessToken } from "../src/api/token";
import type { DayCapacity, Task } from "../src/api/types";
import { SessionProvider } from "../src/auth/session";
import { toLocalDate } from "../src/lib/time";
import { WeekScreen } from "../src/week/WeekScreen";
import { expectNoViolations } from "./a11y";
import { setViewportWidth } from "./viewport";

const PHONE = 375;
const TABLET = 768;

const USABLE = 16 * 60;

const ME = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "gabriel@example.com",
  timezone: "America/Sao_Paulo",
  verified_at: "2026-08-01T12:00:00Z",
};

/** Seven empty days from the Monday asked for, each overridden by its place in `days`. */
function weekFrom(firstDay: string, days: Partial<DayCapacity>[]): DayCapacity[] {
  const [year = 2026, month = 8, date = 24] = firstDay.split("-").map(Number);
  return Array.from({ length: 7 }, (_, index) => ({
    day: toLocalDate(new Date(year, month - 1, date + index)),
    weekday: index + 1,
    total_minutes: 1440,
    usable_minutes: USABLE,
    occupied_minutes: 0,
    free_minutes: USABLE,
    unbooked_minutes: 1440,
    task_count: 0,
    over_capacity: false,
    load: "fine" as const,
    ...days[index],
  }));
}

/** A task in São Paulo, from a local start and end. */
function aTask(id: string, startsAt: string, endsAt: string): Task {
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
  };
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

let fetchMock: ReturnType<typeof vi.fn<FetchLike>>;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface Server {
  days?: Partial<DayCapacity>[];
  tasks?: Task[];
  /** Answer `/capacity` with this instead, to hold a week back or to fail it. */
  capacity?: () => Promise<Response>;
}

/**
 * The routes the week needs, answering whichever window was asked for, and the writes to a
 * task: a create under a new id, a change to its title or start, and a delete.
 */
function serve({ days = [], tasks = [], capacity }: Server = {}): void {
  let held = tasks;
  let created = 0;
  fetchMock.mockImplementation((input, init) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Partial<Task>) : {};
    const [path = "", query = ""] = input.replace("/api/v1", "").split("?");
    if (path === "/auth/refresh") {
      return Promise.resolve(json(200, { access_token: "a.token", token_type: "bearer", expires_in: 1800 }));
    }
    if (path === "/me") return Promise.resolve(json(200, ME));
    if (path === "/tasks" && method === "POST") {
      created += 1;
      const start = body.start_at ?? "";
      const minutes = body.duration_minutes ?? 60;
      const task: Task = {
        ...aTask(`created-${String(created)}`, "2026-08-26T00:00:00", "2026-08-26T01:00:00"),
        title: body.title ?? "",
        start_at: start,
        end_at: new Date(Date.parse(start) + minutes * 60_000).toISOString(),
        duration_minutes: minutes,
      };
      held = [...held, task];
      return Promise.resolve(json(201, task));
    }
    if (path === "/tasks") return Promise.resolve(json(200, { items: held, limit: 100, offset: 0 }));
    const one = /^\/tasks\/([^/]+)$/.exec(path);
    const task = held.find((candidate) => candidate.id === one?.[1]);
    if (task !== undefined && method === "PATCH") {
      const start = body.start_at ?? task.start_at;
      const next: Task = {
        ...task,
        title: body.title ?? task.title,
        start_at: start,
        end_at: new Date(Date.parse(start) + task.duration_minutes * 60_000).toISOString(),
      };
      held = held.map((candidate) => (candidate.id === task.id ? next : candidate));
      return Promise.resolve(json(200, next));
    }
    if (task !== undefined && method === "DELETE") {
      held = held.filter((candidate) => candidate.id !== task.id);
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (path === "/tags") return Promise.resolve(json(200, { items: [], limit: 100, offset: 0 }));
    if (path === "/capacity") {
      if (capacity !== undefined) return capacity();
      const first = new URLSearchParams(query).get("first_day") ?? "";
      return Promise.resolve(json(200, weekFrom(first, days)));
    }
    throw new Error(`no route for ${path}`);
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

/** The local dates of the days drawn in full: seven on a desktop, one below 1100px. */
function daysOnScreen(): (string | null)[] {
  return [...document.querySelectorAll("[data-day]")].map((day) => day.getAttribute("data-day"));
}

async function showing(day: string): Promise<void> {
  await waitFor(() => {
    expect(daysOnScreen()).toEqual([day]);
  });
}

function glance(): HTMLElement {
  return screen.getByRole("list", { name: "Week at a glance" });
}

function bar(): HTMLElement {
  return screen.getByRole("navigation", { name: "Days" });
}

beforeEach(() => {
  resetClientForTests();
  setAccessToken("a.token");
  fetchMock = vi.fn<FetchLike>();
  vi.stubGlobal("fetch", fetchMock);
  // Only Date is faked, so `waitFor` keeps its real timers. Wednesday 26 August 2026, noon in
  // São Paulo: a week with days on both sides of today.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-26T15:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("which layout a width chooses", () => {
  it("keeps the seven columns from 1100px, with no glance and no bar between days", async () => {
    setViewportWidth(1100);
    serve();
    renderWeek();

    await waitFor(() => {
      expect(daysOnScreen()).toHaveLength(7);
    });
    expect(screen.queryByRole("navigation", { name: "Days" })).toBeNull();
    expect(screen.queryByLabelText("Week at a glance")).toBeNull();
  });

  it.each([
    ["a phone", PHONE],
    ["the widest window below the week", 1099],
  ])("puts one day on screen on %s, and it is today", async (_, width) => {
    setViewportWidth(width);
    serve();
    renderWeek();

    await showing("2026-08-26");
    expect(bar()).toBeDefined();
  });

  it("draws the glance as a strip below 640px and as a column beside the day from there", async () => {
    setViewportWidth(639);
    serve();
    renderWeek();
    await showing("2026-08-26");
    // The strip names each cell in a sentence; the column's rows are named by what they show.
    expect(within(glance()).getByRole("button", { name: /^Wednesday 26, today\./ })).toBeDefined();
    expect(screen.queryByRole("complementary")).toBeNull();
    // Part of the header, under the week and over the zone, as a phone draws it.
    expect(glance().closest("header")).toBe(screen.getByRole("banner"));

    act(() => {
      setViewportWidth(640);
    });

    const column = screen.getByRole("complementary", { name: "Week at a glance" });
    expect(within(column).getByRole("button", { name: /^Wed 26 today/ })).toBeDefined();
    expect(column.closest("header")).toBeNull();
  });

  it("moves between one day and seven when the window crosses 1100px", async () => {
    setViewportWidth(TABLET);
    serve();
    renderWeek();
    await showing("2026-08-26");

    act(() => {
      setViewportWidth(1280);
    });
    expect(daysOnScreen()).toHaveLength(7);

    act(() => {
      setViewportWidth(TABLET);
    });
    expect(daysOnScreen()).toEqual(["2026-08-26"]);
  });
});

describe("the week at a glance", () => {
  const BUSY: Partial<DayCapacity>[] = [
    { occupied_minutes: 150, free_minutes: USABLE - 150 },
    {},
    {},
    {},
    { occupied_minutes: 17 * 60, free_minutes: 0, over_capacity: true, load: "heavy" },
  ];

  it("says each day's name, what is booked on it and how heavy it is", async () => {
    setViewportWidth(PHONE);
    serve({ days: BUSY });
    renderWeek();
    await showing("2026-08-26");

    const names = within(glance())
      .getAllByRole("button")
      .map((cell) => cell.getAttribute("aria-label"));
    expect(names).toEqual([
      "Monday 24. 2h30 booked. Fine.",
      "Tuesday 25. 0m booked. Fine.",
      "Wednesday 26, today. 0m booked. Fine.",
      "Thursday 27. 0m booked. Fine.",
      "Friday 28. 17h booked. Heavy.",
      "Saturday 29. 0m booked. Fine.",
      "Sunday 30. 0m booked. Fine.",
    ]);
  });

  it("takes the level from the server rather than working it out from the minutes", async () => {
    // Seventeen hours against a sixteen-hour budget, and the server says fine. A glance with
    // thresholds of its own would call it heavy, and disagree with the API about the same day.
    setViewportWidth(TABLET);
    serve({ days: [{ occupied_minutes: 17 * 60, load: "fine" }, { load: "strained" }] });
    renderWeek();
    await showing("2026-08-26");

    const column = screen.getByRole("complementary", { name: "Week at a glance" });
    expect(within(column).getByRole("button", { name: "Mon 24 17h" })).toBeDefined();
    expect(within(column).getByRole("button", { name: "Tue 25 0m Strained" })).toBeDefined();
  });

  it("draws a longer day longer and a fuller day fuller, on one ruler", async () => {
    setViewportWidth(TABLET);
    serve({
      days: [
        { occupied_minutes: 720 },
        { total_minutes: 1500, occupied_minutes: 1500 },
        { total_minutes: 1380, occupied_minutes: 2000 },
      ],
    });
    renderWeek();
    await showing("2026-08-26");

    const tracks = [...screen.getByRole("complementary").querySelectorAll("button")].map((row) => {
      const track = row.querySelector<HTMLElement>("[aria-hidden='true']");
      return [track?.style.width, (track?.firstElementChild as HTMLElement).style.width];
    });
    // Monday is an ordinary day half booked. Tuesday gained an hour and is full. Wednesday
    // lost one and is booked past its own length: the fill stops at the day's end.
    expect(tracks.slice(0, 3)).toEqual([
      ["96%", "50%"],
      ["100%", "100%"],
      ["92%", "100%"],
    ]);
  });

  it("puts the day that was pressed on screen, and marks it as the one on screen", async () => {
    setViewportWidth(PHONE);
    serve();
    renderWeek();
    await showing("2026-08-26");
    const cells = within(glance()).getAllByRole("button");
    expect(cells.map((cell) => cell.getAttribute("aria-current"))).toEqual([
      null,
      null,
      "true",
      null,
      null,
      null,
      null,
    ]);

    fireEvent.click(cells[4] as HTMLElement);

    await showing("2026-08-28");
    expect(cells[4]?.getAttribute("aria-current")).toBe("true");
    expect(cells[2]?.getAttribute("aria-current")).toBeNull();
    // Today stays marked as today wherever the ring goes.
    expect(cells[2]?.getAttribute("aria-label")).toContain(", today");
  });

  it("shows a dash and no figure while the week is on its way", async () => {
    setViewportWidth(PHONE);
    serve({ capacity: () => new Promise<Response>(() => undefined) });
    renderWeek();

    await waitFor(() => {
      expect(glance().getAttribute("aria-busy")).toBe("true");
    });
    const cells = within(glance()).getAllByRole("button");
    expect(cells).toHaveLength(7);
    for (const cell of cells) {
      expect(cell.getAttribute("aria-label")).toMatch(/\. Loading\.$/);
      expect(cell.textContent).toContain("–");
      expect(cell.textContent).not.toMatch(/\dh|\dm/);
    }
  });

  it("shows no figure at all for a week that could not be read", async () => {
    setViewportWidth(TABLET);
    serve({ capacity: () => Promise.resolve(json(500, { detail: "down" })) });
    renderWeek();

    await waitFor(() => {
      expect(screen.getByText(/Couldn’t reach the server/)).toBeDefined();
    });
    const rows = within(screen.getByRole("complementary")).getAllByRole("button");
    expect(rows).toHaveLength(7);
    for (const row of rows) expect(row.textContent).not.toMatch(/\dh|\dm/);
    // One day drawn without a number, like the seven are on a desktop.
    expect(document.querySelectorAll("[data-day]")).toHaveLength(0);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});

describe("the bar between days", () => {
  it("names the day on either side, in words a screen reader gets whole", async () => {
    setViewportWidth(PHONE);
    serve();
    renderWeek();
    await showing("2026-08-26");

    expect(within(bar()).getByRole("button", { name: "Previous day, Tue 25" })).toBeDefined();
    expect(within(bar()).getByRole("button", { name: "Next day, Thu 27" })).toBeDefined();
    expect(within(bar()).getByRole("button", { name: "+ new task" })).toBeDefined();
  });

  it("steps a day at a time, and keeps its neighbours' names in step", async () => {
    setViewportWidth(PHONE);
    serve();
    renderWeek();
    await showing("2026-08-26");

    fireEvent.click(within(bar()).getByRole("button", { name: /^Next day/ }));
    await showing("2026-08-27");
    expect(within(bar()).getByRole("button", { name: "Previous day, Wed 26" })).toBeDefined();

    fireEvent.click(within(bar()).getByRole("button", { name: /^Previous day/ }));
    fireEvent.click(within(bar()).getByRole("button", { name: /^Previous day/ }));
    await showing("2026-08-25");
  });

  it("steps from Sunday into the next week's Monday, and back into this week's Sunday", async () => {
    setViewportWidth(PHONE);
    serve();
    renderWeek();
    await showing("2026-08-26");
    fireEvent.click(within(glance()).getByRole("button", { name: /^Sunday 30/ }));
    await showing("2026-08-30");
    // The neighbour is named across the week's end, and the month's.
    expect(within(bar()).getByRole("button", { name: "Next day, Mon 31" })).toBeDefined();

    fireEvent.click(within(bar()).getByRole("button", { name: /^Next day/ }));
    await showing("2026-08-31");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("31 Aug – 6 Sep 2026");

    fireEvent.click(within(bar()).getByRole("button", { name: /^Previous day/ }));
    await showing("2026-08-30");
  });

  it("holds the status region above it in one dock, so a notice never covers it", async () => {
    setViewportWidth(PHONE);
    serve();
    renderWeek();
    await showing("2026-08-26");

    const region = bar().previousElementSibling;
    expect(region?.getAttribute("role")).toBe("status");
    expect(region?.getAttribute("aria-live")).toBe("polite");
    // Outside the page's main content, as the region is on a desktop.
    expect(bar().closest("main")).toBeNull();
  });
});

describe("another week, with one day on screen", () => {
  it("opens on the same weekday, this week included, and comes back on today when asked to", async () => {
    setViewportWidth(TABLET);
    serve();
    renderWeek();
    await showing("2026-08-26");
    fireEvent.click(within(screen.getByRole("complementary")).getByRole("button", { name: /^Fri 28/ }));
    await showing("2026-08-28");

    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    await showing("2026-09-04");

    // Through this week, which is one more week on the way and not a request for today.
    fireEvent.keyDown(window, { key: "[" });
    await showing("2026-08-28");
    fireEvent.keyDown(window, { key: "[" });
    await showing("2026-08-21");

    const today = screen.getByRole("button", { name: "Today" });
    expect(today.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(today);
    await showing("2026-08-26");
    expect(today.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(within(screen.getByRole("complementary")).getByRole("button", { name: /^Mon 24/ }));
    await showing("2026-08-24");
    // Today's week, and another day of it: not pressed, since today is not what is on screen.
    expect(today.getAttribute("aria-pressed")).toBe("false");
    fireEvent.keyDown(window, { key: "t" });
    await showing("2026-08-26");
  });

  it("goes to a date in the week on screen without asking the server again", async () => {
    setViewportWidth(PHONE);
    serve();
    renderWeek();
    await showing("2026-08-26");
    const asked = fetchMock.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "go to date" }));
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-08-29" } });
    fireEvent.click(screen.getByRole("button", { name: "go" }));

    await showing("2026-08-29");
    // Focus is on the day that was asked for, which was not on screen when it was asked for.
    await waitFor(() => {
      expect(document.activeElement?.getAttribute("data-cell")).toBe("5:0");
    });
    expect(fetchMock.mock.calls).toHaveLength(asked);
  });
});

describe("a new task from the bar", () => {
  function startDay(): string {
    return screen.getByLabelText<HTMLSelectElement>("Day").value;
  }

  it("opens on the day on screen", async () => {
    setViewportWidth(PHONE);
    serve();
    renderWeek();
    await showing("2026-08-26");
    fireEvent.click(within(glance()).getByRole("button", { name: /^Friday 28/ }));
    await showing("2026-08-28");

    fireEvent.click(within(bar()).getByRole("button", { name: "+ new task" }));

    const dialog = screen.getByRole("dialog", { name: "New task" });
    expect(startDay()).toBe("2026-08-28");
    // A full sheet, its save on the bar above the form rather than inside it.
    expect(within(dialog).getByRole("button", { name: "save" }).closest("form")).toBeNull();
  });

  it("opens on today from a day that has gone, and leaves that day on screen", async () => {
    setViewportWidth(PHONE);
    serve();
    renderWeek();
    await showing("2026-08-26");
    fireEvent.click(within(glance()).getByRole("button", { name: /^Monday 24/ }));
    await showing("2026-08-24");

    fireEvent.click(within(bar()).getByRole("button", { name: "+ new task" }));

    expect(startDay()).toBe("2026-08-26");
    expect(daysOnScreen()).toEqual(["2026-08-24"]);
  });

  it("comes back to this week from one that has gone, since none of its days can take a task", async () => {
    setViewportWidth(PHONE);
    serve();
    renderWeek();
    await showing("2026-08-26");
    fireEvent.click(screen.getByRole("button", { name: "Previous week" }));
    await showing("2026-08-19");

    fireEvent.keyDown(window, { key: "n" });

    await showing("2026-08-26");
    await waitFor(() => {
      expect(startDay()).toBe("2026-08-26");
    });
  });
});

describe("the keyboard below 1100px (ADR-0056)", () => {
  function legend(): string {
    return screen.getByRole("region", { name: "Keyboard shortcuts" }).textContent;
  }

  it("is a list, not a grid, and the legend leaves out the keys that walk a grid", async () => {
    setViewportWidth(TABLET);
    serve();
    renderWeek();
    await showing("2026-08-26");

    expect(screen.queryByRole("grid")).toBeNull();
    expect(screen.getByRole("list", { name: "Tasks on Wednesday 26 Aug" })).toBeDefined();
    expect(legend()).not.toContain("move between days and rows");
    expect(legend()).not.toContain("first or last in a day");
    expect(legend()).toContain("open or close a row");
    expect(legend()).toContain("new task on the focused day");

    act(() => {
      setViewportWidth(1280);
    });
    expect(screen.getByRole("grid")).toBeDefined();
    expect(legend()).toContain("move between days and rows");
  });

  it("puts focus back on a row's button when Esc closes it", async () => {
    setViewportWidth(PHONE);
    serve({ tasks: [aTask("Read", "2026-08-26T14:00:00", "2026-08-26T15:00:00")] });
    renderWeek();
    await showing("2026-08-26");
    const button = await screen.findByRole("button", { name: /Read/ });

    fireEvent.click(button);
    const edit = await screen.findByRole("button", { name: /^edit/ });
    edit.focus();
    fireEvent.keyDown(edit, { key: "Escape" });

    await waitFor(() => {
      expect(button.getAttribute("aria-expanded")).toBe("false");
    });
    expect(document.activeElement).toBe(button);
  });
});

describe("edit below 1100px", () => {
  it("closes the sheet and not the row on Esc, and keeps the week's keys out of it", async () => {
    setViewportWidth(PHONE);
    serve({ tasks: [aTask("Read", "2026-08-26T14:00:00", "2026-08-26T15:00:00")] });
    renderWeek();
    await showing("2026-08-26");
    const row = await screen.findByRole("button", { name: /Read/ });
    fireEvent.click(row);
    const edit = await screen.findByRole("button", { name: /^edit/ });
    edit.focus();
    fireEvent.click(edit);
    const sheet = await screen.findByRole("dialog", { name: "Edit task" });

    // The week's own keys would act on a screen the sheet is covering.
    fireEvent.keyDown(within(sheet).getByRole("button", { name: "cancel" }), { key: "]" });
    expect(daysOnScreen()).toEqual(["2026-08-26"]);

    fireEvent.keyDown(within(sheet).getByLabelText("Start day"), { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Edit task" })).toBeNull();
    });
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /^edit/ }));
  });
});

describe("a task the night before is still running", () => {
  it("follows the band to the day that owns the task, with its row open and focused", async () => {
    setViewportWidth(PHONE);
    serve({ tasks: [aTask("Night shift", "2026-08-25T22:00:00", "2026-08-26T02:00:00")] });
    renderWeek();
    await showing("2026-08-26");
    // The owner's row is on Tuesday, which is not on screen.
    expect(document.getElementById("task-Night shift")).toBeNull();

    fireEvent.click(screen.getByText("go to Tue"));

    await showing("2026-08-25");
    const row = document.getElementById("task-Night shift");
    expect(row?.getAttribute("aria-expanded")).toBe("true");
    await waitFor(() => {
      expect(document.activeElement).toBe(row);
    });
  });
});

describe("the automated accessibility check", () => {
  it.each([
    ["under the strip", PHONE],
    ["beside the column", TABLET],
  ])("passes one day %s", async (_, width) => {
    setViewportWidth(width);
    serve({
      days: [{}, {}, { occupied_minutes: 17 * 60, free_minutes: 0, over_capacity: true, load: "heavy", task_count: 1 }],
      tasks: [aTask("Read", "2026-08-26T14:00:00", "2026-08-26T15:00:00")],
    });
    const container = renderWeek();
    await showing("2026-08-26");

    await expectNoViolations(container);
  });
});

describe("a notice about a task on another day, below 1100px", () => {
  const READ = (): Task => aTask("Read", "2026-08-26T14:00:00", "2026-08-26T15:00:00");
  // A notice's own, not the header's "go to date".
  const GO_TO_A_DAY = /^go to (Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/;

  /**
   * Hold back the week's next read of its tasks until released, so a notice can be pressed
   * before the week it speaks of has arrived.
   */
  function holdTheReload(): () => void {
    const answer = fetchMock.getMockImplementation() as FetchLike;
    let release = (): void => undefined;
    let holding = true;
    fetchMock.mockImplementation((input, init) => {
      if (!holding || !input.includes("/tasks?")) return answer(input, init);
      holding = false;
      return new Promise((resolve) => {
        release = () => {
          resolve(answer(input, init));
        };
      });
    });
    return () => {
      act(() => {
        release();
      });
    };
  }

  /** The row is a button in the list, and a cell of the grid from 1100px. */
  async function moveReadTo(weekday: RegExp, row: "button" | "gridcell" = "button"): Promise<void> {
    fireEvent.click(await screen.findByRole(row, { name: /Read/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^move/ }));
    const panel = screen.getByRole("group", { name: "Move to another day" });
    fireEvent.click(within(panel).getByRole("button", { name: weekday }));
  }

  it("leads to the day a task was moved to, which comes on with its row open and focused", async () => {
    setViewportWidth(PHONE);
    serve({ tasks: [READ()] });
    renderWeek();
    await showing("2026-08-26");
    await moveReadTo(/^Fri,/);

    await screen.findByText("Moved “Read” to Fri 28, 14:00.");
    fireEvent.click(screen.getByRole("button", { name: "go to Fri" }));

    await showing("2026-08-28");
    const row = await screen.findByRole("button", { name: /Read/ });
    await waitFor(() => {
      expect(document.activeElement).toBe(row);
    });
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByText("Moved “Read” to Fri 28, 14:00.")).toBeNull();
  });

  it("waits for a moved task to arrive on its new day before focusing it", async () => {
    setViewportWidth(PHONE);
    serve({ tasks: [READ()] });
    renderWeek();
    await showing("2026-08-26");
    const release = holdTheReload();
    await moveReadTo(/^Fri,/);

    // Still saving: the week that has it on Friday is on its way.
    await screen.findByText("Moved “Read” to Fri 28, 14:00.");
    fireEvent.click(screen.getByRole("button", { name: "go to Fri" }));
    await showing("2026-08-28");
    release();

    await waitFor(() => {
      expect(document.activeElement?.id).toBe("task-Read");
    });
  });

  it("says in the sheet's words where an edit moved the start, and leads there", async () => {
    setViewportWidth(PHONE);
    serve({ tasks: [READ()] });
    renderWeek();
    await showing("2026-08-26");
    fireEvent.click(await screen.findByRole("button", { name: /Read/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^edit/ }));
    const sheet = await screen.findByRole("dialog", { name: "Edit task" });
    fireEvent.change(within(sheet).getByLabelText("Start day"), { target: { value: "2026-08-27" } });

    fireEvent.click(within(sheet).getByRole("button", { name: "save" }));

    await screen.findByText("“Read” now starts Thu 27, 14:00.");
    expect(screen.getByRole("button", { name: "go to Thu" })).toBeDefined();
  });

  it("leads back to the day a task was brought back to, from the day on screen now", async () => {
    setViewportWidth(PHONE);
    serve({ tasks: [aTask("Read", "2026-08-27T09:00:00", "2026-08-27T10:00:00")] });
    renderWeek();
    await showing("2026-08-26");
    fireEvent.click(within(glance()).getByRole("button", { name: /^Thursday 27/ }));
    await showing("2026-08-27");
    fireEvent.click(await screen.findByRole("button", { name: /Read/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^delete/ }));
    await screen.findByText("Deleted “Read” from Thu 27.");
    fireEvent.click(within(glance()).getByRole("button", { name: /^Wednesday 26/ }));
    await showing("2026-08-26");

    const release = holdTheReload();
    fireEvent.click(screen.getByRole("button", { name: "undo" }));

    // Pressed before the week holding the task it brought back has arrived.
    await screen.findByText("Restored “Read” on Thu 27.");
    fireEvent.click(screen.getByRole("button", { name: "go to Thu" }));
    await showing("2026-08-27");
    release();

    await waitFor(() => {
      expect(document.activeElement?.id).toBe("task-created-1");
    });
  });

  it("offers nothing to go to for a task added to the day on screen", async () => {
    setViewportWidth(PHONE);
    serve();
    renderWeek();
    await showing("2026-08-26");
    fireEvent.click(within(bar()).getByRole("button", { name: "+ new task" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Ler" } });

    fireEvent.click(screen.getByRole("button", { name: "save" }));

    await screen.findByText(/^Added “Ler” to Wed 26/);
    expect(screen.queryByRole("button", { name: GO_TO_A_DAY })).toBeNull();
  });

  it("offers nothing to go to from 1100px, where every day is in view", async () => {
    serve({ tasks: [READ()] });
    renderWeek();
    await moveReadTo(/^Fri,/, "gridcell");

    await screen.findByText("Moved “Read” to Fri 28, 14:00.");
    expect(screen.queryByRole("button", { name: GO_TO_A_DAY })).toBeNull();
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
  });

  it("is taken away by its ✕, with focus that was on it put on the day", async () => {
    setViewportWidth(PHONE);
    serve({ tasks: [READ()] });
    const container = renderWeek();
    await showing("2026-08-26");
    await moveReadTo(/^Fri,/);
    await screen.findByText("Moved “Read” to Fri 28, 14:00.");
    await expectNoViolations(container);
    const dismiss = screen.getByRole("button", { name: "Dismiss" });
    act(() => {
      dismiss.focus();
    });

    fireEvent.click(dismiss);

    expect(screen.queryByText("Moved “Read” to Fri 28, 14:00.")).toBeNull();
    expect(document.activeElement?.getAttribute("data-cell")).toBe("2:0");
  });
});

describe("swiping the day, below 1100px", () => {
  function swipe(from: [number, number], to: [number, number], pointerType = "touch", on?: Element): void {
    const target = on ?? (document.querySelector("[data-day]") as Element);
    fireEvent.pointerDown(target, { pointerType, clientX: from[0], clientY: from[1] });
    fireEvent.pointerUp(target, { pointerType, clientX: to[0], clientY: to[1] });
  }

  function slide(): string | null | undefined {
    return document.querySelector("[data-slide]")?.getAttribute("data-slide");
  }

  it("steps a day each way with a finger, and slides the day in from the side it came from", async () => {
    setViewportWidth(PHONE);
    serve();
    renderWeek();
    await showing("2026-08-26");

    swipe([300, 400], [200, 410]);
    await showing("2026-08-27");
    expect(slide()).toBe("1");

    swipe([100, 400], [200, 400]);
    await showing("2026-08-26");
    expect(slide()).toBe("-1");
  });

  it("leaves the day alone for a mouse, a short move, a scroll and a sheet over the day", async () => {
    setViewportWidth(PHONE);
    serve();
    renderWeek();
    await showing("2026-08-26");

    swipe([300, 400], [100, 400], "mouse");
    swipe([300, 400], [250, 400]);
    // Further across than down, but not twice as far: a scroll that drifted.
    swipe([300, 400], [200, 460]);
    fireEvent.click(within(bar()).getByRole("button", { name: "+ new task" }));
    const sheet = screen.getByRole("dialog", { name: "New task" });
    swipe([300, 400], [100, 400], "touch", within(sheet).getByLabelText("Title"));

    expect(daysOnScreen()).toEqual(["2026-08-26"]);
    expect(slide()).toBe("0");
  });
});
