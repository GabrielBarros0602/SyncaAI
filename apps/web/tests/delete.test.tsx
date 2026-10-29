/**
 * Deleting from the week, against a server that keeps state.
 *
 * The fake below answers the way the API does: DELETE removes the row and answers 204 with no
 * body, a DELETE of something already gone answers 404 (ADR-0016 makes "absent" and "not yours"
 * the same answer), and POST creates a task under a new id. Asserting against what it was
 * asked, rather than against what the screen happens to render, is what keeps these about the
 * requests that leave the browser.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

function aTask(id: string, start: string, end: string, over: Partial<Task> = {}): Task {
  const startAt = at(start);
  const endAt = at(end);
  return {
    id,
    title: id,
    notes: null,
    start_at: startAt,
    end_at: endAt,
    duration_minutes: (Date.parse(endAt) - Date.parse(startAt)) / 60_000,
    completed_at: null,
    tag: null,
    items: [],
    ...over,
  };
}

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

interface Call {
  method: string;
  path: string;
  body: unknown;
}

/** What the fake server holds, and every request it was sent. */
interface Server {
  tasks: Task[];
  calls: Call[];
  /** When set, a POST is refused with this status and sentence. */
  refuseCreate?: { status: number; detail: string };
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

let fetchMock: ReturnType<typeof vi.fn<FetchLike>>;
let created = 0;

function serve(server: Server): void {
  fetchMock.mockImplementation((input, init) => {
    const method = init?.method ?? "GET";
    const [path = "", query = ""] = input.replace("/api/v1", "").split("?");
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    server.calls.push({ method, path, body });

    if (path === "/auth/refresh") {
      return Promise.resolve(json(200, { access_token: "a.token", token_type: "bearer", expires_in: 1800 }));
    }
    if (path === "/me") return Promise.resolve(json(200, ME));
    if (path === "/capacity") {
      return Promise.resolve(json(200, weekFrom(new URLSearchParams(query).get("first_day") ?? "")));
    }
    if (path === "/tasks" && method === "GET") {
      return Promise.resolve(json(200, { items: server.tasks, limit: 100, offset: 0 }));
    }
    if (path === "/tasks" && method === "POST") {
      if (server.refuseCreate !== undefined) {
        return Promise.resolve(json(server.refuseCreate.status, { detail: server.refuseCreate.detail }));
      }
      // A new row, so a new id: the restored task is never the one that was deleted.
      const sent = body as { title: string; start_at: string; duration_minutes: number };
      created += 1;
      const start = Date.parse(sent.start_at);
      const task: Task = {
        id: `created-${String(created)}`,
        title: sent.title,
        notes: null,
        start_at: sent.start_at,
        end_at: new Date(start + sent.duration_minutes * 60_000).toISOString(),
        duration_minutes: sent.duration_minutes,
        completed_at: null,
        tag: null,
        items: [],
      };
      server.tasks = [...server.tasks, task];
      return Promise.resolve(json(201, task));
    }
    const one = /^\/tasks\/([^/]+)$/.exec(path);
    if (one !== null && method === "DELETE") {
      const id = one[1];
      const existed = server.tasks.some((task) => task.id === id);
      server.tasks = server.tasks.filter((task) => task.id !== id);
      return Promise.resolve(existed ? new Response(null, { status: 204 }) : json(404, { detail: "Not Found" }));
    }
    throw new Error(`no route for ${method} ${path}`);
  });
}

function deletes(server: Server): Call[] {
  return server.calls.filter((call) => call.method === "DELETE");
}

function renderWeek(): void {
  render(
    <SessionProvider>
      <WeekScreen />
    </SessionProvider>,
  );
}

/** The row whose title is `text`: a cell of the week's grid, and its own disclosure. */
function row(text: string, expanded = false): HTMLElement | null {
  return (
    screen
      .queryAllByRole("gridcell", { expanded })
      .find((cell) => within(cell).queryByText(text) !== null) ?? null
  );
}

function title(text: string): HTMLElement {
  const found = row(text);
  if (found === null) throw new Error(`no shut row titled ${text}`);
  return found;
}

async function openRow(text: string): Promise<void> {
  await waitFor(() => {
    expect(title(text)).toBeDefined();
  });
  fireEvent.click(title(text));
  await waitFor(() => {
    expect(row(text, true)).not.toBeNull();
  });
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

describe("deleting a task that cannot come back", () => {
  // Began at 09:00 today, three hours before the clock: a POST could not recreate it, because
  // the server refuses a start in the past (ADR-0012), so there is no undo to offer.
  const STARTED = aTask("Standup", "2026-08-26T09:00:00", "2026-08-26T09:30:00");
  const LATER = aTask("Review", "2026-08-26T14:00:00", "2026-08-26T15:00:00");

  it("asks inside the row, and sends nothing before the second press", async () => {
    const server: Server = { tasks: [STARTED, LATER], calls: [] };
    serve(server);
    renderWeek();
    await openRow("Standup");

    fireEvent.click(screen.getByRole("button", { name: "delete" }));

    expect(screen.getByText("No undo for this one")).toBeDefined();
    expect(deletes(server)).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "delete for good" }));

    await waitFor(() => {
      expect(deletes(server)).toEqual([{ method: "DELETE", path: "/tasks/Standup", body: undefined }]);
    });
    await waitFor(() => {
      expect(row("Standup")).toBeNull();
    });
  });

