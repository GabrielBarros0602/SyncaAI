/**
 * Tests for arriving by the confirmation link.
 *
 * This file exists because the gap it covers shipped. The API mailed
 * `/verify?token=...`; the screen only accepted a pasted code; nothing joined them, so
 * opening the link loaded the sign-in form, which asked to refresh a session that did not
 * exist and answered 401. Every part worked. The seam between two of them did not, and no
 * test looked at a seam.
 *
 * The token is read at module scope, so each case has to re-evaluate the module with a
 * different address — hence `resetModules` and the dynamic imports. Importing only
 * `AuthScreen` fresh would leave it holding a context object the cached `SessionProvider`
 * no longer creates, so the whole entry graph is imported together.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, expect, it, vi } from "vitest";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const fetchMock = vi.fn<FetchLike>();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const NO_SESSION = (): Response => json(401, { detail: "Not authenticated." });

function route(routes: Record<string, () => Response>): void {
  fetchMock.mockImplementation((input) => {
    const path = input.replace("/api/v1", "").split("?")[0] ?? "";
    const handler = routes[path] ?? NO_SESSION;
    return Promise.resolve(handler());
  });
}

function callsTo(path: string): number {
  return fetchMock.mock.calls.filter(([to]) => to.includes(path)).length;
}

/** The body of the last call to a path, parsed. */
function sentTo(path: string): Record<string, unknown> {
  const call = fetchMock.mock.calls.find(([to]) => to.includes(path));
  const body = call?.[1]?.body;
  return JSON.parse(typeof body === "string" ? body : "{}") as Record<string, unknown>;
}

/** Load the page at `address`, with the entry graph evaluated against it. */
async function open(address: string, strict = false): Promise<void> {
  window.history.replaceState(null, "", address);
  vi.resetModules();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);

  const [{ AuthScreen }, { SessionProvider }, { resetClientForTests }] = await Promise.all([
    import("../src/auth/AuthScreen"),
    import("../src/auth/session"),
    import("../src/api/client"),
  ]);
  resetClientForTests();

  const tree = (
    <SessionProvider>
      <AuthScreen />
    </SessionProvider>
  );
  render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

it("confirms the token in the address without being asked", async () => {
  route({ "/auth/refresh": NO_SESSION, "/auth/verify": () => new Response(null, { status: 204 }) });
  await open("/verify?token=a-token-from-the-mail");

  await waitFor(() => {
    expect(callsTo("/auth/verify")).toBe(1);
  });
  expect(sentTo("/auth/verify")).toEqual({ token: "a-token-from-the-mail" });
});

it("takes the token out of the address bar", async () => {
  route({ "/auth/refresh": NO_SESSION, "/auth/verify": () => new Response(null, { status: 204 }) });
  await open("/verify?token=a-token-from-the-mail");

  // Asserted before anything is awaited, because "eventually" is not the claim: the token
  // is gone at module evaluation, before the first request leaves. A single-use credential
  // should not survive in history, in autocomplete, or in a `Referer` header.
  expect(window.location.search).toBe("");
  expect(window.location.pathname).toBe("/verify");

  // Then let the tree settle, so the confirmation does not land after the test has ended.
  expect(await screen.findByText("Confirmed. Sign in below.")).toBeDefined();
});

it("lands on sign in once the address is confirmed", async () => {
  route({ "/auth/refresh": NO_SESSION, "/auth/verify": () => new Response(null, { status: 204 }) });
  await open("/verify?token=a-token-from-the-mail");

  expect(await screen.findByText("Confirmed. Sign in below.")).toBeDefined();
  expect(screen.getByRole("heading", { name: "Welcome back" })).toBeDefined();
});

it("says a spent link is spent, and points at the way to another", async () => {
  route({
    "/auth/refresh": NO_SESSION,
    "/auth/verify": () => json(400, { detail: "That link is no longer valid." }),
  });
  await open("/verify?token=a-token-already-used");

  expect((await screen.findByRole("alert")).textContent).toContain("That link is no longer valid.");
  expect(screen.getByRole("heading", { name: "That link is spent" })).toBeDefined();
  // Registering again answers the same 202 it always does and sends nothing new, so the
  // copy must not send anybody there.
  expect(screen.getByText(/Sign in and another will be offered\./)).toBeDefined();
});

it("spends the token once, even though development mounts everything twice", async () => {
  route({ "/auth/refresh": NO_SESSION, "/auth/verify": () => new Response(null, { status: 204 }) });
  await open("/verify?token=a-token-from-the-mail", true);

  await waitFor(() => {
    expect(callsTo("/auth/verify")).toBe(1);
  });
  // A second call would spend a token that is already spent and answer 400, so the person
  // would be told their own link had already been used, half a second after opening it.
  expect(await screen.findByText("Confirmed. Sign in below.")).toBeDefined();
});

it("confirms nothing when the address carries no token", async () => {
  route({ "/auth/refresh": NO_SESSION });
  await open("/");

  expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeDefined();
  expect(callsTo("/auth/verify")).toBe(0);
});
