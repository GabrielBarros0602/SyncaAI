/**
 * The auth calls, and the one place a token enters the application.
 *
 * `login` is deliberately the only function that calls `setAccessToken` from outside the
 * client module. Keeping that narrow is what makes "where could a token come from?" a
 * question with a short answer.
 */
import { api } from "../api/client";
import { setAccessToken } from "../api/token";

interface TokenResponse {
  access_token: string;
  token_type: "bearer";
  expires_in: number;
}

export interface Credentials {
  email: string;
  password: string;
}

export async function login({ email, password }: Credentials): Promise<void> {
  // `client: "web"` is the default server-side, but it is stated here rather than relied
  // on: it is the field that decides the refresh token arrives as an HttpOnly cookie and
  // not in a body this script could read (ADR-0017).
  const response = await api.post<TokenResponse>("/auth/login", {
    email,
    password,
    client: "web",
  });
  setAccessToken(response.access_token);
}

export async function register(credentials: Credentials & { timezone: string }): Promise<void> {
  // Answers 202 whether or not the address already has an account, so there is nothing to
  // branch on here — and nothing this screen can reveal that the API chose to hide.
  await api.post<{ detail: string }>("/auth/register", credentials);
}

export async function logout(): Promise<void> {
  try {
    // 204, so there is no body to type. `undefined` says that; `void` is a return
    // type, not a value.
    await api.post<undefined>("/auth/logout", {});
  } finally {
    // Local state is cleared even if the call failed. A user who pressed logout should not
    // stay logged in because the network was down; the server-side session outliving it is
    // the lesser problem, and it is bounded by the token's own expiry.
    setAccessToken(null);
  }
}
