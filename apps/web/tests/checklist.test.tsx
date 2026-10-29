/**
 * Tests for the checklist panel (the round's C panel) and the requests its changes become.
 *
 * The claims: each change is the one request the API has for it, and an order sends the whole
 * list; what a change did is said in the panel, and a refusal is shown there with what was
 * typed kept; focus goes where the next press is for once the list arrives; and an order is
 * never built from a list that is still on its way back.
 */
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, resetClientForTests } from "../src/api/client";
import { setAccessToken } from "../src/api/token";
import type { ChecklistItem, Task } from "../src/api/types";
import { ChecklistPanel } from "../src/week/ChecklistPanel";
import { type ChecklistChange, useWeek } from "../src/week/useWeek";
import { expectNoViolations } from "./a11y";

function item(id: string, label: string, position: number, done = false): ChecklistItem {
  return { id, label, position, completed_at: done ? "2026-08-24T12:30:00Z" : null };
}

const OUTLINE = item("a", "Outline", 0);
const SOURCES = item("b", "Sources", 1);
const DRAFT = item("c", "Draft", 2);

function aTask(items: ChecklistItem[]): Task {
  return {
    id: "thesis",
    title: "Thesis",
    notes: null,
    start_at: "2026-08-24T12:00:00Z",
    end_at: "2026-08-24T14:00:00Z",
    duration_minutes: 120,
    completed_at: null,
    tag: null,
    items,
  };
}

type Change = (change: ChecklistChange) => Promise<void>;

/** The panel over `items`; `again` draws it over the list as the next reload brings it. */
function panel(
  items: ChecklistItem[],
  onChange: Change = vi.fn<Change>(() => Promise.resolve()),
  saving = false,
): { onCancel: () => void; again: (next: ChecklistItem[]) => void; container: HTMLElement } {
  const onCancel = vi.fn();
  const view = render(
    <ChecklistPanel task={aTask(items)} saving={saving} onChange={onChange} onCancel={onCancel} />,
  );
  return {
    onCancel,
    container: view.container,
    again: (next) => {
      view.rerender(<ChecklistPanel task={aTask(next)} saving={false} onChange={onChange} onCancel={onCancel} />);
    },
  };
}

function handle(name: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(`^Reorder “${name}”`) });
}

