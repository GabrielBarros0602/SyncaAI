/**
 * Tests for the Plan button and the plan screen (plan.dc.html): asking, waiting and reviewing.
 *
 * What earns a test here is what the server decides and the screen must not guess: which
 * request is being made, which plan is waiting and whether a failure is still the news come
 * from the server after a reload; a request is read on the decided pace and not while the tab
 * is hidden; a refusal says when to ask again; a change to a step sends only what moved and
 * shows the server's refusal where it applies; a removed step is offered back and the server
 * hears of it only when the offer ends or before the plan is approved; a plan written by hand is
 * nothing on the server until its first step, and is named then; a commit retried after a lost
 * answer sends the same key, every step a commit is refused for is shown at once, and a plan
 * read again after a refusal may turn out to be closed. Approved, the plan the button counts is
 * the newest with tasks still open, its page counts what exists now, and a task leads back to
 * the plan it came from, not to whichever the button counts.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetClientForTests } from "../src/api/client";
import { setAccessToken } from "../src/api/token";
import type { DayCapacity, Job, Plan, PlanItem, Task } from "../src/api/types";
import { SessionProvider } from "../src/auth/session";
import { daysFrom, mondayOf, toLocalDate, todayIn } from "../src/lib/time";
import { shortDay } from "../src/plan/steps";
import { RouteFocus } from "../src/ui/RouteFocus";
import { WeekScreen } from "../src/week/WeekScreen";
import { expectNoViolations } from "./a11y";
import { setViewportWidth } from "./viewport";

const ME = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "design-check@example.com",
  timezone: "UTC",
  verified_at: "2026-08-01T12:00:00Z",
  days_off: [6, 7],
  preferred_block_minutes: 60,
};

const WEEK = daysFrom(mondayOf(todayIn("UTC"))).map(toLocalDate);
const THURSDAY = WEEK[3] as string;

function aDay(day: string, weekday: number): DayCapacity {
  return {
    day,
    weekday,
    total_minutes: 1440,
    usable_minutes: 960,
    occupied_minutes: 0,
    free_minutes: 960,
    unbooked_minutes: 1440,
    task_count: 0,
    over_capacity: false,
    load: "fine",
  };
}

function daysFromDate(first: string, count: number): DayCapacity[] {
  const [year = 2026, month = 1, date = 1] = first.split("-").map(Number);
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(year, month - 1, date + index);
    return aDay(toLocalDate(day), ((day.getDay() + 6) % 7) + 1);
  });
}

function aStep(id: string, over: Partial<PlanItem> = {}): PlanItem {
  return {
    id,
    position: 0,
    title: id,
    description: "",
    minutes: 30,
    start_at: null,
    state: "no_room",
    reason: null,
    prerequisites: [],
    links: [],
    ...over,
  };
}

const REQUEST = "Study for Wednesday's calculus exam";

function aJob(over: Partial<Job> = {}): Job {
  return {
    job_id: "j1",
    status: "queued",
    failure_reason: null,
    plan_id: null,
    request: REQUEST,
    horizon_days: 14,
    created_at: "2026-10-22T13:20:00Z",
    ...over,
  };
}

function page<T>(items: T[]): { items: T[]; limit: number; offset: number } {
  return { items, limit: 1, offset: 0 };
}

function aPlan(over: Partial<Plan> = {}): Plan {
  return {
    id: "p1",
    job_id: "j1",
    created_at: `${THURSDAY}T08:00:00Z`,
    status: "pending",
    request: REQUEST,
    first_day: WEEK[0] as string,
    last_day: WEEK[6] as string,
    week_ends_on: WEEK[6] as string,
    items: [
      aStep("limits", {
        title: "Limits: the theory",
        start_at: `${THURSDAY}T10:00:00Z`,
        state: "placed",
        links: [{ label: "Lecture notes", url: "https://moodle.example.edu/limits" }],
      }),
      aStep("exercises", {
        title: "Limits: exercises 1 to 15",
        minutes: 60,
        reason: "No free time in the plan's days holds 60 minutes in one piece.",
        prerequisites: ["limits"],
      }),
    ],
    discarded: [{ position: 6, title: "A full mock exam", reasons: ["It takes 180 minutes."] }],
    progress: null,
    ...over,
  };
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
/** `url` is the whole address asked for, query included, for a route that reads it. */
type Handler = (init: RequestInit | undefined, url: string) => Response | Promise<Response>;

let fetchMock: ReturnType<typeof vi.fn<FetchLike>>;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** The week, and whatever plan routes a test adds, by method and path. */
function serve(plan: Plan | null, routes: Record<string, Handler> = {}): void {
  fetchMock.mockImplementation((input, init) => {
    const [path = "", query = ""] = input.replace("/api/v1", "").split("?");
    const key = `${init?.method ?? "GET"} ${path}`;
    const handler = routes[key];
    if (handler !== undefined) return Promise.resolve(handler(init, input));
    if (path === "/me") return Promise.resolve(json(200, ME));
    if (path === "/tasks") return Promise.resolve(json(200, { items: [], limit: 100, offset: 0 }));
    if (path === "/capacity") {
      const params = new URLSearchParams(query);
      const first = params.get("first_day") ?? "";
      const last = params.get("last_day") ?? "";
      const count = Math.round((Date.parse(last) - Date.parse(first)) / 86_400_000) + 1;
      return Promise.resolve(json(200, daysFromDate(first, count)));
    }
    if (key === "GET /plans") {
      return Promise.resolve(json(200, { items: plan === null ? [] : [plan], limit: 1, offset: 0 }));
    }
    // No request asked for, unless a test says otherwise.
    if (key === "GET /ai/plans") return Promise.resolve(json(200, { items: [], limit: 1, offset: 0 }));
    throw new Error(`no route for ${key}`);
  });
}

function Where(): React.ReactNode {
  return <output aria-label="path">{useLocation().pathname}</output>;
}

function renderAt(path: string): HTMLElement {
  const { container } = render(
    <MemoryRouter initialEntries={[path]}>
      <RouteFocus />
      <SessionProvider>
        <WeekScreen />
      </SessionProvider>
      <Where />
    </MemoryRouter>,
  );
  return container;
}

