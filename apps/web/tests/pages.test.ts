/**
 * Tests for reading a whole listing.
 *
 * The one that earns its place is the first: a window with more rows than a page holds. It is
 * the case the week got wrong, silently, because nothing on screen says a row is missing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetClientForTests } from "../src/api/client";
import { PAGE_SIZE, everyPage } from "../src/api/pages";

interface Row {
  id: string;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

let fetchMock: ReturnType<typeof vi.fn<FetchLike>>;

function rows(from: number, count: number): Row[] {
  return Array.from({ length: count }, (_, index) => ({ id: `row-${String(from + index)}` }));
}

/** A server holding `pages`, answering each offset with the page that starts there. */
function serve(pages: Row[][]): void {
  fetchMock.mockImplementation((input) => {
    const offset = Number(new URL(input, "http://test").searchParams.get("offset"));
    const page = pages[offset / PAGE_SIZE] ?? [];
    return Promise.resolve(
      new Response(JSON.stringify({ items: page, limit: PAGE_SIZE, offset }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
}

function offsetsAsked(): number[] {
  return fetchMock.mock.calls.map(([input]) =>
    Number(new URL(input, "http://test").searchParams.get("offset")),
  );
}

beforeEach(() => {
  resetClientForTests();
  fetchMock = vi.fn<FetchLike>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reading every page", () => {
  it("asks for the next page while the last one came back full", async () => {
    serve([rows(0, PAGE_SIZE), rows(PAGE_SIZE, 30)]);

    const items = await everyPage<Row>("/tasks?first_day=2026-10-25&last_day=2026-11-01");

    expect(items).toEqual(rows(0, PAGE_SIZE + 30));
    expect(offsetsAsked()).toEqual([0, PAGE_SIZE]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `/api/v1/tasks?first_day=2026-10-25&last_day=2026-11-01&limit=${String(PAGE_SIZE)}&offset=0`,
    );
  });

  it("stops at a short page without asking for another", async () => {
    serve([rows(0, 7)]);

    expect(await everyPage<Row>("/tasks")).toEqual(rows(0, 7));
    expect(offsetsAsked()).toEqual([0]);
  });

  it("asks once more after a page exactly full, and finds it empty", async () => {
    serve([rows(0, PAGE_SIZE)]);

    expect(await everyPage<Row>("/tasks")).toHaveLength(PAGE_SIZE);
    expect(offsetsAsked()).toEqual([0, PAGE_SIZE]);
  });

  it("keeps a row pushed into the next page once, where it first came", async () => {
    // A task created before the offset between the two reads moves the first page's last
    // row to the head of the second.
    const first = rows(0, PAGE_SIZE);
    serve([first, [first[PAGE_SIZE - 1] as Row, ...rows(PAGE_SIZE, 5)]]);

    const items = await everyPage<Row>("/tasks");

    expect(items).toEqual([...first, ...rows(PAGE_SIZE, 5)]);
  });

  it("stops when a full page brings nothing new", async () => {
    const same = rows(0, PAGE_SIZE);
    serve([same, same, same]);

    expect(await everyPage<Row>("/tasks")).toEqual(same);
    expect(offsetsAsked()).toEqual([0, PAGE_SIZE]);
  });
});
