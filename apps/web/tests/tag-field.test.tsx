/**
 * Tests for the tag field (item 23 of the round).
 *
 * The claims: it suggests the person's own tags as they type and lets the keys pick one; a
 * name that is not theirs yet is said out loud, with the tag it is likely a typo of; and with
 * the tags unknown, it claims nothing.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { TagField, tagStatus } from "../src/week/TagField";
import { expectNoViolations } from "./a11y";

const TAGS = ["faculdade", "saude", "trabalho"];

function Field({ start = "", onEscape = vi.fn() }: { start?: string; onEscape?: () => void }): React.ReactNode {
  const [value, setValue] = useState(start);
  return <TagField value={value} tags={TAGS} onChange={setValue} onEscape={onEscape} />;
}

function input(): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>("combobox", { name: "Tag" });
}

describe("tagStatus", () => {
  it("knows a tag in any spelling the server would store the same way", () => {
    expect(tagStatus("  Faculdade ", TAGS)).toEqual({ isNew: false, closest: null });
  });

  it("finds the tag a typo was meant to be, within two edits", () => {
    expect(tagStatus("facudade", TAGS)).toEqual({ isNew: true, closest: "faculdade" });
    expect(tagStatus("gym", TAGS)).toEqual({ isNew: true, closest: null });
  });

  it("claims nothing while the tags are unknown", () => {
    expect(tagStatus("anything", null)).toEqual({ isNew: false, closest: null });
  });
});

it("suggests the person's tags that hold what was typed", () => {
  render(<Field />);

  fireEvent.change(input(), { target: { value: "ba" } });

  expect(input().getAttribute("aria-expanded")).toBe("true");
  expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["trabalho"]);
});

it("takes a suggestion with the arrows and Enter, without submitting anything", () => {
  render(<Field />);
  fireEvent.change(input(), { target: { value: "a" } });

  fireEvent.keyDown(input(), { key: "ArrowDown" });
  expect(input().getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[0]?.id);

  const enter = fireEvent.keyDown(input(), { key: "Enter" });

  // Prevented, so the form around it does not save half a choice.
  expect(enter).toBe(false);
  expect(input().value).toBe("faculdade");
  expect(input().getAttribute("aria-expanded")).toBe("false");
});

it("says a new name will create a tag, and offers the one it is likely a typo of", () => {
  render(<Field />);

  fireEvent.change(input(), { target: { value: "facudade" } });

  expect(
    screen.getByText("“facudade” isn’t one of your tags yet. Saving creates it. Did you mean “faculdade”?"),
  ).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "use “faculdade”" }));
  expect(input().value).toBe("faculdade");
});

it("closes its list on the first Esc and leaves on the second", () => {
  const onEscape = vi.fn();
  render(<Field onEscape={onEscape} />);
  fireEvent.change(input(), { target: { value: "a" } });

  fireEvent.keyDown(input(), { key: "Escape" });
  expect(input().getAttribute("aria-expanded")).toBe("false");
  expect(onEscape).not.toHaveBeenCalled();

  fireEvent.keyDown(input(), { key: "Escape" });
  expect(onEscape).toHaveBeenCalledOnce();
});

it("has nothing an automated accessibility check can find, with its list open", async () => {
  render(
    <main>
      <h1>Edit</h1>
      <Field />
    </main>,
  );
  fireEvent.change(input(), { target: { value: "a" } });

  await expectNoViolations(document.body);
});
