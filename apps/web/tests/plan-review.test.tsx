/**
 * Tests for the Plan button and the review (plan.dc.html).
 *
 * What earns a test here is what the server decides and the screen must not guess: which plan
 * is waiting comes from the server after a reload, a commit retried after a lost answer sends
 * the same key, every step a commit is refused for is shown at once, and a plan read again
 * after a refusal may turn out to be closed.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetClientForTests } from "../src/api/client";
import { setAccessToken } from "../src/api/token";
import type { DayCapacity, Plan, PlanItem } from "../src/api/types";
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

function aPlan(over: Partial<Plan> = {}): Plan {
  return {
    id: "p1",
    job_id: "j1",
    created_at: `${THURSDAY}T08:00:00Z`,
    status: "pending",
    request: "Study for Wednesday's calculus exam",
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
    expect(calls("GET", "/plans").length).toBe(1);
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
