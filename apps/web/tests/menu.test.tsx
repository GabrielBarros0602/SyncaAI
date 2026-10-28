/**
 * Tests for the Menu (ADR-0052).
 *
 * What a person needs from it: to learn who is signed in and which zone their days are read
 * in, to sign out of this browser, and to land back on the button that opened it however it
 * closed, so the keyboard does not lose its place.
 */
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { Menu } from "../src/ui/Menu";
import { expectNoViolations } from "./a11y";

function renderMenu(onSignOut = vi.fn()): void {
  render(
    <main>
      <h1>The week</h1>
      <Menu email="gabriel@example.com" timezone="Europe/Lisbon" onSignOut={onSignOut} />
    </main>,
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

it("signs out of this browser, closing itself first", async () => {
  const onSignOut = vi.fn();
  renderMenu(onSignOut);
  await userEvent.click(screen.getByRole("button", { name: "Menu" }));

  await userEvent.click(screen.getByRole("button", { name: "Sign out of this browser" }));

  expect(onSignOut).toHaveBeenCalledOnce();
  expect(dialog().open).toBe(false);
});

it("has nothing an automated accessibility check can find, open or closed", async () => {
  renderMenu();
  await expectNoViolations(document.body);

  await userEvent.click(screen.getByRole("button", { name: "Menu" }));
  await expectNoViolations(document.body);
});
