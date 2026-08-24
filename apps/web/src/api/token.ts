/**
 * The access token, and the only place it exists.
 *
 * A module-level binding rather than React state, because the HTTP layer needs to read it
 * outside a component and a stale closure over a token is a bug that only appears after
 * the first refresh.
 *
 * It is never written to `localStorage`, `sessionStorage`, or a readable cookie — see
 * ADR-0021. A script running on this page can still act through the open tab, but it
 * cannot copy a working credential and use it from somewhere else, and that is the
 * property being bought.
 */
let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}
