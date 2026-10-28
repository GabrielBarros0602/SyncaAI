/**
 * Saving in place (item 29 of the round).
 *
 * The claims: a write never takes the week off the screen; the row that was written says
 * "saving…" and is busy until the week has been read again; what the row shows changes only
 * when the server has answered; focus stays on the control that was pressed; and a refusal
 * clears the mark at once, because nothing changed and there is nothing to wait for.
 *
 * The fake server can hold the week's next read, which is what lets the test look at the
 * screen in the moment between the write's answer and the reload's.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { resetClientForTests } from "../src/api/client";
import { setAccessToken } from "../src/api/token";
import type { DayCapacity, Task } from "../src/api/types";
import { SessionProvider } from "../src/auth/session";
import { toLocalDate } from "../src/lib/time";
import { WeekScreen } from "../src/week/WeekScreen";

const SAO_PAULO = "America/Sao_Paulo";
const USABLE = 16 * 60;

const ME = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "gabriel@example.com",
  timezone: SAO_PAULO,
  verified_at: "2026-08-01T12:00:00Z",
};

/** A São Paulo wall time as the instant the API would send. */
function at(local: string): string {
  return new Date(`${local}-03:00`).toISOString();
}

// Later today, so it can be completed, deleted and brought back.
const THESIS: Task = {
  id: "thesis",
  title: "Thesis",
  notes: null,
  start_at: at("2026-08-26T14:00:00"),
  end_at: at("2026-08-26T15:00:00"),
  duration_minutes: 60,
  completed_at: null,
  tag: null,
  items: [],
};

function weekFrom(firstDay: string): DayCapacity[] {
  const [year = 2026, month = 8, day = 24] = firstDay.split("-").map(Number);
  return Array.from({ length: 7 }, (_, index) => ({
    day: toLocalDate(new Date(year, month - 1, day + index)),
    weekday: index + 1,
    total_minutes: 1440,
    usable_minutes: USABLE,
    occupied_minutes: 0,
    free_minutes: USABLE,
    unbooked_minutes: 1440,
    task_count: 0,
    over_capacity: false,
    load: "fine" as const,
  }));
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface Server {
  tasks: Task[];
  /** While set, a read of the tasks waits for `release()`. */
  held: Promise<void> | null;
  /** When set, a DELETE is refused with this status and sentence. */
  refuseDelete?: { status: number; detail: string };
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

let fetchMock: ReturnType<typeof vi.fn<FetchLike>>;

function serve(server: Server): void {
  fetchMock.mockImplementation(async (input, init) => {
    const method = init?.method ?? "GET";
    const [path = "", query = ""] = input.replace("/api/v1", "").split("?");
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;

    if (path === "/auth/refresh") {
      return json(200, { access_token: "a.token", token_type: "bearer", expires_in: 1800 });
    }
    if (path === "/me") return json(200, ME);
    if (path === "/capacity") {
      return json(200, weekFrom(new URLSearchParams(query).get("first_day") ?? ""));
    }
    if (path === "/tasks" && method === "GET") {
      if (server.held !== null) await server.held;
      return json(200, { items: server.tasks, limit: 100, offset: 0 });
    }
    const one = /^\/tasks\/([^/]+)$/.exec(path);
    if (one !== null && method === "PATCH") {
      const { completed } = body as { completed: boolean };
      server.tasks = server.tasks.map((task) =>
        task.id === one[1]
          ? { ...task, completed_at: completed ? at("2026-08-26T12:00:00") : null }
          : task,
      );
      return json(200, server.tasks.find((task) => task.id === one[1]));
    }
    if (one !== null && method === "DELETE") {
      if (server.refuseDelete !== undefined) {
        return json(server.refuseDelete.status, { detail: server.refuseDelete.detail });
      }
      server.tasks = server.tasks.filter((task) => task.id !== one[1]);
      return new Response(null, { status: 204 });
    }
    throw new Error(`no route for ${method} ${path}`);
  });
}

/** Hold the server's next reads of the week until the returned function is called. */
function holdReads(server: Server): () => Promise<void> {
  let release: () => void = () => undefined;
  server.held = new Promise((resolve) => {
    release = resolve;
  });
  return async () => {
    server.held = null;
    await act(async () => {
      release();
      await Promise.resolve();
    });
  };
}

function renderWeek(): void {
  render(
    <SessionProvider>
      <WeekScreen />
    </SessionProvider>,
  );
}

function row(): HTMLElement {
  return document.getElementById("task-thesis") as HTMLElement;
}

function check(): HTMLElement {
  // "Complete Thesis" while open, "Reopen Thesis" once done: the same box either way.
  return screen.getByRole("checkbox", { name: /Thesis$/ });
}

beforeEach(() => {
  resetClientForTests();
  setAccessToken("a.token");
  fetchMock = vi.fn<FetchLike>();
  vi.stubGlobal("fetch", fetchMock);
  // Only Date is faked, so waitFor's timers keep running.
  vi.useFakeTimers({ toFake: ["Date"] });
  // Wednesday 26 August, 12:00 in São Paulo.
  vi.setSystemTime(new Date(at("2026-08-26T12:00:00")));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("keeps the week on screen through a write, and changes the row only on the answer", async () => {
  const server: Server = { tasks: [THESIS], held: null };
  serve(server);
  renderWeek();
  await waitFor(() => {
    expect(check()).toBeDefined();
  });
  const release = holdReads(server);

  fireEvent.click(check());

  // The write has been answered and the week is being read again: the row says so, and still
  // shows what it showed, because the screen has not seen the answer yet.
  await waitFor(() => {
    expect(row().getAttribute("aria-busy")).toBe("true");
  });
  expect(row().textContent).toContain("saving…");
  expect(check().getAttribute("aria-checked")).toBe("false");
  expect(screen.queryByText("checking session")).toBeNull();

  await release();

  await waitFor(() => {
    expect(check().getAttribute("aria-checked")).toBe("true");
  });
  expect(row().getAttribute("aria-busy")).toBe("false");
  expect(row().textContent).not.toContain("saving…");
});

it("leaves focus on the control that was pressed", async () => {
  const server: Server = { tasks: [THESIS], held: null };
  serve(server);
  renderWeek();
  await waitFor(() => {
    expect(check()).toBeDefined();
  });
  const pressed = check();
  pressed.focus();

  fireEvent.click(pressed);
  await waitFor(() => {
    expect(pressed.getAttribute("aria-checked")).toBe("true");
  });

  // The same element, not one like it: the week was read again without being torn down.
  expect(document.activeElement).toBe(pressed);
});

it("drops the mark at once when the server refuses the write", async () => {
  const server: Server = {
    tasks: [THESIS],
    held: null,
    refuseDelete: { status: 409, detail: "This task is being changed elsewhere." },
  };
  serve(server);
  renderWeek();
  await waitFor(() => {
    expect(check()).toBeDefined();
  });

  fireEvent.keyDown(row(), {
    key: "Delete",
  });

  await waitFor(() => {
    expect(screen.getByRole("alert").textContent).toBe("This task is being changed elsewhere.");
  });
  expect(row().getAttribute("aria-busy")).toBe("false");
  expect(row().textContent).not.toContain("saving…");
});
