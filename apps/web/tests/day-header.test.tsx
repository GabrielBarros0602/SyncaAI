/**
 * Tests for the top of the screen below 1100px (day-phone.dc.html).
 *
 * What they hold it to: the controls each band draws and their names, the zone said as the
 * drawing says it, Today saying whether today is on screen, and "go to date" as a sheet that
 * puts focus where the person is going. Where it all sits is measured in a browser.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Me } from "../src/api/types";
import { DayHeader } from "../src/week/DayHeader";
import { expectNoViolations } from "./a11y";

const ME: Me = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "gabriel@example.com",
  timezone: "America/Sao_Paulo",
  verified_at: "2026-08-01T12:00:00Z",
};

const AUGUST = ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30"];
const LISBON_AUTUMN = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"];

interface Options {
  layout?: "day" | "beside";
  me?: Me | null;
  days?: string[];
  shown?: string;
  onToday?: boolean;
  onBack?: () => void;
  onGoToDate?: (localDate: string) => void;
}

function header({
  layout = "day",
  me = ME,
  days = AUGUST,
  shown = "2026-08-26",
  onToday = true,
  onBack = () => undefined,
  onGoToDate = () => undefined,
}: Options = {}): HTMLElement {
  const { container } = render(
    <DayHeader
      layout={layout}
      range="24 – 30 Aug 2026"
      offset={0}
      me={me}
      days={days}
      shown={shown}
      today="2026-08-26"
      onToday={onToday}
      onGoTo={() => undefined}
      onBack={onBack}
      onGoToDate={onGoToDate}
      onSignOut={() => undefined}
    >
      <ol aria-label="Week at a glance" />
    </DayHeader>,
  );
  return container;
}

describe("below 640px", () => {
  it("draws the name, Today and Menu, then the week between its arrows, then the glance", () => {
    header();

    const banner = screen.getByRole("banner");
    expect(within(banner).getByRole("button", { name: "Today" })).toBeDefined();
    expect(within(banner).getByRole("button", { name: "Menu" })).toBeDefined();
    const weeks = within(banner).getByRole("navigation", { name: "Weeks" });
    expect(
      within(weeks)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label") ?? button.textContent),
    ).toEqual(["Previous week", "go to date", "Next week"]);
    expect(within(weeks).getByRole("heading", { level: 1 }).textContent).toBe("24 – 30 Aug 2026");
    expect(within(banner).getByRole("list", { name: "Week at a glance" })).toBeDefined();
  });

  it("says the zone under the glance, with its offset", () => {
    header();

    expect(screen.getByText("Times in America/Sao_Paulo (UTC-3).")).toBeDefined();
  });

  it("says when the clocks change, in a week where they do", () => {
    header({ me: { ...ME, timezone: "Europe/Lisbon" }, days: LISBON_AUTUMN, shown: "2026-10-22" });

    expect(
      screen.getByText("Times in Europe/Lisbon. Clocks go back an hour at 02:00 on Sunday 25."),
    ).toBeDefined();
  });

  it("says no zone and offers no Menu before the first week has said who is signed in", () => {
    header({ me: null });

    expect(screen.queryByText(/^Times in/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Menu" })).toBeNull();
  });
});

describe("from 640px", () => {
  it("draws one line, with the zone shortened to its offset and no glance", () => {
    header({ layout: "beside", me: { ...ME, timezone: "Europe/Lisbon" }, days: LISBON_AUTUMN, shown: "2026-10-22" });

    const banner = screen.getByRole("banner");
    expect(within(banner).getByText("Europe/Lisbon · UTC+1")).toBeDefined();
    expect(within(banner).getByRole("button", { name: "go to date" })).toBeDefined();
    expect(within(banner).queryByRole("list", { name: "Week at a glance" })).toBeNull();
    // The arrows still stand either side of the range.
    expect(within(within(banner).getByRole("navigation", { name: "Weeks" })).getByRole("heading").textContent).toBe(
      "24 – 30 Aug 2026",
    );
  });

  it("reads the offset at the day on screen, so the day after the change says the new one", () => {
    header({ layout: "beside", me: { ...ME, timezone: "Europe/Lisbon" }, days: LISBON_AUTUMN, shown: "2026-10-26" });

    expect(screen.getByText("Europe/Lisbon · UTC+0")).toBeDefined();
  });
});

describe("Today", () => {
  it("is pressed while today is on screen, and goes there when it is not", () => {
    const onBack = vi.fn<() => void>();
    header({ onToday: false, onBack });

    const today = screen.getByRole("button", { name: "Today" });
    expect(today.getAttribute("aria-pressed")).toBe("false");
    expect(today.getAttribute("aria-keyshortcuts")).toBe("T");
    fireEvent.click(today);
    expect(onBack).toHaveBeenCalledOnce();
  });
});

describe("go to date", () => {
  function open(): HTMLElement {
    fireEvent.click(screen.getByRole("button", { name: "go to date" }));
    return screen.getByRole("dialog", { name: "Go to date" });
  }

  it("opens a sheet on today, with focus in the field", () => {
    header();
    const sheet = open();

    const field = within(sheet).getByLabelText<HTMLInputElement>("Date");
    expect(field.value).toBe("2026-08-26");
    expect(document.activeElement).toBe(field);
    expect(screen.getByRole("button", { name: "go to date" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("goes to the date asked for, and leaves focus to wherever that is", () => {
    const onGoToDate = vi.fn<(localDate: string) => void>();
    header({ onGoToDate });
    const sheet = open();

    fireEvent.change(within(sheet).getByLabelText("Date"), { target: { value: "2026-09-10" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "go" }));

    expect(onGoToDate).toHaveBeenCalledWith("2026-09-10");
    expect((sheet as HTMLDialogElement).open).toBe(false);
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "go to date" }));
  });

  it("does not go anywhere on a date half typed", () => {
    const onGoToDate = vi.fn<(localDate: string) => void>();
    header({ onGoToDate });
    const sheet = open();

    fireEvent.change(within(sheet).getByLabelText("Date"), { target: { value: "" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "go" }));

    expect(onGoToDate).not.toHaveBeenCalled();
  });

  it("puts focus back on its button when cancelled", () => {
    header();
    const sheet = open();

    fireEvent.click(within(sheet).getByRole("button", { name: "cancel" }));

    expect((sheet as HTMLDialogElement).open).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "go to date" }));
  });

  it("goes back to this week from the sheet", () => {
    const onBack = vi.fn<() => void>();
    header({ onBack });
    const sheet = open();

    fireEvent.click(within(sheet).getByRole("button", { name: "back to this week" }));

    expect(onBack).toHaveBeenCalledOnce();
    expect((sheet as HTMLDialogElement).open).toBe(false);
  });

  it("starts from the last date gone to the next time it opens", () => {
    header();
    let sheet = open();
    fireEvent.change(within(sheet).getByLabelText("Date"), { target: { value: "2026-09-10" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "go" }));

    sheet = open();

    expect(within(sheet).getByLabelText<HTMLInputElement>("Date").value).toBe("2026-09-10");
  });
});

describe("the automated accessibility check", () => {
  it.each([["day" as const], ["beside" as const]])("passes the %s header, and its sheet open", async (layout) => {
    const container = header({ layout });
    await expectNoViolations(container);

    fireEvent.click(screen.getByRole("button", { name: "go to date" }));
    await expectNoViolations(container);
  });
});
