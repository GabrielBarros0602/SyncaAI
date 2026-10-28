/**
 * Tests for the status region (ADR-0052; #12 of the round's inventory).
 *
 * The claims: it is always in the page, so the first notice is announced; a notice lasts nine
 * seconds of being unattended, never less, and never while somebody is pointing at it or has
 * focus in it; work in progress does not time out; and Ctrl+Z undoes, except inside a field,
 * where it belongs to the text.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { NOTICE_MS, type Notice, StatusRegion } from "../src/ui/StatusRegion";
import { expectNoViolations } from "./a11y";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const DELETED: Notice = { id: "1:deleted", text: "Deleted “Thesis” from Thu 27." };

function region(): HTMLElement {
  return screen.getByRole("status");
}

it("stays in the page, empty, with nothing to say", () => {
  render(<StatusRegion notice={null} onExpire={vi.fn()} />);

  expect(region().textContent).toBe("");
  expect(region().getAttribute("aria-live")).toBe("polite");
});

it("lets a notice go after nine seconds, and not a moment before", () => {
  const onExpire = vi.fn();
  render(<StatusRegion notice={DELETED} onExpire={onExpire} />);

  act(() => {
    vi.advanceTimersByTime(NOTICE_MS - 1);
  });
  expect(onExpire).not.toHaveBeenCalled();

  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(onExpire).toHaveBeenCalledOnce();
});

it("stops the clock while the pointer is over it, and resumes with the time left", () => {
  const onExpire = vi.fn();
  render(<StatusRegion notice={DELETED} onExpire={onExpire} />);
  act(() => {
    vi.advanceTimersByTime(4000);
  });

  fireEvent.mouseEnter(region());
  act(() => {
    vi.advanceTimersByTime(60_000);
  });
  expect(onExpire).not.toHaveBeenCalled();

  fireEvent.mouseLeave(region());
  act(() => {
    vi.advanceTimersByTime(NOTICE_MS - 4000 - 1);
  });
  expect(onExpire).not.toHaveBeenCalled();
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(onExpire).toHaveBeenCalledOnce();
});

it("stops the clock while focus is inside it", () => {
  const onExpire = vi.fn();
  render(
    <StatusRegion notice={{ ...DELETED, action: { label: "undo", run: vi.fn() } }} onExpire={onExpire} />,
  );

  act(() => {
    screen.getByRole("button", { name: "undo" }).focus();
  });
  act(() => {
    vi.advanceTimersByTime(60_000);
  });

  expect(onExpire).not.toHaveBeenCalled();
});

it("does not restart the clock on a re-render, only for a new notice", () => {
  const onExpire = vi.fn();
  const { rerender } = render(<StatusRegion notice={DELETED} onExpire={onExpire} />);
  act(() => {
    vi.advanceTimersByTime(6000);
  });

  // The same notice, rebuilt by the screen's next render, with a new callback.
  rerender(<StatusRegion notice={{ ...DELETED }} onExpire={onExpire} />);
  act(() => {
    vi.advanceTimersByTime(NOTICE_MS - 6000);
  });
  expect(onExpire).toHaveBeenCalledOnce();

  rerender(<StatusRegion notice={{ id: "2:deleted", text: "Deleted “Notes”." }} onExpire={onExpire} />);
  act(() => {
    vi.advanceTimersByTime(NOTICE_MS - 1);
  });
  expect(onExpire).toHaveBeenCalledOnce();
});

it("never times out work in progress, and offers nothing to press during it", () => {
  const onExpire = vi.fn();
  render(
    <StatusRegion
      notice={{ id: "1:restoring", text: "Restoring “Thesis”…", busy: true, action: { label: "undo", run: vi.fn() } }}
      onExpire={onExpire}
    />,
  );

  act(() => {
    vi.advanceTimersByTime(60_000);
  });

  expect(onExpire).not.toHaveBeenCalled();
  expect(region().getAttribute("aria-busy")).toBe("true");
  expect(screen.queryByRole("button")).toBeNull();
});

it("undoes on Ctrl+Z and on ⌘Z, but not inside a field", () => {
  const run = vi.fn();
  render(
    <>
      <input aria-label="Note" />
      <StatusRegion
        notice={{ ...DELETED, action: { label: "undo", run, undoKey: true } }}
        onExpire={vi.fn()}
      />
    </>,
  );

  fireEvent.keyDown(window, { key: "z", ctrlKey: true });
  fireEvent.keyDown(window, { key: "z", metaKey: true });
  expect(run).toHaveBeenCalledTimes(2);

  fireEvent.keyDown(screen.getByLabelText("Note"), { key: "z", ctrlKey: true });
  expect(run).toHaveBeenCalledTimes(2);

  expect(screen.getByRole("button", { name: "undo" }).getAttribute("aria-keyshortcuts")).toBe(
    "Control+Z",
  );
});

it("leaves Ctrl+Z alone for an action that is not an undo", () => {
  const run = vi.fn();
  render(<StatusRegion notice={{ ...DELETED, action: { label: "review", run } }} onExpire={vi.fn()} />);

  fireEvent.keyDown(window, { key: "z", ctrlKey: true });

  expect(run).not.toHaveBeenCalled();
});

it("has nothing an automated accessibility check can find", async () => {
  vi.useRealTimers();
  render(
    <main>
      <h1>The week</h1>
      <StatusRegion
        notice={{ ...DELETED, action: { label: "undo", run: vi.fn(), undoKey: true } }}
        onExpire={vi.fn()}
      />
    </main>,
  );

  await expectNoViolations(document.body);
});
