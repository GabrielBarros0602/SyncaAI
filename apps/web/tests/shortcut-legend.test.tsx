/**
 * Tests for the shortcut legend (ADR-0052).
 *
 * The claims: the keys are in the page where anybody can read them, not only a screen reader;
 * the legend folds, and its button says whether it is folded and what it folds; and a key is
 * read as a key, each one on its own, beside the words for what it does.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";

import { type Shortcut, ShortcutLegend } from "../src/ui/ShortcutLegend";
import { expectNoViolations } from "./a11y";

const SHORTCUTS: Shortcut[] = [
  { keys: ["E"], label: "edit" },
  { keys: ["[", "]"], label: "previous or next week" },
];

function toggle(): HTMLElement {
  return screen.getByRole("button", { name: "keyboard shortcuts" });
}

it("shows every key and what it does, open from the start", () => {
  render(<ShortcutLegend shortcuts={SHORTCUTS} />);

  const legend = screen.getByRole("region", { name: "Keyboard shortcuts" });
  expect(toggle().getAttribute("aria-expanded")).toBe("true");
  expect(within(legend).getByText("edit")).toBeDefined();
  // Each key its own <kbd>, so `[` and `]` are two keys and not a three-character one.
  const week = within(legend).getByText("previous or next week").parentElement as HTMLElement;
  expect([...week.querySelectorAll("kbd")].map((key) => key.textContent)).toEqual(["[", "]"]);
});

it("folds away, and its button names the list it folds", () => {
  render(<ShortcutLegend shortcuts={SHORTCUTS} />);
  const list = toggle().getAttribute("aria-controls") as string;
  expect(document.getElementById(list)?.tagName).toBe("DL");

  fireEvent.click(toggle());

  expect(toggle().getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText("edit")).toBeNull();

  fireEvent.click(toggle());

  expect(toggle().getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByText("edit")).toBeDefined();
});

it("has nothing an automated accessibility check can find, open or folded", async () => {
  render(
    <main>
      <h1>The week</h1>
      <ShortcutLegend shortcuts={SHORTCUTS} />
    </main>,
  );
  await expectNoViolations(document.body);

  fireEvent.click(toggle());

  await expectNoViolations(document.body);
});
