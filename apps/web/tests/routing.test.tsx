/**
 * Tests for moving between pages (ADR-0052).
 *
 * Two claims. An address that names no page lands on one, so a stale bookmark is never an
 * empty screen. And a change of page moves focus to the new page's heading, never on the
 * first render: the page a person opens starts with nothing focused.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router";

import { resetClientForTests } from "../src/api/client";
import { App } from "../src/App";
import { SessionProvider } from "../src/auth/session";
import { RouteFocus } from "../src/ui/RouteFocus";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

let fetchMock: ReturnType<typeof vi.fn<FetchLike>>;

beforeEach(() => {
  resetClientForTests();
  fetchMock = vi.fn<FetchLike>(() =>
    Promise.resolve(
      new Response(JSON.stringify({ detail: "Not authenticated." }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function Where(): React.ReactNode {
  return <output aria-label="path">{useLocation().pathname}</output>;
}

it("lands an address that names no page on the first page", async () => {
  render(
    <MemoryRouter initialEntries={["/somewhere-that-is-not-a-page"]}>
      <SessionProvider>
        <App />
        <Where />
      </SessionProvider>
    </MemoryRouter>,
  );

  expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeDefined();
  expect(screen.getByLabelText("path").textContent).toBe("/");
});

it("keeps the confirmation link's path for the screen it opened", async () => {
  render(
    <MemoryRouter initialEntries={["/verify"]}>
      <SessionProvider>
        <App />
        <Where />
      </SessionProvider>
    </MemoryRouter>,
  );

  expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeDefined();
  expect(screen.getByLabelText("path").textContent).toBe("/verify");
});

function Pages(): React.ReactNode {
  return (
    <MemoryRouter initialEntries={["/"]}>
      <RouteFocus />
      <Routes>
        <Route
          path="/"
          element={
            <main>
              <h1>The week</h1>
              <Link to="/settings">Settings</Link>
            </main>
          }
        />
        <Route
          path="/settings"
          element={
            <main>
              <h1>Settings</h1>
            </main>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

it("focuses nothing on the page a person opens", () => {
  render(<Pages />);

  expect(document.activeElement).toBe(document.body);
});

it("moves focus to the new page's heading when the page changes", async () => {
  const scrolled = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  render(<Pages />);

  await userEvent.click(screen.getByRole("link", { name: "Settings" }));

  const heading = screen.getByRole("heading", { name: "Settings" });
  await waitFor(() => {
    expect(document.activeElement).toBe(heading);
  });
  // Focusable by script only: the heading is not added to the Tab order.
  expect(heading.getAttribute("tabindex")).toBe("-1");
  expect(scrolled).toHaveBeenCalledWith(0, 0);
});
