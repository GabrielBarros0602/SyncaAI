/**
 * Every call to the API goes through here.
 *
 * One place owns three things that are easy to get subtly wrong if they are spread across
 * components: attaching the bearer token, retrying once after a `401`, and making sure a
 * burst of simultaneous failures spends exactly one refresh token.
 *
 * The third one deserves an honest justification, because the obvious one is wrong.
 *
 * Refresh tokens are **not** rotated today. ADR-0015 chose revocability and explicitly left
 * "rotation with reuse detection" as the next step, so a second concurrent exchange is
 * currently harmless — it presents the same still-valid token and mints a second access
 * token. Wasteful, not broken.
 *
 * The dedup is here because the moment rotation lands server-side, that stops being true:
 * the second exchange would present a token the first one just consumed, reuse detection
 * would revoke the family, and the user would be signed out. It is a bug that would appear
 * on a real page — two requests expiring together — and never on a test click. Writing the
 * client so it is already correct for that upgrade costs four lines now and saves finding
 * it in production later.
 */
import { getAccessToken, setAccessToken } from "./token";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(detail);
    this.name = "ApiError";
  }
}

/** Raised when the session is gone and the caller has to become anonymous. */
export class SessionExpiredError extends Error {
  constructor() {
    super("The session has expired.");
    this.name = "SessionExpiredError";
  }
}

const BASE = "/api/v1";

// A refresh already in flight. Every caller that arrives while this is set awaits the same
// promise instead of starting a second exchange.
let refreshInFlight: Promise<string | null> | null = null;

let onSessionLost: (() => void) | null = null;

/** Register what happens when the session cannot be renewed. Set once, at boot. */
export function onSessionExpired(handler: () => void): void {
  onSessionLost = handler;
}

async function exchangeRefreshToken(): Promise<string | null> {
  // Deliberately not routed through `request`: it is the thing that calls this, and going
  // back through it on a 401 would recurse.
  // No body. The endpoint takes an optional one so a native client can send its token
  // there; a web client sends nothing and the HttpOnly cookie carries it.
  // Same-origin because of the Vite proxy (ADR-0021), so the cookie is attached without
  // any CORS credentials dance.
  const response = await fetch(`${BASE}/auth/refresh`, {
    method: "POST",
    credentials: "same-origin",
  });

  if (!response.ok) return null;

  const body = (await response.json()) as { access_token: string };
  return body.access_token;
}

/**
 * Renew the access token, sharing one exchange between concurrent callers.
 */
export function refreshSession(): Promise<string | null> {
  refreshInFlight ??= exchangeRefreshToken()
    .then((token) => {
      setAccessToken(token);
      return token;
    })
    .catch(() => {
      // A network failure is not a lost session. Report it as "no token now" and let the
      // caller surface an error rather than silently logging the user out.
      setAccessToken(null);
      return null;
    })
    .finally(() => {
      refreshInFlight = null;
    });

  return refreshInFlight;
}

function send(path: string, init: RequestInit, token: string | null): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token !== null) headers.set("Authorization", `Bearer ${token}`);

  return fetch(`${BASE}${path}`, { ...init, headers, credentials: "same-origin" });
}

async function detailOf(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    return typeof body.detail === "string" ? body.detail : response.statusText;
  } catch {
    return response.statusText;
  }
}

/**
 * Issue a request, renewing the session once if the token turned out to be expired.
 */
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const tokenUsed = getAccessToken();
  let response = await send(path, init, tokenUsed);

  if (response.status === 401) {
    // While this request was in the air, another one may have already renewed the session.
    // Reusing that result is not just an optimisation: refreshing again would spend a
    // second single-use token for nothing.
    const current = getAccessToken();
    const token =
      current !== null && current !== tokenUsed ? current : await refreshSession();

    if (token === null) {
      onSessionLost?.();
      throw new SessionExpiredError();
    }

    // Once, and only once. A second 401 after a fresh token means the answer is really no,
    // and retrying again would be a loop.
    response = await send(path, init, token);
    if (response.status === 401) {
      onSessionLost?.();
      throw new SessionExpiredError();
    }
  }

  if (!response.ok) throw new ApiError(response.status, await detailOf(response));
  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

/** Reset module state. Tests only — a page load does this for free. */
export function resetClientForTests(): void {
  refreshInFlight = null;
  onSessionLost = null;
  setAccessToken(null);
}
