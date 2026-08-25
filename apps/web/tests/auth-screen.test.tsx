/**
 * Tests for entering.
 *
 * The claim that earns its place: registering answers the same way whether or not the
 * address already has an account, and this screen must not undo that. Everything the API
 * spent ADR-0019 hiding could be given away by one helpful sentence here.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { resetClientForTests } from "../src/api/client";
import { AuthScreen } from "../src/auth/AuthScreen";
import { SessionProvider } from "../src/auth/session";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

let fetchMock: ReturnType<typeof vi.fn<FetchLike>>;

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

beforeEach(() => {
  resetClientForTests();
  fetchMock = vi.fn<FetchLike>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderScreen(): void {
  render(
    <SessionProvider>
      <AuthScreen />
    </SessionProvider>,
  );
}

async function fill(label: RegExp, value: string): Promise<void> {
  await userEvent.type(screen.getByLabelText(label), value);
}

/** The body of the last call to a path, parsed. */
function sentTo(path: string): Record<string, unknown> {
  const call = fetchMock.mock.calls.find(([to]) => to.includes(path));
  const body = call?.[1]?.body;
  return JSON.parse(typeof body === "string" ? body : "{}") as Record<string, unknown>;
}

it("signs in with the credentials typed", async () => {
  route({
    "/auth/refresh": NO_SESSION,
    "/auth/login": () => json(200, { access_token: "a.token", token_type: "bearer", expires_in: 1800 }),
  });
  renderScreen();

  await fill(/email/i, "gabriel@example.com");
  await fill(/^password$/i, "a-real-password");
  await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

  await waitFor(() => {
    expect(sentTo("/auth/login")).toMatchObject({
      email: "gabriel@example.com",
      password: "a-real-password",
      client: "web",
    });
  });
});

it("declares itself a web client, so the refresh token arrives as a cookie", async () => {
  // The field that decides the token is set as HttpOnly rather than handed to this script
  // (ADR-0017). A screen that forgot it would silently take the native path.
  route({
    "/auth/refresh": NO_SESSION,
    "/auth/login": () => json(200, { access_token: "a.token", token_type: "bearer", expires_in: 1800 }),
  });
  renderScreen();

  await fill(/email/i, "gabriel@example.com");
  await fill(/^password$/i, "a-real-password");
  await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

  await waitFor(() => {
    expect(sentTo("/auth/login").client).toBe("web");
  });
});

it("shows the API's own words for a refused sign-in", async () => {
  // Not this screen's words. The API decided that one message covers a missing account and
  // a wrong password, and rewording here would risk splitting them apart again.
  route({
    "/auth/refresh": NO_SESSION,
    "/auth/login": () => json(401, { detail: "Incorrect email or password." }),
  });
  renderScreen();

  await fill(/email/i, "nobody@example.com");
  await fill(/^password$/i, "wrong");
  await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Incorrect email or password.",
  );
});

it("says an unverified account needs confirming, which is safe to say", async () => {
  // Reachable only with correct credentials, so there is nobody to leak it to.
  route({
    "/auth/refresh": NO_SESSION,
    "/auth/login": () => json(403, { detail: "Confirm your address before signing in." }),
  });
  renderScreen();

  await fill(/email/i, "gabriel@example.com");
  await fill(/^password$/i, "a-real-password");
  await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

  expect((await screen.findByRole("alert")).textContent).toContain(
    "Confirm your address before signing in.",
  );
});

it("registering never reveals whether the address already had an account", async () => {
  // The claim ADR-0019 rests on, asserted on this screen because it is the one place a
  // helpful sentence could give away what the API spent a whole sprint hiding.
  route({
    "/auth/refresh": NO_SESSION,
    "/auth/register": () => json(202, { detail: "If that address needs an account, a link is on its way." }),
  });
  renderScreen();

  await userEvent.click(screen.getByRole("button", { name: /create an account/i }));
  await fill(/email/i, "maybe-taken@example.com");
  await fill(/^password$/i, "a-real-password");
  await userEvent.click(screen.getByRole("button", { name: /create account/i }));

  // Asserted on the panel that reports the outcome, not on the whole page — the sign-in
  // link below it says "Already have an account?", which is navigation and not a claim
  // about this address.
  const heading = await screen.findByRole("heading", { name: "Check your inbox" });
  const panel = heading.parentElement;
  expect(panel?.textContent).toMatch(/if that address needs an account/i);
  expect(panel?.textContent).not.toMatch(/exists|taken|created/i);
});

it("offers the browser's zone as a default the user can change", async () => {
  // A default, not a decision. The stored zone is what every local date is read in, and the
  // browser's is only a guess about where somebody is sitting today.
  route({ "/auth/refresh": NO_SESSION });
  renderScreen();

  await userEvent.click(screen.getByRole("button", { name: /create an account/i }));

  expect(screen.getByLabelText<HTMLInputElement>(/time zone/i).value).toBe(
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
});

it("confirms an account with a pasted code and returns to signing in", async () => {
  // The loop closes without leaving the screen, which is what makes a local sign-up
  // possible when the mail goes to a log rather than to a mailbox.
  route({
    "/auth/refresh": NO_SESSION,
    "/auth/verify": () => new Response(null, { status: 204 }),
  });
  renderScreen();

  await userEvent.click(screen.getByRole("button", { name: /i have a code/i }));
  await fill(/confirmation code/i, "a-single-use-token");
  await userEvent.click(screen.getByRole("button", { name: /^confirm/i }));

  await waitFor(() => {
    expect(screen.getByRole("button", { name: /^sign in/i })).toBeDefined();
  });
});

it("keeps a spent or invalid code on screen with the API's reason", async () => {
  route({
    "/auth/refresh": NO_SESSION,
    "/auth/verify": () => json(400, { detail: "That confirmation link is not valid. Request a new one." }),
  });
  renderScreen();

  await userEvent.click(screen.getByRole("button", { name: /i have a code/i }));
  await fill(/confirmation code/i, "already-spent");
  await userEvent.click(screen.getByRole("button", { name: /^confirm/i }));

  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "That confirmation link is not valid. Request a new one.",
  );
});

