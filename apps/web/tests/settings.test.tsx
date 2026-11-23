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
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

let fetchMock: ReturnType<typeof vi.fn<FetchLike>>;

/** A signed-in person with an empty week; `logout` answers however a test says. */
function serve(logout: () => Promise<Response> = () => Promise.resolve(json(204))): void {
  fetchMock.mockImplementation((input) => {
    const path = input.replace("/api/v1", "").split("?")[0] ?? "";
    if (path === "/auth/refresh") {
      return Promise.resolve(json(200, { access_token: "a.token", token_type: "bearer", expires_in: 1800 }));
    }
    if (path === "/auth/logout") return logout();
    if (path === "/me") return Promise.resolve(json(200, ME));
    if (path === "/capacity") return Promise.resolve(json(200, WEEK.map((day, index) => aDay(day, index + 1))));
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
  serve(
    () =>
      new Promise<Response>((resolve) => {
        endSession = resolve;
      }),
  );
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
  serve(() => Promise.reject(new TypeError("Failed to fetch")));
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
