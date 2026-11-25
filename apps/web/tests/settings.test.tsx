/**
 * Tests for the settings page (settings.dc.html) and what signing out leaves on screen.
 *
 * Settings is a page in place of the week at every width, reached from the Menu. Going back,
 * by its button or by Esc, lands focus on the day that was left, because the week stays
 * underneath with its week and its day (decided on 2026-11-23); the week's own keys do nothing
 * while it is out of view. Signing out waits for the server: until the server has ended the
 * session the person is still signed in, and a sign-out it never heard says so where it was
 * pressed.
 */
import {
  type BoundFunctions,
  act,
  fireEvent,
  queries,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { resetClientForTests } from "../src/api/client";
import type { DayCapacity } from "../src/api/types";
import { App } from "../src/App";
import { SessionProvider } from "../src/auth/session";
import { daysFrom, mondayOf, toLocalDate, todayIn } from "../src/lib/time";
import { expectNoViolations } from "./a11y";
import { setViewportWidth } from "./viewport";

const ME = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "design-check@example.com",
  timezone: "UTC",
  verified_at: "2026-08-01T12:00:00Z",
  day_starts_at: "06:00:00",
  day_ends_at: "22:00:00",
  days_off: [],
  preferred_block_minutes: 60,
};

const WEEK = daysFrom(mondayOf(todayIn("UTC"))).map(toLocalDate);

/** A day measured against `usable` minutes, with `occupied` booked: heavy past the budget. */
function aDay(day: string, weekday: number, usable = 960, occupied = 0): DayCapacity {
  return {
    day,
    weekday,
    total_minutes: 1440,
    usable_minutes: usable,
    occupied_minutes: occupied,
    free_minutes: Math.max(0, usable - occupied),
    unbooked_minutes: 1440 - occupied,
    task_count: occupied === 0 ? 0 : 1,
    over_capacity: occupied > usable,
    load: occupied > usable ? "heavy" : "fine",
  };
}

/** Thursday holds 15 hours: fine against the saved 16, heavy against 14. */
const THURSDAY_BOOKED = 15 * 60;

/**
 * The week measured as the server measures it: against the stored 06:00–22:00, or against a
 * window asked for, which it refuses past 18 hours or under one, as it would refuse saving it.
 */
function capacity(query: string): Response {
  const params = new URLSearchParams(query);
  const minutes = (time: string | null, fallback: number): number =>
    time === null ? fallback : Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const usable = minutes(params.get("day_ends_at"), 22 * 60) - minutes(params.get("day_starts_at"), 6 * 60);
  if (usable < 60 || usable > 18 * 60) {
    return json(422, {
      detail: "The usable day has to be at least 1 hour long.",
      fields: ["day_starts_at", "day_ends_at"],
    });
  }
  return json(
    200,
    WEEK.map((day, index) => aDay(day, index + 1, usable, index === 3 ? THURSDAY_BOOKED : 0)),
  );
}

function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

let fetchMock: ReturnType<typeof vi.fn<FetchLike>>;

interface Answers {
  logout?: () => Promise<Response>;
  /** `PATCH /me`, given the body sent. */
  patchMe?: (body: Record<string, unknown>) => Promise<Response>;
}

/** A signed-in person with an empty week; signing out and saving answer however a test says. */
function serve({
  logout = () => Promise.resolve(json(204)),
  patchMe = (body) => Promise.resolve(json(200, { ...ME, ...body })),
}: Answers = {}): void {
  fetchMock.mockImplementation((input, init) => {
    const path = input.replace("/api/v1", "").split("?")[0] ?? "";
    if (path === "/auth/refresh") {
      return Promise.resolve(json(200, { access_token: "a.token", token_type: "bearer", expires_in: 1800 }));
    }
    if (path === "/auth/logout") return logout();
    if (path === "/me" && init?.method === "PATCH") {
      return patchMe(JSON.parse(init.body as string) as Record<string, unknown>);
    }
    if (path === "/me") return Promise.resolve(json(200, ME));
    if (path === "/capacity") return Promise.resolve(capacity(input.split("?")[1] ?? ""));
    if (path === "/tasks") return Promise.resolve(json(200, { items: [], limit: 100, offset: 0 }));
    if (path === "/plans" || path === "/ai/plans") {
      return Promise.resolve(json(200, { items: [], limit: 1, offset: 0 }));
    }
    throw new Error(`no route for ${path}`);
  });
}

