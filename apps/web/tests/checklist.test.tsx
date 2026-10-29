/**
 * Tests for the requests a checklist change becomes.
 *
 * The claim: each change is the one request the API has for it, and an order sends the whole
 * list.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetClientForTests } from "../src/api/client";
import { setAccessToken } from "../src/api/token";
import { useWeek } from "../src/week/useWeek";

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