  it("goes back to the row without deleting when it is kept", async () => {
    const server: Server = { tasks: [STARTED], calls: [] };
    serve(server);
    renderWeek();
    await openRow("Standup");

    fireEvent.click(screen.getByRole("button", { name: "delete" }));
    fireEvent.click(screen.getByRole("button", { name: "keep it" }));

    expect(screen.queryByText("No undo for this one")).toBeNull();
    expect(row("Standup", true)).not.toBeNull();
    expect(deletes(server)).toHaveLength(0);
  });

  it("treats a 404 as already deleted: the row goes, and nothing is reported", async () => {
    // Deleted from another tab a moment ago. Not there is not there, and an error here would
    // be a complaint about a task the person was trying to be rid of.
    const server: Server = { tasks: [STARTED], calls: [] };
    serve(server);
    renderWeek();
    await openRow("Standup");
    server.tasks = [];

    fireEvent.click(screen.getByRole("button", { name: "delete" }));
    fireEvent.click(screen.getByRole("button", { name: "delete for good" }));

    await waitFor(() => {
      expect(document.getElementById("task-Standup")).toBeNull();
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("moves focus to the next row of the day rather than leaving it on nothing", async () => {
    const server: Server = { tasks: [STARTED, LATER], calls: [] };
    serve(server);
    renderWeek();
    await openRow("Standup");

    fireEvent.click(screen.getByRole("button", { name: "delete" }));
    fireEvent.click(screen.getByRole("button", { name: "delete for good" }));

    await waitFor(() => {
      expect(document.activeElement).toBe(title("Review"));
    });
  });

  it("says why this one cannot come back", async () => {
    const server: Server = { tasks: [STARTED], calls: [] };
    serve(server);
    renderWeek();
    await openRow("Standup");

    fireEvent.click(screen.getByRole("button", { name: "delete" }));

    // In the person's own time and day: the undo would need a start in the past.
    expect(screen.getByText("It has started — 09:00 today.")).toBeDefined();
  });

  it("lists every reason, not only the first", async () => {
    // Done, and partly ticked: an undo would bring it back open and unticked, two losses.
    const done = {
      ...STARTED,
      completed_at: at("2026-08-26T09:30:00"),
      items: [
        { id: "i1", label: "Agenda", position: 0, completed_at: at("2026-08-26T09:10:00") },
        { id: "i2", label: "Notes", position: 1, completed_at: null },
      ],
    };
    const server: Server = { tasks: [done], calls: [] };
    serve(server);
    renderWeek();
    await openRow("Standup");

    fireEvent.click(screen.getByRole("button", { name: "delete" }));

    const reasons = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(reasons).toEqual([
      "It is done.",
      "1 of 2 checklist items is ticked, and would come back unticked.",
    ]);
  });

  it("moves focus to the day's new-task button when nothing is left on it", async () => {
    const server: Server = { tasks: [STARTED], calls: [] };
    serve(server);
    renderWeek();
    await openRow("Standup");

    fireEvent.click(screen.getByRole("button", { name: "delete" }));
    fireEvent.click(screen.getByRole("button", { name: "delete for good" }));

    await waitFor(() => {
      expect(document.activeElement?.getAttribute("data-new-task")).toBe("2026-08-26");
    });
  });
});

describe("deleting a task that can come back", () => {
  // Tomorrow at 10:00, nothing ticked: a POST recreates it exactly, apart from its id.
  const THESIS = aTask("thesis", "2026-08-27T10:00:00", "2026-08-27T12:00:00", {
    title: "Thesis chapter",
    notes: "Ask about the sources.",
    tag: { id: "g1", name: "college" },
    items: [
      { id: "i2", label: "Sources", position: 1, completed_at: null },
      { id: "i1", label: "Outline", position: 0, completed_at: null },
    ],
  });
  const SNAPSHOT = {
    title: "Thesis chapter",
    start_at: THESIS.start_at,
    duration_minutes: 120,
    notes: "Ask about the sources.",
    tag: "college",
    items: [{ label: "Outline" }, { label: "Sources" }],
  };

  // Named by its day, since the day may not be on screen (ADR-0052).
  const DELETED = "Deleted “Thesis chapter” from Thu 27.";

  function posts(server: Server): Call[] {
    return server.calls.filter((call) => call.method === "POST" && call.path === "/tasks");
  }

  async function deleteThesis(server: Server): Promise<void> {
    serve(server);
    renderWeek();
    await openRow("Thesis chapter");
    fireEvent.click(screen.getByRole("button", { name: "delete" }));
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain(DELETED);
    });
  }

  it("sends the DELETE at once, without asking, and offers undo naming the task", async () => {
    const server: Server = { tasks: [THESIS], calls: [] };
    serve(server);
    renderWeek();
    await openRow("Thesis chapter");

    fireEvent.click(screen.getByRole("button", { name: "delete" }));

    // At once: on the press, before any notice or reload, and with no question in between.
    expect(deletes(server)).toEqual([{ method: "DELETE", path: "/tasks/thesis", body: undefined }]);
    expect(screen.queryByText("No undo for this one")).toBeNull();

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain(DELETED);
    });
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
    expect(screen.getByRole("button", { name: "undo" })).toBeDefined();
    // The notice is the server's answer to the DELETE; the row goes when the week is read
    // again, which is a moment later now that the week stays on screen through the reload.
    await waitFor(() => {
      expect(row("Thesis chapter")).toBeNull();
    });
  });