function Where(): React.ReactNode {
  return <output aria-label="path">{useLocation().pathname}</output>;
}

function renderAt(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <SessionProvider>
        <App />
        <Where />
      </SessionProvider>
    </MemoryRouter>,
  );
}

function path(): string {
  return screen.getByLabelText("path").textContent;
}

async function openSettings(): Promise<void> {
  await userEvent.click(await screen.findByRole("button", { name: "Menu" }));
  await userEvent.click(screen.getByRole("button", { name: "Settings" }));
  await screen.findByRole("heading", { level: 1, name: "Settings" });
}

beforeEach(() => {
  resetClientForTests();
  fetchMock = vi.fn<FetchLike>();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("is a page in place of the week, with the address and the zone", async () => {
  serve();
  renderAt("/");
  await screen.findByRole("grid");

  await openSettings();

  expect(path()).toBe("/settings");
  expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: "Settings" }));
  expect(screen.queryByRole("grid")).toBeNull();
  // Neither the weeks' way nor their keys' legend: the weeks are not on screen.
  expect(screen.queryByRole("navigation", { name: "Weeks" })).toBeNull();
  const account = within(screen.getByRole("region", { name: "Account" }));
  expect(account.getByText("design-check@example.com")).toBeDefined();
  expect(account.getByText("UTC")).toBeDefined();
  expect(account.getByText(/Every task falls on a day by this zone/)).toBeDefined();
});

it("opens on its own address after a reload", async () => {
  serve();
  renderAt("/settings");

  expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeDefined();
});

it("goes back to the week with focus on the day that was left", async () => {
  serve();
  renderAt("/");
  await screen.findByRole("grid");
  const wednesday = document.querySelector<HTMLElement>('[data-cell="2:0"]');
  act(() => {
    wednesday?.focus();
  });
  await openSettings();

  await userEvent.click(screen.getByRole("button", { name: "‹ Back to the week" }));

  expect(path()).toBe("/");
  await waitFor(() => {
    expect(document.activeElement?.getAttribute("data-cell")).toBe("2:0");
  });
});

it("goes back on Esc, and leaves the week alone on the week's own keys", async () => {
  serve();
  renderAt("/");
  const range = (await screen.findByRole("heading", { level: 1 })).textContent;
  await openSettings();

  fireEvent.keyDown(window, { key: "]" });
  fireEvent.keyDown(window, { key: "Escape" });

  expect(path()).toBe("/");
  expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe(range);
});

it("takes the place of the day below 1100px, with no bar between days", async () => {
  setViewportWidth(375);
  serve();
  renderAt("/settings");

  expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeDefined();
  expect(screen.queryByRole("navigation", { name: "Days" })).toBeNull();
});

it("signs out once the server has, and leaves a page saying what did not happen", async () => {
  let endSession: (response: Response) => void = () => undefined;
  serve({
    logout: () =>
      new Promise<Response>((resolve) => {
        endSession = resolve;
      }),
  });
  renderAt("/settings");
  await screen.findByRole("heading", { level: 1, name: "Settings" });

  await userEvent.click(screen.getByRole("button", { name: "Sign out of this browser" }));
  expect(screen.getByRole("button", { name: "Signing out…" }).getAttribute("aria-busy")).toBe("true");
  expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeDefined();

  act(() => {
    endSession(json(204));
  });

  const heading = await screen.findByRole("heading", { name: "You’re signed out of this browser" });
  expect(document.activeElement).toBe(heading);
  expect(screen.getByText(/Nothing was deleted/)).toBeDefined();
});

it("opens the sign-in screen on the week's address from the signed-out page", async () => {
  serve();
  renderAt("/settings");
  await screen.findByRole("heading", { level: 1, name: "Settings" });
  await userEvent.click(screen.getByRole("button", { name: "Sign out of this browser" }));
  await screen.findByRole("heading", { name: "You’re signed out of this browser" });

  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

  const heading = await screen.findByRole("heading", { name: "Welcome back" });
  expect(path()).toBe("/");
  expect(document.activeElement).toBe(heading);
});

it("stays signed in when the server never heard the sign-out, and says so there", async () => {
  serve({ logout: () => Promise.reject(new TypeError("Failed to fetch")) });
  renderAt("/settings");
  await screen.findByRole("heading", { level: 1, name: "Settings" });

  await userEvent.click(screen.getByRole("button", { name: "Sign out of this browser" }));

  expect(
    await screen.findByText("Couldn’t reach the server. You’re still signed in here."),
  ).toBeDefined();
  expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeDefined();
});

