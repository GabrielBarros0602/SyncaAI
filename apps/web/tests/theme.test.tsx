/**
 * Tests for the theme (settings.dc.html, ADR-0061).
 *
 * It applies as it is chosen, on <html>, where the tokens read it; System is the absence of a
 * choice, and says which way the device is right now. It is kept for the next visit, and the
 * script in index.html, which runs before any module, reads the same key and applies it
 * before the first paint. That script is run here as the page runs it, so a key renamed on
 * one side only fails.
 */
import { act, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";

import html from "../index.html?raw";
import { ThemeChoice } from "../src/settings/ThemeChoice";
import { THEME_KEY } from "../src/ui/theme";
import { expectNoViolations } from "./a11y";
import { setDeviceDark } from "./viewport";

// eslint-disable-next-line no-restricted-globals -- ADR-0061: what the theme keeps is under test.
const kept = (): Storage => localStorage;

afterEach(() => {
  delete document.documentElement.dataset.theme;
  kept().clear();
});

function choice(name: string): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>("radio", { name });
}

it("starts on System when nothing was chosen, and says what System is now", () => {
  setDeviceDark(true);
  render(<ThemeChoice />);

  expect(choice("System").checked).toBe(true);
  expect(screen.getByText(/Follows this device, which is dark right now\./)).toBeDefined();
});

it("says so when the device changes while System is chosen", () => {
  render(<ThemeChoice />);
  expect(screen.getByText(/which is light right now/)).toBeDefined();

  act(() => {
    setDeviceDark(true);
  });

  expect(screen.getByText(/which is dark right now/)).toBeDefined();
});

it("applies a theme as it is chosen, and keeps it for the next visit", async () => {
  render(<ThemeChoice />);

  await userEvent.click(choice("Light"));

  expect(document.documentElement.dataset.theme).toBe("light");
  expect(kept().getItem(THEME_KEY)).toBe("light");
  expect(screen.queryByText(/Follows this device/)).toBeNull();
  expect(screen.getByText("Only this device, and it applies as you tap.")).toBeDefined();
});

it("goes back to following the device on System, keeping no choice", async () => {
  document.documentElement.dataset.theme = "dark";
  kept().setItem(THEME_KEY, "dark");
  render(<ThemeChoice />);
  expect(choice("Dark").checked).toBe(true);

  await userEvent.click(choice("System"));

  expect(document.documentElement.dataset.theme).toBeUndefined();
  expect(kept().getItem(THEME_KEY)).toBeNull();
});

it("is one group of radios, so the arrows and the one tab stop are the browser's", () => {
  render(<ThemeChoice />);

  const group = screen.getByRole("group", { name: "Theme" });
  const radios = screen.getAllByRole<HTMLInputElement>("radio");
  expect(radios.map((radio) => radio.labels?.[0]?.textContent)).toEqual(["System", "Light", "Dark"]);
  expect(new Set(radios.map((radio) => radio.name)).size).toBe(1);
  expect(radios.every((radio) => group.contains(radio))).toBe(true);
});

/** The page's own script, run as the page runs it: before anything else, with no module. */
function runTheScriptInIndexHtml(): void {
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (script === undefined) throw new Error("index.html has no inline script");
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the page's own script, read from the repository.
  (new Function(script) as () => void)();
}

it("is put back by index.html before the first paint, from the same key", () => {
  kept().setItem(THEME_KEY, "light");

  runTheScriptInIndexHtml();

  expect(document.documentElement.dataset.theme).toBe("light");
});

it("leaves the page to the device when nothing, or nothing it knows, was kept", () => {
  kept().setItem(THEME_KEY, "sepia");

  runTheScriptInIndexHtml();

  expect(document.documentElement.dataset.theme).toBeUndefined();
});

it("has nothing an automated accessibility check can find", async () => {
  render(<ThemeChoice />);
  await expectNoViolations(document.body);
});
