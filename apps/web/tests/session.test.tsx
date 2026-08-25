/**
 * Tests for the session state.
 *
 * The claim under test is the one the third state exists for: a signed-in user reloading
 * the page never sees the signed-out interface, not even for a frame.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { resetClientForTests } from "../src/api/client";
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