  it("recreates exactly the snapshot taken before the delete", async () => {
    const server: Server = { tasks: [THESIS], calls: [] };
    await deleteThesis(server);

    fireEvent.click(screen.getByRole("button", { name: "undo" }));

    await waitFor(() => {
      expect(posts(server)).toEqual([{ method: "POST", path: "/tasks", body: SNAPSHOT }]);
    });
    await waitFor(() => {
      expect(title("Thesis chapter")).toBeDefined();
    });
    // The region says it came back, and where: the day may not be the one on screen.
    expect(screen.getByRole("status").textContent).toBe("Restored “Thesis chapter” on Thu 27.");
  });

  it("puts focus on the restored row, which has a new id", async () => {
    const server: Server = { tasks: [THESIS], calls: [] };
    await deleteThesis(server);

    fireEvent.click(screen.getByRole("button", { name: "undo" }));

    await waitFor(() => {
      expect(document.activeElement).toBe(title("Thesis chapter"));
    });
    // Found by the id the server gave the recreate, not by the one that was deleted.
    expect(document.activeElement?.closest("[id^=task-]")?.id).toMatch(/^task-created-/);
  });

  it("shows the server's refusal once, and does not try again", async () => {
    // The start can pass during the nine seconds; then the server refuses the recreate.
    const server: Server = {
      tasks: [THESIS],
      calls: [],
      refuseCreate: { status: 422, detail: "A task cannot start in the past." },
    };
    await deleteThesis(server);

    fireEvent.click(screen.getByRole("button", { name: "undo" }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(
        "“Thesis chapter” was not brought back. A task cannot start in the past.",
      );
    });
    expect(screen.queryByRole("button", { name: "undo" })).toBeNull();
    expect(posts(server)).toHaveLength(1);
  });

  describe("what the status region says beyond deletes", () => {
    it("says a new task was added, and where, once the server has it", async () => {
      // The day may be out of view, so the notice names it and the time.
      const server: Server = { tasks: [], calls: [] };
      serve(server);
      renderWeek();
      await waitFor(() => {
        expect(document.querySelector('[data-new-task="2026-08-27"]')).not.toBeNull();
      });

      fireEvent.click(document.querySelector('[data-new-task="2026-08-27"]') as HTMLElement);
      fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Read chapter 2" } });
      fireEvent.change(screen.getByLabelText("Time"), { target: { value: "15:00" } });
      fireEvent.click(screen.getByRole("button", { name: "save" }));

      await waitFor(() => {
        expect(screen.getByRole("status").textContent).toBe("Added “Read chapter 2” to Thu 27, 15:00.");
      });
    });
  });
});
