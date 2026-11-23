/**
 * Tests for the Menu (ADR-0052).
 *
 * What a person needs from it: to learn who is signed in and which zone their days are read
 * in, to reach Settings, to sign out of this browser and be told when that did not happen, and
 * to land back on the button that opened it however it closed, so the keyboard does not lose
 * its place.
 */
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { expect, it, vi } from "vitest";

import { ApiError } from "../src/api/client";
import { Menu } from "../src/ui/Menu";
import { expectNoViolations } from "./a11y";

function Where(): React.ReactNode {
  return <output aria-label="path">{useLocation().pathname}</output>;
}

function renderMenu(
  onSignOut: () => Promise<void> = vi.fn(() => Promise.resolve()),
  at = "/",
): void {
  render(
    <MemoryRouter initialEntries={[at]}>
      <main>
        <h1>The week</h1>
        <Menu email="gabriel@example.com" timezone="Europe/Lisbon" onSignOut={onSignOut} />
      </main>
      <Where />
    </MemoryRouter>,
  );
}

function dialog(): HTMLDialogElement {
  return screen.getByRole<HTMLDialogElement>("dialog", { hidden: true });
}

it("opens as a dialog named Menu, saying who is signed in and in which zone", async () => {
  renderMenu();
  const button = screen.getByRole("button", { name: "Menu" });
  expect(button.getAttribute("aria-expanded")).toBe("false");

  await userEvent.click(button);

  expect(dialog().open).toBe(true);
  expect(screen.getByRole("dialog", { name: "Menu" })).toBeDefined();
  expect(button.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByText("gabriel@example.com")).toBeDefined();
  expect(screen.getByText("Europe/Lisbon")).toBeDefined();
});

it("closes on Close and puts focus back on the button", async () => {
  renderMenu();
  const button = screen.getByRole("button", { name: "Menu" });
  await userEvent.click(button);

  await userEvent.click(screen.getByRole("button", { name: "Close" }));

  expect(dialog().open).toBe(false);
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(button);
});

it("puts focus back on the button when the browser closes it, as Esc does", async () => {
  renderMenu();
  const button = screen.getByRole("button", { name: "Menu" });
  await userEvent.click(button);

  dialog().close();

  expect(document.activeElement).toBe(button);
});

it("closes on a click outside it, and not on one inside", async () => {
  renderMenu();
  await userEvent.click(screen.getByRole("button", { name: "Menu" }));

  await userEvent.click(screen.getByText("Europe/Lisbon"));
  expect(dialog().open).toBe(true);

  await userEvent.click(dialog());
  expect(dialog().open).toBe(false);
});

it("leads to Settings, and says so there", async () => {
  renderMenu();
  await userEvent.click(screen.getByRole("button", { name: "Menu" }));
  const settings = screen.getByRole("button", { name: "Settings" });
  expect(settings.getAttribute("aria-current")).toBeNull();

  await userEvent.click(settings);

  expect(screen.getByLabelText("path").textContent).toBe("/settings");
  expect(dialog().open).toBe(false);
  // The router puts focus on the page's heading; the button does not take it back.
  expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "Menu" }));
});

it("on the settings page, marks Settings as the page and only closes", async () => {
  renderMenu(undefined, "/settings");
  await userEvent.click(screen.getByRole("button", { name: "Menu" }));
  const settings = screen.getByRole("button", { name: "Settings" });

  expect(settings.getAttribute("aria-current")).toBe("page");
  await userEvent.click(settings);

  expect(dialog().open).toBe(false);
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Menu" }));
});

it("stays open while it signs out, saying so", async () => {
  // Never answers, so what is asserted is the wait.
  const onSignOut = vi.fn(() => new Promise<void>(() => undefined));
  renderMenu(onSignOut);
  await userEvent.click(screen.getByRole("button", { name: "Menu" }));

  await userEvent.click(screen.getByRole("button", { name: "Sign out of this browser" }));

  expect(onSignOut).toHaveBeenCalledOnce();
  expect(dialog().open).toBe(true);
  const busy = screen.getByRole("button", { name: "Signing out…" });
  expect(busy.getAttribute("aria-busy")).toBe("true");
});

it("says so when the server did not sign this browser out", async () => {
  renderMenu(() => Promise.reject(new TypeError("Failed to fetch")));
  await userEvent.click(screen.getByRole("button", { name: "Menu" }));

  await userEvent.click(screen.getByRole("button", { name: "Sign out of this browser" }));

  expect(await screen.findByText("Couldn’t reach the server. You’re still signed in here.")).toBeDefined();
  expect(dialog().open).toBe(true);
  expect(screen.getByRole("button", { name: "Sign out of this browser" })).toBeDefined();
});

it("says the server did not sign it out, never the status line it answered with", async () => {
  // A dev proxy answers 500 with no sentence when the API behind it is down; the client then
  // carries "Internal Server Error" as the detail.
  renderMenu(() => Promise.reject(new ApiError(500, "Internal Server Error")));
  await userEvent.click(screen.getByRole("button", { name: "Menu" }));

  await userEvent.click(screen.getByRole("button", { name: "Sign out of this browser" }));

  expect(
    await screen.findByText("The server didn’t sign this browser out. You’re still signed in here."),
  ).toBeDefined();
});

it("has nothing an automated accessibility check can find, open or closed", async () => {
  renderMenu();
  await expectNoViolations(document.body);

  await userEvent.click(screen.getByRole("button", { name: "Menu" }));
  await expectNoViolations(document.body);
});
