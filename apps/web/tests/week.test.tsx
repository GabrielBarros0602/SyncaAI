/**
 * Tests for the week screen.
 *
 * Three claims earn their place here, and they are the three the design was built around:
 * a day is not always 1440 minutes and the geometry has to say so; a day can be booked past
 * its own length and must report that without a negative number; and the overlap rule
 * belongs to the database, so its refusal has to arrive from the server rather than from a
 * check this client is not in a position to make.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { resetClientForTests } from "../src/api/client";
import { setAccessToken } from "../src/api/token";
import type { DayCapacity, Task } from "../src/api/types";
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

function renderDay(
  capacity: DayCapacity,
  tasks: Task[] = [],
  lighter: DayCapacity | null = null,
): HTMLElement {
  const { container } = render(
    <DayColumn
      capacity={capacity}
      lighter={lighter}
      tasks={tasks}
      index={0}
      weekday="Mon"
      date="Aug 24"
      timezone={SAO_PAULO}
      formOpen={false}
      submitting={false}
      serverError={null}
      {...NOOP}
    />,
  );
  return container;
}

function trackWidth(container: HTMLElement): string {
  return (container.querySelector("[data-track]") as HTMLElement).style.width;
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

  expect(container.textContent).toContain("0m");
  expect(container.textContent).not.toContain("-");
  expect(screen.getByText("over by 2h")).toBeDefined();
});

it("a full day is measured against sixteen hours, not twenty-four", () => {
  // The complaint that started ADR-0022: "why is it only full at 24 hours — doesn't he
  // sleep?"
  const container = renderDay(booked(0));

  expect(container.textContent).toContain("16h");
  expect(container.textContent).not.toContain("24h");
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
  renderDay(booked(19 * 60), [], aDay({ weekday: 2, free_minutes: 9 * 60 }));

  expect(screen.getByText(/This day is heavier than the rest of your week/)).toBeDefined();
  expect(screen.getByText("Tue has 9h free.")).toBeDefined();
});

it("a day whose tasks failed to arrive does not claim to be empty", () => {
  // The capacity is the authority on how many tasks a day holds. Gating the empty message
  // on the list would turn a failed fetch into a confident lie.
  const container = renderDay(aDay({ task_count: 3 }), []);

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

function renderWeek(): void {
  render(
    <SessionProvider>
      <WeekScreen />
    </SessionProvider>,
  );
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
    expect(screen.getByText("1 day over capacity")).toBeDefined();
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