function path(): string {
  return screen.getByLabelText("path").textContent;
}

/** The calls made to a method and path, with the headers each one carried. */
function calls(method: string, route: string): Headers[] {
  return fetchMock.mock.calls
    .filter(([input, init]) => (init?.method ?? "GET") === method && input.split("?")[0]?.endsWith(route))
    .map(([, init]) => new Headers(init?.headers));
}

beforeEach(() => {
  resetClientForTests();
  setAccessToken("a.token");
  fetchMock = vi.fn<FetchLike>();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the Plan button", () => {
  it("finds the plan waiting on the server, and says it is ready to review", async () => {
    serve(aPlan());
    renderAt("/");

    expect(await screen.findByRole("button", { name: "Plan, ready to review" })).toBeDefined();
    expect(calls("GET", "/v1/plans").length).toBe(1);
    expect(calls("GET", "/ai/plans").length).toBe(1);
  });

  it("calls a plan written by hand a draft", async () => {
    serve(aPlan({ job_id: null }));
    renderAt("/");

    expect(await screen.findByRole("button", { name: "Plan, draft" })).toBeDefined();
  });

  it("is plain Plan when nothing waits", async () => {
    serve(null);
    renderAt("/");

    await screen.findByRole("grid");
    expect(screen.getByRole("button", { name: "Plan" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("says a failure until something newer happens, and not after", async () => {
    const failed = aJob({ status: "failed", failure_reason: "The plan waited too long to start. Ask for it again." });
    serve(aPlan({ status: "approved", created_at: "2026-10-22T14:00:00Z" }), {
      "GET /ai/plans": () => json(200, page([failed])),
    });
    renderAt("/");

    // The plan came after the failed request: the failure is not the news any more.
    await screen.findByRole("grid");
    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
  });
});

describe("asking for a plan", () => {
  function write(text: string): void {
    fireEvent.change(screen.getByLabelText("What do you want to plan?"), { target: { value: text } });
  }

  it("opens on the form when nothing waits, and catches an empty request before it is sent", async () => {
    serve(null);
    renderAt("/plan");

    expect(await screen.findByRole("heading", { name: "Ask for a plan" })).toBeDefined();
    write("   ");
    fireEvent.click(screen.getByRole("button", { name: "Make a plan" }));

    const field = screen.getByLabelText("What do you want to plan?");
    expect(screen.getByText("Write what you want to plan.")).toBeDefined();
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(field);
    expect(calls("POST", "/ai/plans")).toHaveLength(0);
  });

  it("sends what was written and the days chosen, then waits on what the server says", async () => {
    let sent: unknown = null;
    serve(null, {
      "POST /ai/plans": (init) => {
        sent = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
        return json(202, aJob({ horizon_days: 3 }));
      },
    });
    renderAt("/plan");
    await screen.findByRole("heading", { name: "Ask for a plan" });

    write(`  ${REQUEST}  `);
    fireEvent.change(screen.getByLabelText("Days ahead"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Make a plan" }));

    expect(await screen.findByRole("heading", { name: "Your plan" })).toBeDefined();
    expect(sent).toEqual({ request: REQUEST, horizon_days: 3 });
    expect(screen.getByText("Queued")).toBeDefined();
    expect(screen.getByText("Asked at 13:20, for 3 days. It starts when a place frees up.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Plan, queued" })).toBeDefined();
  });

  it("says when a refused request may be sent again, and keeps the form", async () => {
    serve(null, {
      "POST /ai/plans": () =>
        new Response(JSON.stringify({ detail: "At most 10 plans an hour. Try again later." }), {
          status: 429,
          headers: { "Content-Type": "application/json", "Retry-After": "1380" },
        }),
    });
    renderAt("/plan");
    await screen.findByRole("heading", { name: "Ask for a plan" });

    write(REQUEST);
    fireEvent.click(screen.getByRole("button", { name: "Make a plan" }));

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("At most 10 plans an hour. Try again later.")).toBeDefined();
    // The exact minute is held in plan-asking.test.ts; here, that the refusal's Retry-After is read.
    expect(within(alert).getByText(/^You can ask again at \d\d:\d\d\.$/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Make a plan" })).toBeDefined();
  });

  it("opens the plan there is when one is already waiting", async () => {
    let waiting: Plan | null = null;
    serve(null, {
      "POST /ai/plans": () => {
        waiting = aPlan();
        return json(409, { detail: "Review or discard the plan you have first." });
      },
      "GET /plans": () => json(200, page(waiting === null ? [] : [waiting])),
    });
    renderAt("/plan");
    await screen.findByRole("heading", { name: "Ask for a plan" });

    write(REQUEST);
    fireEvent.click(screen.getByRole("button", { name: "Make a plan" }));
    const alert = await screen.findByRole("alert");
    // Writing one by hand would be refused the same way: one plan at a time.
    expect(within(alert).queryByRole("button", { name: "Write it myself" })).toBeNull();
    fireEvent.click(within(alert).getByRole("button", { name: "Open the plan you have" }));

    expect(await screen.findByRole("heading", { name: "Review the plan" })).toBeDefined();
  });

  it("has nothing an automated accessibility check can find", async () => {
    serve(null);
    const container = renderAt("/plan");
    await screen.findByRole("heading", { name: "Ask for a plan" });
    fireEvent.click(screen.getByRole("button", { name: "Make a plan" }));

    await expectNoViolations(container);
  });

  // Here rather than with the waiting below, whose fake clock axe would wait on for ever.
  it("has nothing an automated accessibility check can find while the plan is made", async () => {
    serve(null, { "GET /ai/plans": () => json(200, page([aJob()])) });
    const container = renderAt("/plan");
    await screen.findByRole("heading", { name: "Your plan" });

    await expectNoViolations(container);
  });
});

describe("waiting for the plan", () => {
  // The polling's clock, faked. Testing Library waits on a timer of its own after each act and
  // only advances a fake clock it can see, which it looks for under `jest`; without this it
  // waits for ever. Its waits move the clock by a few intervals, so the times below have room.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal("jest", { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) });
  });

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(document, "hidden");
  });

  function reads(): number {
    return calls("GET", "/ai/plans/j1").length;
  }

  function hide(hidden: boolean): void {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    document.dispatchEvent(new Event("visibilitychange"));
  }

  it("reads the request at 2s, then half as long again, and says the plan came until it is opened", async () => {
    let now = aJob({ status: "running" });
    serve(null, {
      "GET /ai/plans": () => json(200, page([aJob()])),
      "GET /ai/plans/j1": () => json(200, now),
      "GET /plans/p1": () => json(200, aPlan()),
    });
    renderAt("/");
    expect(await screen.findByRole("button", { name: "Plan, queued" })).toBeDefined();

    await act(() => vi.advanceTimersByTimeAsync(1800));
    expect(reads()).toBe(0);
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(reads()).toBe(1);
    expect(await screen.findByRole("button", { name: "Plan, making…" })).toBeDefined();

    // The next one 3s after the first.
    now = aJob({ status: "done", plan_id: "p1" });
    await act(() => vi.advanceTimersByTimeAsync(2500));
    expect(reads()).toBe(1);
    await act(() => vi.advanceTimersByTimeAsync(700));

    expect(await screen.findByText("Your plan is ready: 2 steps, 1 discarded.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Plan, ready to review" })).toBeDefined();
    // A ready plan is not something to time out, and a done request is not read again.
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(screen.getByText("Your plan is ready: 2 steps, 1 discarded.")).toBeDefined();
    expect(reads()).toBe(2);

    fireEvent.click(screen.getByRole("button", { name: "Review" }));

    await waitFor(() => {
      expect(path()).toBe("/plan");
    });
    expect(screen.queryByText("Your plan is ready: 2 steps, 1 discarded.")).toBeNull();
  });

  it("reads nothing while the tab is hidden, and reads at once when it is shown again", async () => {
    serve(null, {
      "GET /ai/plans": () => json(200, page([aJob()])),
      "GET /ai/plans/j1": () => json(200, aJob()),
    });
    renderAt("/");
    await screen.findByRole("button", { name: "Plan, queued" });

    hide(true);
    await act(() => vi.advanceTimersByTimeAsync(120_000));
    expect(reads()).toBe(0);

    hide(false);

    await waitFor(() => {
      expect(reads()).toBe(1);
    });
  });

  it("says why a request failed, keeps what was asked, and offers to ask again", async () => {
    const reason = "The plan could not be made in 3 tries. Ask for it again.";
    serve(null, {
      "GET /ai/plans": () => json(200, page([aJob({ status: "failed", failure_reason: reason })])),
    });
    renderAt("/plan");

    expect(await screen.findByRole("heading", { name: "The plan didn’t come" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Plan, didn’t work" })).toBeDefined();
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText(reason)).toBeDefined();
    expect(within(alert).getByText(REQUEST)).toBeDefined();

    fireEvent.click(within(alert).getByRole("button", { name: "Ask for it again" }));

    expect(screen.getByRole("heading", { name: "Ask for a plan" })).toBeDefined();
    expect(screen.getByLabelText<HTMLTextAreaElement>("What do you want to plan?").value).toBe(REQUEST);
  });

});

describe("from 1640px, where all seven days fit beside it", () => {
  beforeEach(() => {
    setViewportWidth(1640);
  });

  it("opens the review beside the week, with the plan's steps proposed in their days", async () => {
    serve(aPlan());
    renderAt("/");
    fireEvent.click(await screen.findByRole("button", { name: "Plan, ready to review" }));

    const heading = await screen.findByRole("heading", { name: "Review the plan" });
    expect(path()).toBe("/plan");
    await waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });
    // The week stays, with the step that has a time in Thursday's column.
    const thursday = screen.getByRole("grid").querySelector(`[data-day="${THURSDAY}"]`) as HTMLElement;
    expect(within(thursday).getByText("10:00 – 10:30 · proposed")).toBeDefined();
    expect(within(thursday).getByText("+30m proposed → 30m")).toBeDefined();
    expect(screen.getByRole("button", { name: "Close" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Plan, ready to review" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("reads every part of the plan the drawing shows", async () => {
    serve(aPlan());
    renderAt("/plan");

    const steps = await screen.findByRole("list", { name: "Steps" });
    // The steps' own rows, not the links listed inside them.
    const [first, second] = within(steps).getAllByRole("listitem").filter((item) => item.parentElement === steps);
    expect(screen.getByText("Study for Wednesday's calculus exam").tagName).toBe("BLOCKQUOTE");
    expect(screen.getByText("2 kept · 1 discarded")).toBeDefined();
    expect(within(first as HTMLElement).getByText("Step 1")).toBeDefined();
    expect(within(first as HTMLElement).getByRole("link", { name: /Lecture notes/ }).getAttribute("href")).toBe(
      "https://moodle.example.edu/limits",
    );
    expect(within(second as HTMLElement).getByText("after step 1")).toBeDefined();
    expect(within(second as HTMLElement).getByText("No room")).toBeDefined();
    expect(
      within(second as HTMLElement).getByText("No free time in the plan's days holds 60 minutes in one piece."),
    ).toBeDefined();
    // A discarded step by its title, never by a number that collides with the kept ones.
    const discarded = screen.getByRole("group", { name: "Discarded (1)" });
    expect(within(discarded).getByText("A full mock exam")).toBeDefined();
    expect(within(discarded).queryByText(/Step/)).toBeNull();
    expect(await screen.findByText(/0m → 30m of 16h/)).toBeDefined();
    expect(
      screen.getByText(
        "1 step has no usable time yet. Approving would be refused until each has one or is removed.",
      ),
    ).toBeDefined();
  });

  it("leads from a proposed step to that step in the review", async () => {
    serve(aPlan());
    renderAt("/");

    fireEvent.click(await screen.findByRole("button", { name: "step 1 of your plan" }));

    await waitFor(() => {
      expect(document.activeElement?.id).toBe("step-limits");
    });
    expect(path()).toBe("/plan");
  });

  it("has nothing an automated accessibility check can find", async () => {
    serve(aPlan());
    const container = renderAt("/plan");
    await screen.findByRole("list", { name: "Steps" });

    await expectNoViolations(container);
  });
});

describe("from 1100px to where the panel fits", () => {
  beforeEach(() => {
    setViewportWidth(1639);
  });

  it("puts the review in place of the week, never beside a week with days out of view", async () => {
    serve(aPlan());
    renderAt("/plan");

    expect(await screen.findByRole("heading", { name: "Review the plan" })).toBeDefined();
    expect(screen.queryByRole("grid")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Weeks" })).toBeNull();
    // What the plan adds to each day is in the review instead, Approve at its foot.
    expect(await screen.findByText(/0m → 30m of 16h/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Approve: make 2 tasks" })).toBeDefined();

    // The week's keys move nothing while the week is not on screen.
    fireEvent.keyDown(window, { key: "]" });
    fireEvent.click(screen.getByRole("button", { name: "‹ Week" }));

    expect(path()).toBe("/");
    expect(await screen.findByRole("grid")).toBeDefined();
    expect(screen.getByText("this week")).toBeDefined();
  });

  it("has nothing an automated accessibility check can find", async () => {
    serve(aPlan());
    const container = renderAt("/plan");
    await screen.findByRole("button", { name: "Approve: make 2 tasks" });

    await expectNoViolations(container);
  });
});

describe("below 1100px", () => {
  beforeEach(() => {
    setViewportWidth(375);
  });

  it("puts the review in place of the day, with Approve where the bar between days was", async () => {
    serve(aPlan());
    renderAt("/plan");

    expect(await screen.findByRole("heading", { name: "Review the plan" })).toBeDefined();
    expect(await screen.findByRole("button", { name: "Approve: make 2 tasks" })).toBeDefined();
    expect(screen.queryByRole("list", { name: /^Tasks on/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Previous day/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "‹ Week" }));

    expect(path()).toBe("/");
    expect(await screen.findByRole("list", { name: /^Tasks on/ })).toBeDefined();
  });

  it("has nothing an automated accessibility check can find", async () => {
    serve(aPlan());
    const container = renderAt("/plan");
    await screen.findByRole("button", { name: "Approve: make 2 tasks" });

    await expectNoViolations(container);
  });
});

function bodyOf(init: RequestInit | undefined): unknown {
  return typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
}

describe("changing the plan", () => {
  function editForm(): HTMLElement {
    return screen.getByRole("form", { name: "Edit step" });
  }

  it("opens a step on its verbs, and gives one with no time a start, sending only that", async () => {
    let sent: unknown = null;
    const limits = aPlan().items[0] as PlanItem;
    const given = { ...(aPlan().items[1] as PlanItem), start_at: `${WEEK[6] as string}T16:30:00Z`, state: "placed" as const, reason: null };
    serve(aPlan(), {
      "PATCH /plans/p1/items/exercises": (init) => {
        sent = bodyOf(init);
        return json(200, given);
      },
      "GET /plans/p1": () => json(200, aPlan({ items: [limits, given] })),
    });
    renderAt("/plan");
    const row = await screen.findByRole("button", { name: /Limits: exercises 1 to 15/ });

    fireEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Give it a time" }));
    expect(screen.getByRole("button", { name: "Remove" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Give it a time" }));
    fireEvent.change(within(editForm()).getByLabelText("Day"), { target: { value: WEEK[6] } });
    fireEvent.change(within(editForm()).getByLabelText("Time"), { target: { value: "16:30" } });
    fireEvent.click(within(editForm()).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.queryByRole("form", { name: "Edit step" })).toBeNull();
    });
    // The title and the length did not move, so they are not sent to be checked again.
    expect(sent).toEqual({ start_at: `${WEEK[6] as string}T16:30:00.000Z` });
    expect(document.activeElement?.id).toBe("step-exercises");
  });

  it("shows what the server refuses a start for under it, and keeps what was typed", async () => {
    serve(aPlan(), {
      "PATCH /plans/p1/items/exercises": () => json(409, { detail: "That time is already taken by a task." }),
    });
    renderAt("/plan");
    fireEvent.click(await screen.findByRole("button", { name: /Limits: exercises 1 to 15/ }));
    fireEvent.click(screen.getByRole("button", { name: "Give it a time" }));
    const time = within(editForm()).getByLabelText<HTMLInputElement>("Time");

    fireEvent.change(time, { target: { value: "16:30" } });
    fireEvent.click(within(editForm()).getByRole("button", { name: "Save" }));

    expect(await within(editForm()).findByText("That time is already taken by a task.")).toBeDefined();
    expect(time.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(time);
    expect(time.value).toBe("16:30");
  });

  it("catches an empty title and a length it cannot read before anything is sent", async () => {
    serve(aPlan());
    renderAt("/plan");
    fireEvent.click(await screen.findByRole("button", { name: /Limits: the theory/ }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    fireEvent.change(within(editForm()).getByLabelText("Title"), { target: { value: "  " } });
    fireEvent.change(within(editForm()).getByLabelText("Duration"), { target: { value: "a while" } });
    fireEvent.click(within(editForm()).getByRole("button", { name: "Save" }));

    expect(within(editForm()).getByText("A step needs a title.")).toBeDefined();
    expect(within(editForm()).getByText("Between 1m and 24h, like 2h30.")).toBeDefined();
    expect(document.activeElement).toBe(within(editForm()).getByLabelText("Title"));
    expect(calls("PATCH", "/plans/p1/items/limits")).toHaveLength(0);
  });

  it("adds a step at the first free time, starting at the person's block, and says where it went", async () => {
    let sent: unknown = null;
    const added = aStep("review", {
      title: "Review the lists",
      minutes: 60,
      start_at: `${THURSDAY}T15:00:00Z`,
      state: "placed",
    });
    serve(aPlan(), {
      "POST /plans/p1/items": (init) => {
        sent = bodyOf(init);
        return json(201, added);
      },
      "GET /plans/p1": () => json(200, aPlan({ items: [...aPlan().items, added] })),
    });
    renderAt("/plan");

    fireEvent.click(await screen.findByRole("button", { name: "+ Add a step" }));
    const form = screen.getByRole("form", { name: "New step" });
    expect(within(form).getByLabelText<HTMLInputElement>("Duration").value).toBe("1h");
    fireEvent.change(within(form).getByLabelText("Title"), { target: { value: "Review the lists" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add" }));

    expect(
      await screen.findByText(`Added “Review the lists” at ${shortDay(THURSDAY)}, 15:00, the first free time.`),
    ).toBeDefined();
    expect(sent).toEqual({ title: "Review the lists", minutes: 60, description: "" });
    await waitFor(() => {
      expect(document.activeElement?.id).toBe("step-review");
    });
  });

  it("sends what did not fit to next week, and says where it went", async () => {
    const monday = daysFromDate(WEEK[6] as string, 2)[1]?.day as string;
    const limits = aPlan().items[0] as PlanItem;
    const waiting = {
      ...(aPlan().items[1] as PlanItem),
      state: "not_this_week" as const,
      reason: "It does not fit before Sunday. It can go next week.",
    };
    const later = { last_day: daysFromDate(monday, 7)[6]?.day as string };
    const sentOn = { ...waiting, start_at: `${monday}T08:00:00Z`, state: "placed" as const, reason: null };
    serve(aPlan({ ...later, items: [limits, waiting] }), {
      "POST /plans/p1/next-week": () => json(200, aPlan({ ...later, items: [limits, sentOn] })),
    });
    renderAt("/plan");

    expect(
      await screen.findByText(`1 step waits for next week: step 2. It’d go from ${shortDay(monday)}.`),
    ).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Send 1 to next week" }));

    expect(await screen.findByText(`1 step placed next week, at ${shortDay(monday)}, 08:00.`)).toBeDefined();
    expect(screen.queryByRole("button", { name: "Send 1 to next week" })).toBeNull();
  });

  it("has nothing an automated accessibility check can find, with a step and a new one open", async () => {
    serve(aPlan());
    const container = renderAt("/plan");
    fireEvent.click(await screen.findByRole("button", { name: /Limits: exercises 1 to 15/ }));
    fireEvent.click(screen.getByRole("button", { name: "Give it a time" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Add a step" }));

    await expectNoViolations(container);
  });
});

describe("removing a step", () => {
  // The notice's nine seconds, on a fake clock Testing Library can see (as for the polling).
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal("jest", { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const limitsOnly = (): Response => json(200, aPlan({ items: [aPlan().items[0] as PlanItem] }));

  function deletes(): number {
    return calls("DELETE", "/plans/p1/items/exercises").length;
  }

  async function removeTheSecond(): Promise<void> {
    fireEvent.click(await screen.findByRole("button", { name: /Limits: exercises 1 to 15/ }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  }

  it("takes it out at once, offers it back for nine seconds, and only then tells the server", async () => {
    serve(aPlan(), {
      "DELETE /plans/p1/items/exercises": () => new Response(null, { status: 204 }),
      "GET /plans/p1": limitsOnly,
    });
    renderAt("/plan");

    await removeTheSecond();

    expect(screen.queryByRole("button", { name: /Limits: exercises 1 to 15/ })).toBeNull();
    expect(screen.getByText("Removed step 2, “Limits: exercises 1 to 15”.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Approve: make 1 task" })).toBeDefined();
    expect(document.activeElement?.id).toBe("step-limits");
    await act(() => vi.advanceTimersByTimeAsync(8000));
    expect(deletes()).toBe(0);
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(deletes()).toBe(1);
  });

  it("puts it back on undo, with focus on it, and tells the server nothing", async () => {
    serve(aPlan(), { "DELETE /plans/p1/items/exercises": () => new Response(null, { status: 204 }) });
    renderAt("/plan");

    await removeTheSecond();
    fireEvent.click(screen.getByRole("button", { name: "undo" }));

    expect(document.activeElement?.id).toBe("step-exercises");
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(deletes()).toBe(0);
  });

  it("tells the server of a removal still on offer before the plan is approved", async () => {
    const order: string[] = [];
    serve(aPlan(), {
      "DELETE /plans/p1/items/exercises": () => {
        order.push("delete");
        return new Response(null, { status: 204 });
      },
      "GET /plans/p1": limitsOnly,
      "POST /plans/p1/commit": () => {
        order.push("commit");
        return json(200, { plan_id: "p1", task_ids: ["t1"] });
      },
    });
    renderAt("/plan");

    await removeTheSecond();
    fireEvent.click(screen.getByRole("button", { name: "Approve: make 1 task" }));

    expect(await screen.findByText("1 task added to your week from the plan.")).toBeDefined();
    expect(order).toEqual(["delete", "commit"]);
  });
});

describe("approving", () => {
  it("makes the tasks, says how many, and stays on the plan's page, with the way to the week", async () => {
    let committed = false;
    serve(aPlan(), {
      "POST /plans/p1/commit": () => {
        committed = true;
        return json(200, { plan_id: "p1", task_ids: ["t1", "t2"] });
      },
      "GET /plans/p1": () => json(200, committed ? approved(0) : aPlan()),
      "GET /tasks": () => json(200, page(committed ? theTasks(0) : [])),
    });
    renderAt("/plan");

    fireEvent.click(await screen.findByRole("button", { name: "Approve: make 2 tasks" }));

    expect(await screen.findByText("2 tasks added to your week from the plan.")).toBeDefined();
    expect(await screen.findByRole("heading", { name: "The plan, in your week" })).toBeDefined();
    expect(await screen.findByText("0 of 2")).toBeDefined();
    expect(calls("POST", "/plans/p1/commit")[0]?.get("Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/);

    fireEvent.click(screen.getByRole("button", { name: "Show the week" }));

    await waitFor(() => {
      expect(path()).toBe("/");
    });
    expect(screen.getByRole("button", { name: "Plan, 0 of 2" })).toBeDefined();
  });

  it("sends the same key again after an answer that never came", async () => {
    let attempts = 0;
    serve(aPlan(), {
      "POST /plans/p1/commit": () => {
        attempts += 1;
        if (attempts === 1) return Promise.reject(new TypeError("Failed to fetch"));
        return json(200, { plan_id: "p1", task_ids: ["t1", "t2"] });
      },
    });
    renderAt("/plan");

    fireEvent.click(await screen.findByRole("button", { name: "Approve: make 2 tasks" }));
    expect(await screen.findByText("Couldn’t reach the server.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Approve: make 2 tasks" }));
    await screen.findByText("2 tasks added to your week from the plan.");

    const [first, second] = calls("POST", "/plans/p1/commit").map((sent) => sent.get("Idempotency-Key"));
    expect(second).toBe(first);
  });

  it("shows every step the commit was refused for at once, and marks each", async () => {
    const reason = "It has no time yet. Give it one, or remove it.";
    serve(aPlan(), {
      "POST /plans/p1/commit": () =>
        json(409, {
          detail: "The plan cannot become tasks as it stands. Nothing was written.",
          items: [{ id: "exercises", title: "Limits: exercises 1 to 15", reason }],
        }),
    });
    renderAt("/plan");

    fireEvent.click(await screen.findByRole("button", { name: "Approve: make 2 tasks" }));

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Step 2, Limits: exercises 1 to 15: " + reason)).toBeDefined();
    await waitFor(() => {
      expect(document.activeElement).toBe(alert);
    });
    const step = document.getElementById("step-exercises") as HTMLElement;
    expect(within(step).getByText(reason)).toBeDefined();
    // The server's sentence in place of the step's own reason, not beside it.
    expect(within(step).queryByText(/No free time/)).toBeNull();
    expect(path()).toBe("/plan");
  });

  it("reads the plan again after a refusal with no step to change, and says it has closed", async () => {
    serve(aPlan(), {
      "POST /plans/p1/commit": () =>
        json(409, { detail: "This plan is no longer open for review." }),
      "GET /plans/p1": () => json(200, aPlan({ status: "expired" })),
    });
    renderAt("/plan");

    fireEvent.click(await screen.findByRole("button", { name: "Approve: make 2 tasks" }));
    fireEvent.click(await screen.findByRole("button", { name: "Read the plan again" }));

    expect(await screen.findByText(/the last day passed before it was reviewed/)).toBeDefined();
    expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
  });
});

describe("discarding", () => {
  it("asks first, on the safe answer, and keeping the plan goes back to the button", async () => {
    serve(aPlan());
    renderAt("/plan");

    fireEvent.click(await screen.findByRole("button", { name: "Discard plan" }));

    const question = screen.getByRole("group", { name: "Discard this plan?" });
    expect(within(question).getByText("Discard this plan? Its 2 steps won’t become tasks.")).toBeDefined();
    const keep = within(question).getByRole("button", { name: "Keep it" });
    await waitFor(() => {
      expect(document.activeElement).toBe(keep);
    });

    fireEvent.click(keep);

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Discard plan" }));
    });
    expect(calls("POST", "/plans/p1/discard")).toEqual([]);
  });

  it("sets the plan aside and says nothing was written", async () => {
    serve(aPlan(), { "POST /plans/p1/discard": () => new Response(null, { status: 204 }) });
    renderAt("/plan");

    fireEvent.click(await screen.findByRole("button", { name: "Discard plan" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Discard" }));
      await Promise.resolve();
    });

    expect(await screen.findByText("Plan discarded. Nothing was written.")).toBeDefined();
    await waitFor(() => {
      expect(path()).toBe("/");
    });
    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.queryByText("10:00 – 10:30 · proposed")).toBeNull();
  });
});

/** The plan approved, its two steps two tasks, `done` of them completed. */
function approved(done: number, over: Partial<Plan> = {}): Plan {
  return aPlan({ status: "approved", progress: { done, total: 2 }, ...over });
}

function aTask(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    notes: null,
    start_at: `${THURSDAY}T10:00:00Z`,
    end_at: `${THURSDAY}T10:30:00Z`,
    duration_minutes: 30,
    completed_at: null,
    tag: null,
    items: [],
    plan_id: "p1",
    ...over,
  };
}

/** The approved plan's two tasks, the first `done` of them completed. */
function theTasks(done: number): Task[] {
  return [
    aTask("t1", { title: "Limits: the theory", completed_at: done > 0 ? `${THURSDAY}T10:30:00Z` : null }),
    aTask("t2", {
      title: "Limits: exercises 1 to 15",
      start_at: `${THURSDAY}T15:00:00Z`,
      end_at: `${THURSDAY}T16:00:00Z`,
      duration_minutes: 60,
      completed_at: done > 1 ? `${THURSDAY}T16:00:00Z` : null,
    }),
  ];
}

describe("an approved plan", () => {
  it("is counted on the Plan button while a task of it is still open", async () => {
    serve(approved(1), { "GET /plans/p1": () => json(200, approved(1)) });
    renderAt("/");

    expect(await screen.findByRole("button", { name: "Plan, 1 of 2" })).toBeDefined();
  });

  it("gives way on the button, once all are done, to an older plan still under way", async () => {
    const older = approved(0, { id: "p0" });
    serve(approved(2), {
      "GET /plans/p0": () => json(200, older),
      "GET /plans": (_init, url) =>
        json(200, page(url.includes("status=approved") ? [approved(2), older] : [approved(2)])),
    });
    renderAt("/");
    expect(await screen.findByRole("button", { name: "Plan, 0 of 2" })).toBeDefined();
  });

  it("opens on the plan the button counts: how many are done, what it was for and its tasks", async () => {
    serve(approved(1, { items: [...aPlan().items, aStep("mock", { title: "A mock exam" })] }), {
      "GET /plans/p1": () =>
        json(200, approved(1, { items: [...aPlan().items, aStep("mock", { title: "A mock exam" })] })),
      "GET /tasks": () => json(200, page(theTasks(1))),
    });
    renderAt("/plan");

    expect(await screen.findByRole("heading", { name: "The plan, in your week" })).toBeDefined();
    expect(await screen.findByText("1 of 2")).toBeDefined();
    expect(screen.getByText("preparations done")).toBeDefined();
    // Three steps became three tasks; the count holds two, so one was deleted since.
    expect(screen.getByText("1 task from this plan was deleted, so it left the count.")).toBeDefined();
    const tasks = within(screen.getByRole("list", { name: "Tasks from this plan" }));
    expect(tasks.getByRole("checkbox", { name: "Reopen Limits: the theory" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(tasks.getByText(`${shortDay(THURSDAY)} · 15:00 – 16:00`)).toBeDefined();
    // Asked for by the plan, not by its days: a task moved out of them still counts.
    expect(fetchMock.mock.calls.some(([input]) => input.includes("/tasks?plan_id=p1"))).toBe(true);
  });

  it("completes a task from its page, and counts it once the server has it", async () => {
    let done = 1;
    let sent: unknown = null;
    serve(approved(1), {
      "GET /plans/p1": () => json(200, approved(done)),
      "GET /tasks": () => json(200, page(theTasks(done))),
      "PATCH /tasks/t2": (init) => {
        sent = bodyOf(init);
        done = 2;
        return json(200, theTasks(2)[1]);
      },
    });
    renderAt("/plan");
    const tasks = within(await screen.findByRole("list", { name: "Tasks from this plan" }));

    fireEvent.click(tasks.getByRole("checkbox", { name: "Complete Limits: exercises 1 to 15" }));

    expect(await screen.findByText("2 of 2")).toBeDefined();
    expect(sent).toEqual({ completed: true });
    expect(tasks.getByRole("checkbox", { name: "Reopen Limits: exercises 1 to 15" })).toBeDefined();
  });

  it("is reached from a task it made, which leads to its own plan and not the one counted", async () => {
    const older = approved(0, { id: "p9", request: "Organizar a mudança" });
    serve(approved(0), {
      "GET /plans/p1": () => json(200, approved(0)),
      "GET /plans/p9": () => json(200, older),
      "GET /tasks": () => json(200, page([aTask("t9", { plan_id: "p9", title: "Pack the boxes" })])),
    });
    renderAt("/");
    const link = await screen.findByRole("button", { name: "from your plan" });
    // Out of the week's tab order while its row is shut, as the row's box is (ADR-0053).
    expect(link.getAttribute("tabindex")).toBe("-1");

    fireEvent.click(link);

    await waitFor(() => {
      expect(path()).toBe("/plan/p9");
    });
    expect(await screen.findByText("Organizar a mudança")).toBeDefined();
    expect(screen.getByRole("heading", { name: "The plan, in your week" })).toBeDefined();
  });

  it("leads below 1100px from the day's row, under its button", async () => {
    setViewportWidth(375);
    serve(null, {
      "GET /plans/p1": () => json(200, approved(0)),
      "GET /tasks": () => {
        const today = toLocalDate(todayIn("UTC"));
        return json(200, page([aTask("t1", { start_at: `${today}T10:00:00Z`, end_at: `${today}T10:30:00Z` })]));
      },
    });
    renderAt("/");

    fireEvent.click(await screen.findByRole("button", { name: "from your plan" }));

    await waitFor(() => {
      expect(path()).toBe("/plan/p1");
    });
  });

  it("lets a new plan be asked for or written from its page", async () => {
    serve(approved(0), {
      "GET /plans/p1": () => json(200, approved(0)),
      "GET /tasks": () => json(200, page(theTasks(0))),
    });
    renderAt("/plan");
    await screen.findByText("0 of 2");

    fireEvent.click(screen.getByRole("button", { name: "Ask for a new plan" }));

    expect(screen.getByRole("heading", { name: "Ask for a plan" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Write it myself" }));
    expect(screen.getByLabelText("What it’s for")).toBeDefined();
  });

  it("has nothing an automated accessibility check can find", async () => {
    serve(approved(1), {
      "GET /plans/p1": () => json(200, approved(1)),
      "GET /tasks": () => json(200, page(theTasks(1))),
    });
    const container = renderAt("/plan");
    await screen.findByText("1 of 2");

    await expectNoViolations(container);
  });
});

describe("writing a plan by hand", () => {
  const handPlan = (items: PlanItem[]): Plan =>
    aPlan({ id: "h1", job_id: null, request: "Move rooms", discarded: [], items });
  const boxes = aStep("boxes", {
    title: "Pack the boxes",
    minutes: 60,
    start_at: `${THURSDAY}T15:00:00Z`,
    state: "placed",
  });

  async function startWriting(): Promise<HTMLElement> {
    await screen.findByRole("heading", { name: "Ask for a plan" });
    fireEvent.click(screen.getByRole("button", { name: "Write it myself" }));
    return screen.getByRole("form", { name: "New step" });
  }

  it("opens an empty plan on what it is for, sends nothing, and makes it with its first step", async () => {
    let made: unknown = null;
    let step: unknown = null;
    serve(null, {
      "POST /plans": (init) => {
        made = bodyOf(init);
        return json(201, handPlan([]));
      },
      "POST /plans/h1/items": (init) => {
        step = bodyOf(init);
        return json(201, boxes);
      },
      "GET /plans/h1": () => json(200, handPlan([boxes])),
    });
    renderAt("/plan");
    await screen.findByRole("heading", { name: "Ask for a plan" });
    fireEvent.change(screen.getByLabelText("Days ahead"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Write it myself" }));

    expect(screen.getByRole("heading", { name: "Your plan" })).toBeDefined();
    const purpose = screen.getByLabelText("What it’s for");
    await waitFor(() => {
      expect(document.activeElement).toBe(purpose);
    });
    expect(screen.getByText(/^Covers .+ \(3 days\)\./)).toBeDefined();
    expect(screen.getByText("0 steps, written by you")).toBeDefined();
    expect(calls("POST", "/plans")).toHaveLength(0);

    const form = screen.getByRole("form", { name: "New step" });
    fireEvent.change(purpose, { target: { value: "  Move rooms " } });
    fireEvent.change(within(form).getByLabelText("Title"), { target: { value: "Pack the boxes" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add" }));

    expect(
      await screen.findByText(`Added “Pack the boxes” at ${shortDay(THURSDAY)}, 15:00, the first free time.`),
    ).toBeDefined();
    expect(made).toEqual({ request: "Move rooms", horizon_days: 3 });
    expect(step).toEqual({ title: "Pack the boxes", minutes: 60, description: "" });
    // Named as it was made: the API takes no other name, so the field is text from here.
    expect(screen.queryByLabelText("What it’s for")).toBeNull();
    expect(screen.getByText("Move rooms")).toBeDefined();
    expect(screen.getByText("1 step, written by you")).toBeDefined();
    await waitFor(() => {
      expect(document.activeElement?.id).toBe("step-boxes");
    });
  });

  it("asks what it is for before its first step is sent", async () => {
    serve(null);
    renderAt("/plan");
    const form = await startWriting();
    const title = within(form).getByLabelText("Title");

    fireEvent.change(title, { target: { value: "Pack the boxes" } });
    title.focus();
    fireEvent.click(within(form).getByRole("button", { name: "Add" }));

    const purpose = screen.getByLabelText("What it’s for");
    expect(screen.getByText("Write what the plan is for.")).toBeDefined();
    expect(purpose.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(purpose);
    expect(calls("POST", "/plans")).toHaveLength(0);
  });

  it("keeps the plan made when its first step does not arrive, and sends the step to it again", async () => {
    let tries = 0;
    serve(null, {
      "POST /plans": () => json(201, handPlan([])),
      "POST /plans/h1/items": () => {
        tries += 1;
        return tries === 1 ? Promise.reject(new TypeError("Failed to fetch")) : json(201, boxes);
      },
      "GET /plans/h1": () => json(200, handPlan([boxes])),
    });
    renderAt("/plan");
    const form = await startWriting();
    fireEvent.change(screen.getByLabelText("What it’s for"), { target: { value: "Move rooms" } });
    fireEvent.change(within(form).getByLabelText("Title"), { target: { value: "Pack the boxes" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add" }));

    expect(await within(form).findByText("Couldn’t reach the server.")).toBeDefined();
    expect(within(form).getByLabelText<HTMLInputElement>("Title").value).toBe("Pack the boxes");
    expect(screen.getByText("Move rooms")).toBeDefined();
    fireEvent.click(within(form).getByRole("button", { name: "Add" }));

    expect(await screen.findByText("1 step, written by you")).toBeDefined();
    expect(calls("POST", "/plans")).toHaveLength(1);
    expect(calls("POST", "/plans/h1/items")).toHaveLength(2);
  });

  it("is offered where asking was refused to spare the model", async () => {
    serve(null, {
      "POST /ai/plans": () =>
        new Response(JSON.stringify({ detail: "Planning is paused until next month." }), {
          status: 503,
          headers: { "Content-Type": "application/json", "Retry-After": "86400" },
        }),
    });
    renderAt("/plan");
    await screen.findByRole("heading", { name: "Ask for a plan" });
    fireEvent.change(screen.getByLabelText("What do you want to plan?"), { target: { value: REQUEST } });
    fireEvent.click(screen.getByRole("button", { name: "Make a plan" }));

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Planning is paused until next month.")).toBeDefined();
    fireEvent.click(within(alert).getByRole("button", { name: "Write it myself" }));

    expect(screen.getByLabelText("What it’s for")).toBeDefined();
  });

  it("is offered when a plan did not come, for the days that were asked for", async () => {
    const reason = "The plan could not be made in 3 tries. Ask for it again.";
    serve(null, {
      "GET /ai/plans": () =>
        json(200, page([aJob({ status: "failed", failure_reason: reason, horizon_days: 4 })])),
    });
    renderAt("/plan");
    await screen.findByRole("heading", { name: "The plan didn’t come" });

    fireEvent.click(screen.getByRole("button", { name: "Write it myself" }));

    expect(screen.getByRole("heading", { name: "Your plan" })).toBeDefined();
    expect(screen.getByText(/^Covers .+ \(4 days\)\./)).toBeDefined();
  });

  it("is offered when the plan closed, and drawn over it", async () => {
    serve(aPlan(), {
      "POST /plans/p1/commit": () => json(409, { detail: "This plan is no longer open for review." }),
      "GET /plans/p1": () => json(200, aPlan({ status: "expired" })),
    });
    renderAt("/plan");
    fireEvent.click(await screen.findByRole("button", { name: "Approve: make 2 tasks" }));
    fireEvent.click(await screen.findByRole("button", { name: "Read the plan again" }));

    fireEvent.click(await screen.findByRole("button", { name: "Write it myself" }));

    expect(screen.getByLabelText("What it’s for")).toBeDefined();
    expect(screen.getByText(/^Covers .+ \(7 days\)\./)).toBeDefined();
  });

  it("says an empty one has nothing to approve, and discards it without the server", async () => {
    serve(null);
    renderAt("/plan");
    await startWriting();

    fireEvent.click(screen.getByRole("button", { name: "Approve: make 0 tasks" }));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("The plan has no steps to commit. Add one, or discard the plan.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Discard plan" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(await screen.findByText("Plan discarded. Nothing was written.")).toBeDefined();
    const writes = fetchMock.mock.calls.filter(
      ([input, init]) => input.includes("/plans") && (init?.method ?? "GET") !== "GET",
    );
    expect(writes).toEqual([]);
  });

  it("has nothing an automated accessibility check can find, with what it is for missing", async () => {
    serve(null);
    const container = renderAt("/plan");
    const form = await startWriting();
    fireEvent.click(within(form).getByRole("button", { name: "Add" }));

    await expectNoViolations(container);
  });
});

it("reads a plan by hand by what it is for, not as something asked", async () => {
  serve(aPlan({ job_id: null, discarded: [] }));
  renderAt("/plan");

  expect(await screen.findByRole("heading", { name: "Your plan" })).toBeDefined();
  expect(screen.getByText("What it’s for")).toBeDefined();
  expect(screen.getByText("2 steps, written by you")).toBeDefined();
  expect(screen.queryByText("You asked")).toBeNull();
});
