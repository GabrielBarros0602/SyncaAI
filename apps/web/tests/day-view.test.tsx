/**
 * Tests for the one day on screen below 1100px (ADR-0052, day-phone.dc.html).
 *
 * What they hold the screen to: which layout a width chooses, that the day on screen can be
 * changed three ways and always says which day it is, that the week at a glance shows the
 * server's figures or none, and that the bar between days never goes under a notice. Whether
 * any of it fits the width it was chosen for is measured in a browser, not here.
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

/** The routes the week needs, answering whichever window was asked for. */
function serve({ days = [], tasks = [], capacity }: Server = {}): void {
  fetchMock.mockImplementation((input) => {
    const [path = "", query = ""] = input.replace("/api/v1", "").split("?");
    if (path === "/auth/refresh") {
      return Promise.resolve(json(200, { access_token: "a.token", token_type: "bearer", expires_in: 1800 }));
    }
    if (path === "/me") return Promise.resolve(json(200, ME));
    if (path === "/tasks") return Promise.resolve(json(200, { items: tasks, limit: 100, offset: 0 }));
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

    act(() => {
      setViewportWidth(640);
    });

    const column = screen.getByRole("complementary", { name: "Week at a glance" });
    expect(within(column).getByRole("button", { name: /^Wed 26 Today/ })).toBeDefined();
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
      "Monday 24. 2h30 reserved. Fine.",
      "Tuesday 25. 0m reserved. Fine.",
      "Wednesday 26, today. 0m reserved. Fine.",
      "Thursday 27. 0m reserved. Fine.",
      "Friday 28. 17h reserved. Heavy.",
      "Saturday 29. 0m reserved. Fine.",
      "Sunday 30. 0m reserved. Fine.",
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
    expect(within(bar()).getByRole("button", { name: "+ New task" })).toBeDefined();
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

    fireEvent.click(screen.getByRole("button", { name: /back to this week/ }));
    await showing("2026-08-26");

    fireEvent.click(within(screen.getByRole("complementary")).getByRole("button", { name: /^Mon 24/ }));
    await showing("2026-08-24");
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

    fireEvent.click(within(bar()).getByRole("button", { name: "+ New task" }));

    expect(screen.getByRole("dialog", { name: "New task" })).toBeDefined();
    expect(startDay()).toBe("2026-08-28");
  });

  it("opens on today from a day that has gone, and leaves that day on screen", async () => {
    setViewportWidth(PHONE);
    serve();
    renderWeek();
    await showing("2026-08-26");
    fireEvent.click(within(glance()).getByRole("button", { name: /^Monday 24/ }));
    await showing("2026-08-24");

    fireEvent.click(within(bar()).getByRole("button", { name: "+ New task" }));

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
