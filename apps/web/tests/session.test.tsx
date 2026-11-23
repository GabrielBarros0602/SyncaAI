/**
 * Tests for the session state.
 *
 * The claim under test is the one the third state exists for: a signed-in user reloading
 * the page never sees the signed-out interface, not even for a frame.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { resetClientForTests } from "../src/api/client";
import { getAccessToken } from "../src/api/token";
import { SessionProvider } from "../src/auth/session";
import { useSession } from "../src/auth/useSession";

/**
 * A probe rather than the real shell.
 *
 * What is under test is the provider's three states, and rendering `App` to observe them
 * couples this file to whatever the signed-in screen happens to fetch. It broke exactly
 * that way once already.
 */
function Probe(): React.ReactNode {
  const { status } = useSession();
  if (status === "loading") return <p role="status">Checking your session…</p>;
  return <p>{status === "authenticated" ? "Signed in." : "Signed out."}</p>;
}

type FetchLike = () => Promise<Response>;

let fetchMock: ReturnType<typeof vi.fn<FetchLike>>;

function refreshAnswers(status: number): void {
  fetchMock.mockImplementation(() =>
    Promise.resolve(
      new Response(
        status === 200
          ? JSON.stringify({ access_token: "a.token", token_type: "bearer", expires_in: 1800 })
          : JSON.stringify({ detail: "Not authenticated." }),
        { status, headers: { "Content-Type": "application/json" } },
      ),
    ),
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

it("shows neither interface until the boot refresh has answered", () => {
  // Never resolves, so the assertion is about the state before any answer.
  fetchMock.mockImplementation(() => new Promise<Response>(() => undefined));

  render(
    <SessionProvider>
      <Probe />
    </SessionProvider>,
  );

  expect(screen.getByRole("status")).toBeDefined();
  expect(screen.queryByText("Signed out.")).toBeNull();
  expect(screen.queryByText("Signed in.")).toBeNull();
});

it("a live cookie means the user is signed in without typing anything", async () => {
  refreshAnswers(200);

  render(
    <SessionProvider>
      <Probe />
    </SessionProvider>,
  );

  await waitFor(() => {
    expect(screen.getByText("Signed in.")).toBeDefined();
  });
});

it("no cookie means signed out", async () => {
  refreshAnswers(401);

  render(
    <SessionProvider>
      <Probe />
    </SessionProvider>,
  );

  await waitFor(() => {
    expect(screen.getByText("Signed out.")).toBeDefined();
  });
});

it("an unreachable server at boot is not a signed-out user", async () => {
  // Whether there is a session is unknown, so the sign-in screen would be a guess (ADR-0021).
  // The signed-in side shows the server could not be reached, and its retry settles it.
  fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

  render(
    <SessionProvider>
      <Probe />
    </SessionProvider>,
  );

  await waitFor(() => {
    expect(screen.getByText("Signed in.")).toBeDefined();
  });
  expect(screen.queryByText("Signed out.")).toBeNull();
});

it("the signed-out interface is never shown to a user who is signed in", async () => {
  // The flash. Asserted by watching every render rather than by sampling, because the bug
  // is one frame long and a sampled assertion would miss it exactly when it mattered.
  refreshAnswers(200);
  const seen: string[] = [];

  const { container } = render(
    <SessionProvider>
      <Probe />
    </SessionProvider>,
  );
  const observer = new MutationObserver(() => seen.push(container.textContent));
  observer.observe(container, { childList: true, subtree: true, characterData: true });

  await waitFor(() => {
    expect(screen.getByText("Signed in.")).toBeDefined();
  });
  observer.disconnect();

  expect(seen.some((text) => text.includes("Signed out."))).toBe(false);
});

/** Signs out on a press, and says what came of it. */
function SignOutProbe(): React.ReactNode {
  const { status, signedOut, signOut } = useSession();
  const [failed, setFailed] = useState(false);
  return (
    <>
      <p>{`${status}${signedOut ? ", by the person" : ""}${failed ? ", refused" : ""}`}</p>
      <button
        type="button"
        onClick={() => {
          signOut().catch(() => {
            setFailed(true);
          });
        }}
      >
        Sign out
      </button>
    </>
  );
}

function answer(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

it("signs out only once the server has ended the session", async () => {
  // The cookie that would sign the person back in is HttpOnly: only the server's answer ends
  // it, so until that answer the person is still signed in (decided on 2026-11-23).
  let endSession: (response: Response) => void = () => undefined;
  fetchMock.mockImplementation((input?: unknown) =>
    String(input).endsWith("/auth/logout")
      ? new Promise<Response>((resolve) => {
          endSession = resolve;
        })
      : Promise.resolve(answer(200, { access_token: "a.token", token_type: "bearer", expires_in: 1800 })),
  );
  render(
    <SessionProvider>
      <SignOutProbe />
    </SessionProvider>,
  );
  await screen.findByText("authenticated");

  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  await Promise.resolve();
  expect(screen.getByText("authenticated")).toBeDefined();

  endSession(answer(204));

  expect(await screen.findByText("anonymous, by the person")).toBeDefined();
  expect(getAccessToken()).toBeNull();
});

it("a sign-out the server never heard leaves the session as it was", async () => {
  fetchMock.mockImplementation((input?: unknown) =>
    String(input).endsWith("/auth/logout")
      ? Promise.reject(new TypeError("Failed to fetch"))
      : Promise.resolve(answer(200, { access_token: "a.token", token_type: "bearer", expires_in: 1800 })),
  );
  render(
    <SessionProvider>
      <SignOutProbe />
    </SessionProvider>,
  );
  await screen.findByText("authenticated");

  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

  expect(await screen.findByText("authenticated, refused")).toBeDefined();
  // Kept, so the next request still carries it rather than a reload being what finds out.
  expect(getAccessToken()).toBe("a.token");
});