it("ticks and unticks an item, each its own change", () => {
  const onChange = vi.fn<Change>(() => Promise.resolve());
  panel([OUTLINE, item("b", "Sources", 1, true)], onChange);

  expect(screen.getByText("1/2 checked")).toBeDefined();
  fireEvent.click(screen.getByRole("checkbox", { name: "Tick Outline" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Untick Sources" }));

  expect(onChange).toHaveBeenCalledWith({ kind: "tick", itemId: "a", completed: true });
  expect(onChange).toHaveBeenCalledWith({ kind: "tick", itemId: "b", completed: false });
});

it("adds an item, says so, and empties the field once the server has it", async () => {
  const onChange = vi.fn<Change>(() => Promise.resolve());
  panel([OUTLINE], onChange);
  const field = screen.getByLabelText<HTMLInputElement>("Add an item");

  fireEvent.change(field, { target: { value: " Bibliography " } });
  fireEvent.click(screen.getByRole("button", { name: "add" }));

  expect(onChange).toHaveBeenCalledWith({ kind: "add", label: "Bibliography" });
  await waitFor(() => {
    expect(screen.getByRole("status").textContent).toBe("Added “Bibliography”.");
  });
  expect(field.value).toBe("");
});

it("keeps what was typed when the server refuses an item, and says why", async () => {
  panel(
    [OUTLINE],
    vi.fn<Change>(() => Promise.reject(new ApiError(422, "A task holds at most 50 checklist items."))),
  );
  const field = screen.getByLabelText<HTMLInputElement>("Add an item");

  fireEvent.change(field, { target: { value: "One more" } });
  fireEvent.submit(field);

  await waitFor(() => {
    expect(screen.getByRole("alert").textContent).toBe("A task holds at most 50 checklist items.");
  });
  expect(field.value).toBe("One more");
  expect(screen.getByRole("status").textContent).toBe("");
});

describe("renaming", () => {
  it("happens in place, and Enter saves it and gives focus back to the label", async () => {
    const onChange = vi.fn<Change>(() => Promise.resolve());
    panel([OUTLINE, SOURCES], onChange);

    fireEvent.click(screen.getByRole("button", { name: "Rename “Outline”" }));
    const field = screen.getByRole<HTMLInputElement>("textbox", { name: "Rename “Outline”" });
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe("Outline");

    fireEvent.change(field, { target: { value: "Outline, two pages" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith({ kind: "rename", itemId: "a", label: "Outline, two pages" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Rename “Outline”" }));
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("Renamed to “Outline, two pages”.");
    });
  });

  it("saves when focus leaves the field, as the round does", () => {
    const onChange = vi.fn<Change>(() => Promise.resolve());
    panel([OUTLINE], onChange);

    fireEvent.click(screen.getByRole("button", { name: "Rename “Outline”" }));
    const field = screen.getByRole("textbox", { name: "Rename “Outline”" });
    fireEvent.change(field, { target: { value: "Plan" } });
    fireEvent.blur(field);

    expect(onChange).toHaveBeenCalledWith({ kind: "rename", itemId: "a", label: "Plan" });
  });

  it("leaves the label as it was on Esc, and when it is emptied", () => {
    const onChange = vi.fn<Change>(() => Promise.resolve());
    panel([OUTLINE], onChange);

    fireEvent.click(screen.getByRole("button", { name: "Rename “Outline”" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Rename “Outline”" }), { target: { value: "Typo" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Rename “Outline”" }), { key: "Escape" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Rename “Outline”" }));

    fireEvent.click(screen.getByRole("button", { name: "Rename “Outline”" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Rename “Outline”" }), { target: { value: "  " } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Rename “Outline”" }), { key: "Enter" });

    expect(onChange).not.toHaveBeenCalled();
  });
});

it("removes an item and, once the list arrives without it, puts focus on adding", async () => {
  const onChange = vi.fn<Change>(() => Promise.resolve());
  const { again } = panel([OUTLINE, SOURCES], onChange);

  fireEvent.click(screen.getByRole("button", { name: "Remove “Outline”" }));
  expect(onChange).toHaveBeenCalledWith({ kind: "remove", itemId: "a" });
  await waitFor(() => {
    expect(screen.getByRole("status").textContent).toBe("Removed “Outline”.");
  });
  again([SOURCES]);

  expect(document.activeElement).toBe(screen.getByLabelText("Add an item"));
});

describe("ordering", () => {
  it("moves an item with Alt and an arrow, sending the whole list, and keeps focus on it", async () => {
    const onChange = vi.fn<Change>(() => Promise.resolve());
    const { again } = panel([OUTLINE, SOURCES, DRAFT], onChange);
    expect(handle("Sources").getAttribute("aria-label")).toBe("Reorder “Sources”, 2 of 3");

    fireEvent.keyDown(handle("Sources"), { key: "ArrowUp", altKey: true });

    expect(onChange).toHaveBeenCalledWith({ kind: "order", itemIds: ["b", "a", "c"] });
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("Moved “Sources” to 1 of 3.");
    });
    again([{ ...SOURCES, position: 0 }, { ...OUTLINE, position: 1 }, DRAFT]);
    expect(document.activeElement).toBe(handle("Sources"));
    expect(handle("Sources").getAttribute("aria-label")).toBe("Reorder “Sources”, 1 of 3");
  });

  it("does nothing past either end, and nothing on an arrow alone", () => {
    const onChange = vi.fn<Change>(() => Promise.resolve());
    panel([OUTLINE, SOURCES], onChange);

    fireEvent.keyDown(handle("Outline"), { key: "ArrowUp", altKey: true });
    fireEvent.keyDown(handle("Sources"), { key: "ArrowDown", altKey: true });
    fireEvent.keyDown(handle("Outline"), { key: "ArrowDown" });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("is not built from a list that is still on its way back", () => {
    // The row is saving: the list on screen may be the one that write is about to change, and
    // an order built from it would undo the write or repeat the last move.
    const onChange = vi.fn<Change>(() => Promise.resolve());
    panel([OUTLINE, SOURCES], onChange, true);

    fireEvent.keyDown(handle("Outline"), { key: "ArrowDown", altKey: true });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("moves an item to where it is dropped", () => {
    const onChange = vi.fn<Change>(() => Promise.resolve());
    panel([OUTLINE, SOURCES, DRAFT], onChange);
    const [first, , last] = screen.getAllByRole("listitem");
    if (first === undefined || last === undefined) throw new Error("no items");

    fireEvent.dragStart(first, { dataTransfer: { setData: vi.fn(), effectAllowed: "" } });
    fireEvent.dragOver(last);
    fireEvent.drop(last);

    expect(onChange).toHaveBeenCalledWith({ kind: "order", itemIds: ["b", "c", "a"] });
  });

  it("shows the server's refusal when the list changed since it was read", async () => {
    panel(
      [OUTLINE, SOURCES],
      vi.fn<Change>(() =>
        Promise.reject(new ApiError(409, "The checklist changed since it was read. Read it again.")),
      ),
    );

    fireEvent.keyDown(handle("Outline"), { key: "ArrowDown", altKey: true });

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe(
        "The checklist changed since it was read. Read it again.",
      );
    });
  });
});

it("goes back to the row's verbs on Esc in the field that adds", () => {
  const { onCancel } = panel([OUTLINE]);

  fireEvent.keyDown(screen.getByLabelText("Add an item"), { key: "Escape" });

  expect(onCancel).toHaveBeenCalledOnce();
});

it("has nothing an automated accessibility check can find", async () => {
  const { container } = panel([OUTLINE, item("b", "Sources", 1, true)]);

  await expectNoViolations(container);
});

describe("the requests a change becomes", () => {
  type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
  let calls: { method: string; path: string; body: unknown }[];

  beforeEach(() => {
    resetClientForTests();
    setAccessToken("a.token");
    calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchLike>((input, init) => {
        const method = init?.method ?? "GET";
        const path = input.replace("/api/v1", "").split("?")[0] ?? "";
        const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
        if (method !== "GET") calls.push({ method, path, body });
        if (path === "/tasks/thesis/items/gone") {
          return Promise.resolve(new Response(JSON.stringify({ detail: "No such checklist item." }), { status: 404 }));
        }
        const answer = path === "/me" ? { timezone: "America/Sao_Paulo" } : path === "/tasks" ? { items: [] } : [];
        return Promise.resolve(
          method === "DELETE"
            ? new Response(null, { status: 204 })
            : new Response(JSON.stringify(answer), { status: 200, headers: { "Content-Type": "application/json" } }),
        );
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends each change to its own route, and an item already gone as removed", async () => {
    const { result } = renderHook(() => useWeek());

    await act(async () => {
      await result.current.checklist("thesis", { kind: "add", label: "Outline" });
      await result.current.checklist("thesis", { kind: "rename", itemId: "a", label: "Plan" });
      await result.current.checklist("thesis", { kind: "tick", itemId: "a", completed: true });
      await result.current.checklist("thesis", { kind: "remove", itemId: "a" });
      await result.current.checklist("thesis", { kind: "order", itemIds: ["c", "b"] });
      await result.current.checklist("thesis", { kind: "remove", itemId: "gone" });
    });

    expect(calls).toEqual([
      { method: "POST", path: "/tasks/thesis/items", body: { label: "Outline" } },
      { method: "PATCH", path: "/tasks/thesis/items/a", body: { label: "Plan" } },
      { method: "PATCH", path: "/tasks/thesis/items/a", body: { completed: true } },
      { method: "DELETE", path: "/tasks/thesis/items/a", body: undefined },
      { method: "PUT", path: "/tasks/thesis/items/order", body: { item_ids: ["c", "b"] } },
      { method: "DELETE", path: "/tasks/thesis/items/gone", body: undefined },
    ]);
  });
});
