/**
 * Tests for the new task dialog (the round's create flow).
 *
 * The claims: it opens on the day it was asked for, with a time that can still be taken; it
 * says what is wrong beside the field, and where focus should go; the server's refusal lands
 * at the time and keeps everything typed; a checklist can be written before the task exists;
 * the sentence it hands back names the day, the time and any tag it creates; and closing
 * without creating puts focus back where it came from.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ApiError } from "../src/api/client";
import type { DayCapacity, NewTask } from "../src/api/types";
import { NewTaskDialog } from "../src/week/NewTaskDialog";
import { expectNoViolations } from "./a11y";

const SAO_PAULO = "America/Sao_Paulo";

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

const WEEK = [
  aDay("2026-08-24", 1),
  aDay("2026-08-25", 2),
  aDay("2026-08-26", 3),
  aDay("2026-08-27", 4),
];

type Create = (task: NewTask, sentence: string) => Promise<void>;

function open(
  startDay: string,
  onCreate: Create = vi.fn<Create>(() => Promise.resolve()),
  onClose = vi.fn(),
): void {
  render(
    <>
      <button type="button">+ new task</button>
      <NewTaskDialog
        startDay={startDay}
        days={WEEK}
        timezone={SAO_PAULO}
        onCreate={onCreate}
        onClose={onClose}
      />
    </>,
  );
}

beforeEach(() => {
  // The tags are read when it opens; these tests give it the person's one tag.
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify([{ id: "g1", name: "faculdade" }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ),
  );
  vi.useFakeTimers({ toFake: ["Date"] });
  // Wednesday 26 August, 14:20 in São Paulo.
  vi.setSystemTime(new Date("2026-08-26T17:20:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("opens on the day asked for, at the next half hour that can still be taken", () => {
  open("2026-08-26");

  expect(screen.getByRole("dialog", { name: "New task" })).toBeDefined();
  expect(screen.getByLabelText<HTMLSelectElement>("Day").value).toBe("2026-08-26");
  expect(screen.getByLabelText<HTMLInputElement>("Time").value).toBe("14:30");
  expect(screen.getByText("Not before 14:20 today. 24-hour time, America/Sao_Paulo.")).toBeDefined();
  expect(document.activeElement).toBe(screen.getByLabelText("Title"));
});

it("marks the days that have gone and today among the days it offers", () => {
  open("2026-08-27");

  const days = screen.getAllByRole("option").map((option) => option.textContent);
  expect(days).toEqual(["Mon 24 Aug (past)", "Tue 25 Aug (past)", "Wed 26 Aug (today)", "Thu 27 Aug"]);
  expect(screen.getByLabelText<HTMLInputElement>("Time").value).toBe("09:00");
});

it("says what is wrong beside each field, and takes focus to the first", () => {
  const onCreate = vi.fn<Create>(() => Promise.resolve());
  open("2026-08-27", onCreate);
  fireEvent.change(screen.getByLabelText("Duration"), { target: { value: "forever" } });

  fireEvent.click(screen.getByRole("button", { name: "save" }));

  expect(screen.getByText("A task needs a title.")).toBeDefined();
  expect(screen.getByText("Between 1m and 24h, like 2h30.")).toBeDefined();
  expect(document.activeElement).toBe(screen.getByLabelText("Title"));
  expect(onCreate).not.toHaveBeenCalled();
});

it("creates with the day, time and checklist it was given, and names them back", async () => {
  const onCreate = vi.fn<Create>(() => Promise.resolve());
  open("2026-08-27", onCreate);
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Read chapter 2" } });
  fireEvent.change(screen.getByLabelText("Time"), { target: { value: "15:00" } });
  fireEvent.change(screen.getByLabelText("Duration"), { target: { value: "1h30" } });
  fireEvent.change(screen.getByLabelText("New item"), { target: { value: "Notes" } });
  // Enter adds the item; it does not save the task half written.
  fireEvent.keyDown(screen.getByLabelText("New item"), { key: "Enter" });
  fireEvent.change(screen.getByLabelText("New item"), { target: { value: "Summary" } });
  fireEvent.click(screen.getByRole("button", { name: "add" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove “Notes”" }));
  expect(onCreate).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "save" }));

  expect(onCreate).toHaveBeenCalledWith(
    {
      title: "Read chapter 2",
      // 15:00 on Thursday in São Paulo is 18:00 UTC.
      start_at: "2026-08-27T18:00:00.000Z",
      duration_minutes: 90,
      items: [{ label: "Summary" }],
    },
    "Added “Read chapter 2” to Thu 27, 15:00.",
  );
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "saving…" })).toBeDefined();
  });
});

it("says a tag it creates, on the button and in the sentence", async () => {
  const onCreate = vi.fn<Create>(() => Promise.resolve());
  open("2026-08-27", onCreate);
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Gym" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Tag" }), { target: { value: "Saude" } });

  await waitFor(() => {
    expect(screen.getByRole("button", { name: "save and create tag “saude”" })).toBeDefined();
  });
  fireEvent.click(screen.getByRole("button", { name: "save and create tag “saude”" }));

  expect(onCreate).toHaveBeenCalledWith(
    expect.objectContaining({ tag: "saude" }),
    "Added “Gym” to Thu 27, 09:00. Created the tag “saude”.",
  );
});

it("shows the server's refusal at the time, announced, and keeps what was typed", async () => {
  const onCreate = vi.fn<Create>(() =>
    Promise.reject(new ApiError(409, "That time is already taken by another task.")),
  );
  open("2026-08-27", onCreate);
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Advisor" } });

  fireEvent.click(screen.getByRole("button", { name: "save" }));

  await waitFor(() => {
    expect(screen.getByRole("alert").textContent).toBe("That time is already taken by another task.");
  });
  expect(screen.getByLabelText("Time").getAttribute("aria-invalid")).toBe("true");
  expect(document.activeElement).toBe(screen.getByLabelText("Time"));
  expect(screen.getByLabelText<HTMLInputElement>("Title").value).toBe("Advisor");
  expect(screen.getByRole("button", { name: "save" })).toBeDefined();
});

it("puts focus back where it was opened from when it closes without creating", () => {
  const onClose = vi.fn();
  render(<button type="button">+ new task</button>);
  const opener = screen.getByRole("button", { name: "+ new task" });
  opener.focus();
  render(
    <NewTaskDialog
      startDay="2026-08-27"
      days={WEEK}
      timezone={SAO_PAULO}
      onCreate={() => Promise.resolve()}
      onClose={onClose}
    />,
  );

  act(() => {
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));
  });

  expect(onClose).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(opener);
});

it("has nothing an automated accessibility check can find", async () => {
  vi.useRealTimers();
  open("2026-08-27");

  await expectNoViolations(document.body);
});