it("a network failure is not reported as a credential problem", async () => {
  // Telling somebody their password is wrong because the wifi died is the same class of
  // mistake the API's 401 message split fixed.
  fetchMock.mockImplementation((input) =>
    input.includes("/auth/login")
      ? Promise.reject(new TypeError("Failed to fetch"))
      : Promise.resolve(NO_SESSION()),
  );
  renderScreen();

  await fill(/email/i, "gabriel@example.com");
  await fill(/^password$/i, "a-real-password");
  await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Couldn't reach the server.",
  );
});

it("offers to send the link again only when that is the answer", async () => {
  // The one error whose remedy is an action rather than a correction. Offering it next to
  // "Incorrect email or password" would be an enumeration channel: a resend button that
  // appears only for real accounts tells you which addresses are real.
  route({
    "/auth/refresh": NO_SESSION,
    "/auth/login": () => json(403, { detail: "Confirm your address before signing in." }),
  });
  renderScreen();

  await fill(/email/i, "gabriel@example.com");
  await fill(/^password$/i, "a-real-password");
  await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

  expect(await screen.findByRole("button", { name: /send the link again/i })).toBeDefined();
});

it("does not offer a resend for a wrong password", async () => {
  route({
    "/auth/refresh": NO_SESSION,
    "/auth/login": () => json(401, { detail: "Incorrect email or password." }),
  });
  renderScreen();

  await fill(/email/i, "gabriel@example.com");
  await fill(/^password$/i, "wrong");
  await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

  await screen.findByRole("alert");
  expect(screen.queryByRole("button", { name: /send the link again/i })).toBeNull();
});

it("counts down from the server's Retry-After rather than from a guess", async () => {
  // The API sends the header; a client that invented the number would either fail on retry
  // or make somebody wait longer than they had to.
  fetchMock.mockImplementation((input) =>
    Promise.resolve(
      input.includes("/auth/login")
        ? new Response(JSON.stringify({ detail: "Too many attempts. Try again later." }), {
            status: 429,
            headers: { "Content-Type": "application/json", "Retry-After": "47" },
          })
        : NO_SESSION(),
    ),
  );
  renderScreen();

  await fill(/email/i, "gabriel@example.com");
  await fill(/^password$/i, "a-real-password");
  await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

  expect(await screen.findByText(/retry in 0:4[567]/)).toBeDefined();
});

it("blocks the button while the countdown runs", async () => {
  fetchMock.mockImplementation((input) =>
    Promise.resolve(
      input.includes("/auth/login")
        ? new Response(JSON.stringify({ detail: "Too many attempts. Try again later." }), {
            status: 429,
            headers: { "Content-Type": "application/json", "Retry-After": "47" },
          })
        : NO_SESSION(),
    ),
  );
  renderScreen();

  await fill(/email/i, "gabriel@example.com");
  await fill(/^password$/i, "a-real-password");
  await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
  await screen.findByRole("alert");

  expect(screen.getByRole("button", { name: /sign in/i })).toHaveProperty("disabled", true);
});

it("reveals and hides the password without losing what was typed", async () => {
  route({ "/auth/refresh": NO_SESSION });
  renderScreen();

  await fill(/^password$/i, "a-real-password");
  const field = screen.getByLabelText<HTMLInputElement>(/^password$/i);
  expect(field.type).toBe("password");

  await userEvent.click(screen.getByRole("button", { name: /show password/i }));
  expect(field.type).toBe("text");
  expect(field.value).toBe("a-real-password");

  await userEvent.click(screen.getByRole("button", { name: /hide password/i }));
  expect(field.type).toBe("password");
});

it("keeps the unconfirmed alert on screen after sending another link", async () => {
  // The account is still unconfirmed after the link goes out, so the message saying so is
  // still true. Clearing it would take a fact that did not change off the screen and
  // replace it with a grey line under the button.
  route({
    "/auth/refresh": NO_SESSION,
    "/auth/login": () => json(403, { detail: "Confirm your address before signing in." }),
    "/auth/resend-verification": () => json(202, { detail: "If that address needs it, a link is on its way." }),
  });
  renderScreen();

  await fill(/email/i, "gabriel@example.com");
  await fill(/^password$/i, "a-real-password");
  await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
  await userEvent.click(await screen.findByRole("button", { name: /send the link again/i }));

  const alert = await screen.findByRole("alert");
  await waitFor(() => {
    expect(alert.textContent).toContain("Another link is on its way.");
  });
  expect(alert.textContent).toContain("Confirm your address before signing in.");
});

it("replaces the resend button rather than leaving it clickable twice", async () => {
  // Each resend costs somebody else an email, and the endpoint is rate limited more tightly
  // than login for exactly that reason.
  route({
    "/auth/refresh": NO_SESSION,
    "/auth/login": () => json(403, { detail: "Confirm your address before signing in." }),
    "/auth/resend-verification": () => json(202, { detail: "sent" }),
  });
  renderScreen();

  await fill(/email/i, "gabriel@example.com");
  await fill(/^password$/i, "a-real-password");
  await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
  await userEvent.click(await screen.findByRole("button", { name: /send the link again/i }));

  await waitFor(() => {
    expect(screen.queryByRole("button", { name: /send the link again/i })).toBeNull();
  });
});
