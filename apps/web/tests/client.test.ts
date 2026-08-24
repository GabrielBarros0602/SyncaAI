/**
 * Tests for the HTTP wrapper.
 *
 * The one that earns its place is `two simultaneous 401s cause exactly one refresh`. It is
 * the failure that only happens when two requests expire together — a real page, never a
 * test click — and it is the reason the refresh is shared rather than per-call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  SessionExpiredError,
  api,
  onSessionExpired,
  refreshSession,
  resetClientForTests,
} from "../src/api/client";
import { getAccessToken, setAccessToken } from "../src/api/token";

const AN_EXPIRED_TOKEN = "expired.access.token";
const A_FRESH_TOKEN = "fresh.access.token";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const unauthorised = (): Response => jsonResponse(401, { detail: "Not authenticated." });
const refreshed = (token = A_FRESH_TOKEN): Response =>
  jsonResponse(200, { access_token: token, token_type: "bearer", expires_in: 1800 });

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

let fetchMock: ReturnType<typeof vi.fn<FetchLike>>;

/** A fetch that answers according to path, so a test states intent rather than call order. */
function routeFetch(routes: Record<string, () => Response | Promise<Response>>): void {
  fetchMock.mockImplementation((input) => {
    const path = input.replace("/api/v1", "");
    const handler = routes[path];
    if (handler === undefined) throw new Error(`no route for ${path}`);
    return Promise.resolve(handler());
  });
}

beforeEach(() => {
  resetClientForTests();
  fetchMock = vi.fn<FetchLike>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("attaching the token", () => {
  it("sends the bearer token when there is one", async () => {
    setAccessToken(A_FRESH_TOKEN);
    routeFetch({ "/tasks": () => jsonResponse(200, { items: [] }) });

    await api.get("/tasks");

    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Headers;
    expect(headers.get("Authorization")).toBe(`Bearer ${A_FRESH_TOKEN}`);
  });

  it("sends no Authorization header when signed out", async () => {
    routeFetch({ "/tasks": () => jsonResponse(200, { items: [] }) });

    await api.get("/tasks");

    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Headers;
    expect(headers.has("Authorization")).toBe(false);
  });
});

describe("renewing an expired session", () => {
  it("refreshes once and retries the request", async () => {
    setAccessToken(AN_EXPIRED_TOKEN);
    let taskCalls = 0;
    routeFetch({
      "/tasks": () => {
        taskCalls += 1;
        return taskCalls === 1 ? unauthorised() : jsonResponse(200, { items: ["ok"] });
      },
      "/auth/refresh": refreshed,
    });

    const body = await api.get<{ items: string[] }>("/tasks");

    expect(body.items).toEqual(["ok"]);
    expect(getAccessToken()).toBe(A_FRESH_TOKEN);
  });

  it("retries exactly once, then gives up", async () => {
    // A second 401 with a token minted seconds ago means the answer is really no. Retrying
    // again would be a loop, and a loop against an auth endpoint is a way to lock an
    // account out with your own client.
    setAccessToken(AN_EXPIRED_TOKEN);
    let taskCalls = 0;
    routeFetch({
      "/tasks": () => {
        taskCalls += 1;
        return unauthorised();
      },
      "/auth/refresh": () => refreshed(),
    });

    await expect(api.get("/tasks")).rejects.toBeInstanceOf(SessionExpiredError);
    expect(taskCalls).toBe(2);
  });

  it("gives up without retrying when the refresh itself is refused", async () => {
    setAccessToken(AN_EXPIRED_TOKEN);
    let taskCalls = 0;
    routeFetch({
      "/tasks": () => {
        taskCalls += 1;
        return unauthorised();
      },
      "/auth/refresh": unauthorised,
    });

    await expect(api.get("/tasks")).rejects.toBeInstanceOf(SessionExpiredError);
    expect(taskCalls).toBe(1);
  });

  it("tells the application the session is gone", async () => {
    const lost = vi.fn();
    onSessionExpired(lost);
    setAccessToken(AN_EXPIRED_TOKEN);
    routeFetch({ "/tasks": unauthorised, "/auth/refresh": unauthorised });

    await expect(api.get("/tasks")).rejects.toBeInstanceOf(SessionExpiredError);

    expect(lost).toHaveBeenCalledOnce();
  });
});

describe("concurrent failures", () => {
  it("two simultaneous 401s cause exactly one call to /auth/refresh", async () => {
    // The claim ADR-0021 rests on. Harmless today, because the refresh token is not
    // rotated (ADR-0015) — but the moment rotation with reuse detection lands, a second
    // exchange presents a consumed token, reuse detection revokes the family, and the user
    // is signed out. This keeps the client already correct for that.
    setAccessToken(AN_EXPIRED_TOKEN);
    let refreshCalls = 0;
    const seen = new Set<string>();

    routeFetch({
      "/tasks": () => (seen.has("tasks") ? jsonResponse(200, {}) : unauthorised()),
      "/tags": () => (seen.has("tags") ? jsonResponse(200, []) : unauthorised()),
      "/auth/refresh": () => {
        refreshCalls += 1;
        seen.add("tasks");
        seen.add("tags");
        return refreshed();
      },
    });

    await Promise.all([api.get("/tasks"), api.get("/tags")]);

    expect(refreshCalls).toBe(1);
  });

  it("a request that arrives late reuses the token somebody else obtained", async () => {
    // The other half: the first request refreshed and finished, so the in-flight promise is
    // already cleared. The second must notice the token changed rather than spend another
    // exchange on a token that is fine.
    setAccessToken(AN_EXPIRED_TOKEN);
    let refreshCalls = 0;
    routeFetch({
      "/tasks": () => (getAccessToken() === A_FRESH_TOKEN ? jsonResponse(200, {}) : unauthorised()),
      "/auth/refresh": () => {
        refreshCalls += 1;
        return refreshed();
      },
    });

    await api.get("/tasks");
    // Now a second call made with the stale token it captured before the first finished.
    setAccessToken(AN_EXPIRED_TOKEN);
    const stale = api.get("/tasks");
    setAccessToken(A_FRESH_TOKEN);
    await stale;

    expect(refreshCalls).toBe(1);
  });
});

describe("errors that are not about the session", () => {
  it("surfaces the API's own message", async () => {
    setAccessToken(A_FRESH_TOKEN);
    routeFetch({
      "/tasks": () => jsonResponse(409, { detail: "That time is already taken by another task." }),
    });

    await expect(api.post("/tasks", {})).rejects.toThrow(
      "That time is already taken by another task.",
    );
  });

  it("carries the status so a caller can branch on it", async () => {
    setAccessToken(A_FRESH_TOKEN);
    routeFetch({ "/tasks": () => jsonResponse(409, { detail: "taken" }) });

    const error = await api.post("/tasks", {}).catch((problem: unknown) => problem);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(409);
  });

  it("does not choke on a 204 with no body", async () => {
    setAccessToken(A_FRESH_TOKEN);
    routeFetch({ "/tasks/1": () => new Response(null, { status: 204 }) });

    await expect(api.delete("/tasks/1")).resolves.toBeUndefined();
  });

  it("treats a network failure as no token rather than a lost session", async () => {
    // A dead wifi is not a signed-out user. Clearing the token is right; declaring the
    // session over would sign someone out for walking into a lift.
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(refreshSession()).resolves.toBeNull();
  });
});
