/**
 * Tests for the Plan button and the plan screen (plan.dc.html): asking, waiting and reviewing.
 *
 * What earns a test here is what the server decides and the screen must not guess: which
 * request is being made, which plan is waiting and whether a failure is still the news come
 * from the server after a reload; a request is read on the decided pace and not while the tab
 * is hidden; a refusal says when to ask again; a commit retried after a lost answer sends the
 * same key, every step a commit is refused for is shown at once, and a plan read again after a
 * refusal may turn out to be closed.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetClientForTests } from "../src/api/client";
import { setAccessToken } from "../src/api/token";
import type { DayCapacity, Job, Plan, PlanItem } from "../src/api/types";
import { SessionProvider } from "../src/auth/session";
import { daysFrom, mondayOf, toLocalDate, todayIn } from "../src/lib/time";
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
type Handler = (init: RequestInit | undefined) => Response | Promise<Response>;

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
    if (handler !== undefined) return Promise.resolve(handler(init));
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
    fireEvent.click(await screen.findByRole("button", { name: "Open the plan you have" }));

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
    const [first, second] = within(steps).getAllByRole("listitem").filter((item) => item.id !== "");
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

describe("approving", () => {
  it("makes the tasks, says how many, and goes back to the week", async () => {
    serve(aPlan(), {
      "POST /plans/p1/commit": () => json(200, { plan_id: "p1", task_ids: ["t1", "t2"] }),
    });
    renderAt("/plan");

    fireEvent.click(await screen.findByRole("button", { name: "Approve: make 2 tasks" }));

    expect(await screen.findByText("2 tasks added to your week from the plan.")).toBeDefined();
    await waitFor(() => {
      expect(path()).toBe("/");
    });
    expect(calls("POST", "/plans/p1/commit")[0]?.get("Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/);
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

it("reads a plan by hand by what it is for, not as something asked", async () => {
  serve(aPlan({ job_id: null, discarded: [] }));
  renderAt("/plan");

  expect(await screen.findByRole("heading", { name: "Your plan" })).toBeDefined();
  expect(screen.getByText("What it’s for")).toBeDefined();
  expect(screen.getByText("2 steps, written by you")).toBeDefined();
  expect(screen.queryByText("You asked")).toBeNull();
});