it("has nothing an automated accessibility check can find, nor does the signed-out page", async () => {
  serve();
  renderAt("/settings");
  await screen.findByRole("heading", { level: 1, name: "Settings" });
  await expectNoViolations(document.body);

  await userEvent.click(screen.getByRole("button", { name: "Sign out of this browser" }));
  await screen.findByRole("heading", { name: "You’re signed out of this browser" });
  await expectNoViolations(document.body);
});

function patches(): unknown[] {
  return fetchMock.mock.calls
    .filter(([input, init]) => input.endsWith("/me") && init?.method === "PATCH")
    .map(([, init]) => JSON.parse(init?.body as string) as unknown);
}

async function retype(field: HTMLElement, text: string): Promise<void> {
  await userEvent.clear(field);
  if (text !== "") await userEvent.type(field, text);
}

describe("the usable day, the days off and the block", () => {
  /** The page open on the form, with Save answered however the test says. */
  async function form(patchMe?: Answers["patchMe"]): Promise<BoundFunctions<typeof queries>> {
    serve(patchMe === undefined ? {} : { patchMe });
    renderAt("/settings");
    await screen.findByRole("heading", { level: 1, name: "Settings" });
    return within(screen.getByRole("region", { name: "Your day and your plans" }));
  }

  it("saves only what changed, says what each day now has, and reads the week again", async () => {
    const here = await form();
    await retype(here.getByLabelText("Ends"), "20:00");
    await userEvent.click(here.getByRole("button", { name: "15 minutes more" }));
    expect(here.getByText("Changed, not saved yet: usable day, block.")).toBeDefined();
    // By its tasks: the week under the hours reads capacity too, and only the week reads tasks.
    const readsBefore = fetchMock.mock.calls.filter(([input]) => input.includes("/tasks")).length;

    await userEvent.click(here.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Saved. Each day now has 14h to give.")).toBeDefined();
    expect(patches()).toEqual([{ day_ends_at: "20:00", preferred_block_minutes: 75 }]);
    expect(here.getByText("Everything here is saved.")).toBeDefined();
    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([input]) => input.includes("/tasks")).length).toBeGreaterThan(
        readsBefore,
      );
    });
  });

  it("puts the server's refusal under the part it names, and keeps what was typed", async () => {
    const here = await form(() =>
      Promise.resolve(
        json(422, { detail: "A block lasts from 15 minutes to 4 hours.", fields: ["preferred_block_minutes"] }),
      ),
    );
    await retype(here.getByLabelText("Starts"), "07:00");
    await retype(here.getByLabelText("Longest step a plan proposes"), "300");

    await userEvent.click(here.getByRole("button", { name: "Save" }));

    expect(await here.findByText("A block lasts from 15 minutes to 4 hours.")).toBeDefined();
    expect(
      here.getByText("Nothing was saved. Fix the block and save again; your other changes are still here."),
    ).toBeDefined();
    expect(here.getByText("Not saved. Still changed: usable day, block.")).toBeDefined();
    expect(here.getByLabelText<HTMLInputElement>("Starts").value).toBe("07:00");
    const block = here.getByLabelText("Longest step a plan proposes");
    expect(block.getAttribute("aria-invalid")).toBe("true");
    await waitFor(() => {
      expect(document.activeElement).toBe(block);
    });
  });

  it("takes the reader to the days off when they are the part refused", async () => {
    const here = await form(() =>
      Promise.resolve(json(422, { detail: "There has to be at least one day to plan in.", fields: ["days_off"] })),
    );
    for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]) {
      await userEvent.click(here.getByRole("button", { name: `${day}, plans can use it` }));
    }
    expect(here.getByRole("button", { name: "Sunday, day off" }).getAttribute("aria-pressed")).toBe("true");

    await userEvent.click(here.getByRole("button", { name: "Save" }));

    expect(await here.findByText("There has to be at least one day to plan in.")).toBeDefined();
    expect(patches()).toEqual([{ days_off: [1, 2, 3, 4, 5, 6, 7] }]);
    await waitFor(() => {
      expect(document.activeElement?.textContent).toMatch(/^A plan puts no steps on these days/);
    });
  });

  it("catches a time that is not one before sending anything", async () => {
    const here = await form();
    await retype(here.getByLabelText("Starts"), "7");

    await userEvent.click(here.getByRole("button", { name: "Save" }));

    expect(here.getByText("Use 24-hour time, like 14:30.")).toBeDefined();
    expect(patches()).toEqual([]);
    expect(document.activeElement).toBe(here.getByLabelText("Starts"));
  });

  it("puts back what is saved", async () => {
    const here = await form();
    await retype(here.getByLabelText("Ends"), "20:00");

    await userEvent.click(here.getByRole("button", { name: "Put back what’s saved" }));

    expect(here.getByLabelText<HTMLInputElement>("Ends").value).toBe("22:00");
    expect(here.getByText("Everything here is saved.")).toBeDefined();
    expect(here.queryByRole("button", { name: "Put back what’s saved" })).toBeNull();
  });

  it("counts two quick presses of + as two steps, and of a day as two toggles", async () => {
    // Both presses before React renders, as two quick taps can be: each must step from the last.
    const here = await form();
    const more = here.getByRole("button", { name: "15 minutes more" });
    const saturday = here.getByRole("button", { name: "Saturday, plans can use it" });
    act(() => {
      more.click();
      more.click();
      saturday.click();
      saturday.click();
    });

    expect(here.getByLabelText<HTMLInputElement>("Longest step a plan proposes").value).toBe("90");
    expect(here.getByRole("button", { name: "Saturday, plans can use it" })).toBeDefined();
  });

  it("holds the fields while it saves, and says what it is saving", async () => {
    const here = await form(() => new Promise<Response>(() => undefined));
    await userEvent.click(here.getByRole("button", { name: "15 minutes less" }));

    await userEvent.click(here.getByRole("button", { name: "Save" }));

    expect(here.getByRole("button", { name: "Saving…" }).getAttribute("aria-busy")).toBe("true");
    expect(here.getByText("Saving block…")).toBeDefined();
    expect(here.getByLabelText<HTMLInputElement>("Longest step a plan proposes").disabled).toBe(true);
  });

  it("has nothing an automated accessibility check can find, with a refusal on screen", async () => {
    const here = await form(() =>
      Promise.resolve(
        json(422, {
          detail: "The usable day has to be at least 1 hour long.",
          fields: ["day_starts_at", "day_ends_at"],
        }),
      ),
    );
    await retype(here.getByLabelText("Ends"), "06:30");
    await userEvent.click(here.getByRole("button", { name: "Save" }));
    await here.findByText("The usable day has to be at least 1 hour long.");

    await expectNoViolations(document.body);
  });
});

