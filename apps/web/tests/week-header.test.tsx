/**
 * Tests for "go to date" in the week's header.
 *
 * The claims: it is a disclosure that says whether it is open; it starts on today and then on
 * the last date gone to; Esc and cancel close it and give focus back to its button; and going
 * hands the date over and closes it. Where the week lands is the screen's, tested with it.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { WeekHeader } from "../src/week/WeekHeader";
import { expectNoViolations } from "./a11y";

function header(onGoToDate = vi.fn<(localDate: string) => void>()): HTMLElement {
  const { container } = render(
    <WeekHeader
      range="24 – 30 Aug 2026"
      offset={0}
      me={null}
      today="2026-08-26"
      onGoTo={() => undefined}
      onGoToDate={onGoToDate}
      onSignOut={() => undefined}
    />,
  );
  return container;
}

function toggle(): HTMLElement {
  return screen.getByRole("button", { name: "go to date" });
}

it("opens on today, says it is open, and puts focus in the field", () => {
  header();

  fireEvent.click(toggle());

  const field = screen.getByLabelText<HTMLInputElement>("Date");
  expect(toggle().getAttribute("aria-expanded")).toBe("true");
  expect(field.value).toBe("2026-08-26");
  expect(document.activeElement).toBe(field);
  expect(field.getAttribute("aria-describedby")).not.toBeNull();
});

it("hands the date over and closes, and starts there the next time", () => {
  const onGoToDate = vi.fn<(localDate: string) => void>();
  header(onGoToDate);

  fireEvent.click(toggle());
  fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-09-10" } });
  fireEvent.click(screen.getByRole("button", { name: "go" }));

  expect(onGoToDate).toHaveBeenCalledWith("2026-09-10");
  expect(screen.queryByLabelText("Date")).toBeNull();
  expect(toggle().getAttribute("aria-expanded")).toBe("false");

  fireEvent.click(toggle());
  expect(screen.getByLabelText<HTMLInputElement>("Date").value).toBe("2026-09-10");
});

it("goes nowhere with a date half typed", () => {
  const onGoToDate = vi.fn<(localDate: string) => void>();
  header(onGoToDate);

  fireEvent.click(toggle());
  fireEvent.change(screen.getByLabelText("Date"), { target: { value: "" } });
  fireEvent.submit(screen.getByLabelText("Date"));

  expect(onGoToDate).not.toHaveBeenCalled();
});

it("closes on Esc and on cancel, giving focus back to its button", () => {
  const onGoToDate = vi.fn<(localDate: string) => void>();
  header(onGoToDate);

  fireEvent.click(toggle());
  fireEvent.keyDown(screen.getByLabelText("Date"), { key: "Escape" });
  expect(screen.queryByLabelText("Date")).toBeNull();
  expect(document.activeElement).toBe(toggle());

  fireEvent.click(toggle());
  fireEvent.click(screen.getByRole("button", { name: "cancel" }));
  expect(screen.queryByLabelText("Date")).toBeNull();
  expect(document.activeElement).toBe(toggle());
  expect(onGoToDate).not.toHaveBeenCalled();
});

it("has nothing an automated accessibility check can find, open", async () => {
  const container = header();
  fireEvent.click(toggle());

  await expectNoViolations(container);
});