describe("the week under the usable day", () => {
  async function region(): Promise<BoundFunctions<typeof queries>> {
    serve();
    renderAt("/settings");
    await screen.findByRole("heading", { level: 1, name: "Settings" });
    return within(screen.getByRole("region", { name: "Your day and your plans" }));
  }

  function asked(): string[] {
    return fetchMock.mock.calls.map(([input]) => input).filter((input) => input.includes("day_ends_at="));
  }

  it("shows each day as it stands while nothing is changed", async () => {
    const here = await region();

    expect(await here.findByText("This week, with 16h")).toBeDefined();
    expect(here.getByText("1h free of 16h")).toBeDefined();
    expect(here.getByText("15h booked")).toBeDefined();
    expect(here.queryByText(/^Becomes/)).toBeNull();
  });

  it("shows what a change of the hours does to each day, from the server, before Save", async () => {
    const here = await region();
    await here.findByText("This week, with 16h");

    await retype(here.getByLabelText("Ends"), "20:00");

    expect(await here.findByText("This week, 16h → 14h (not saved yet)")).toBeDefined();
    expect(here.getByText("1h free of 16h → 0m of 14h")).toBeDefined();
    expect(here.getByText("Becomes heavy: No margin for anything running late.")).toBeDefined();
    expect(asked().at(-1)).toMatch(/day_starts_at=06:00&day_ends_at=20:00$/);
    expect(patches()).toEqual([]);
  });

  it("leaves the week as it stands for a window the server would refuse", async () => {
    const here = await region();
    await here.findByText("This week, with 16h");

    await retype(here.getByLabelText("Ends"), "06:30");

    await waitFor(() => {
      expect(asked().at(-1)).toMatch(/day_ends_at=06:30$/);
    });
    expect(here.getByText("This week, with 16h")).toBeDefined();
    expect(here.queryByText(/^Becomes/)).toBeNull();
    // The refusal is Save's to say, in the server's words; the week does not say it first.
    expect(here.queryByText("The usable day has to be at least 1 hour long.")).toBeNull();
  });
});
