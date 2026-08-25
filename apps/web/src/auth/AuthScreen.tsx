/**
 * Entering, in three states and no router.
 *
 * Three screens' worth of behaviour with two forms, because a router for two forms is
 * machinery with nothing to route. It arrives when there is a URL worth having.
 *
 * The third state — check your inbox — is not a dead end. It takes the confirmation token,
 * so an account can be created and confirmed without leaving this screen. That matters more
 * than it looks in development, where the token arrives in the API's log rather than in a
 * mailbox.
 */
import { useState, type SyntheticEvent } from "react";

import { ApiError } from "../api/client";
import * as auth from "./api";
import { useSession } from "./useSession";
import styles from "./Auth.module.css";

type Mode = "signIn" | "signUp" | "confirm";

/** The browser's zone, offered as a default the user can change. */
function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "America/Sao_Paulo";
  }
}

function messageOf(problem: unknown): string {
  // The API's own sentence when it has one. It already decided what is safe to say —
  // "Incorrect email or password" is one message for a missing account and a wrong password,
  // and rewording it here would risk splitting them apart again (ADR-0019).
  if (problem instanceof ApiError) return problem.detail;
  return "Couldn't reach the server.";
}

export function AuthScreen(): React.ReactNode {
  const { signIn } = useSession();
  const [mode, setMode] = useState<Mode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [timezone, setTimezone] = useState(browserZone);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function go(next: Mode): void {
    setMode(next);
    setError(null);
  }

  async function run(work: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (problem) {
      setError(messageOf(problem));
    } finally {
      setBusy(false);
    }
  }

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    if (busy) return;

    void run(async () => {
      if (mode === "signIn") {
        await signIn({ email, password });
      } else if (mode === "signUp") {
        await auth.register({ email, password, timezone });
        // 202 whether or not the address already had an account, so there is nothing to
        // branch on — and nothing this screen can reveal that the API chose to hide.
        setMode("confirm");
      } else {
        await auth.verify(token);
        setToken("");
        setPassword("");
        setMode("signIn");
      }
    });
  };

  return (
    <div className={styles.screen}>
      <div className={styles.panel}>
        <div className={styles.head}>
          <span className={styles.wordmark}>SyncaAI</span>
          <span className={styles.tagline}>your week, in minutes you actually have</span>
        </div>

        {mode === "confirm" && (
          <div className={styles.sent}>
            <p className={styles.sentHead}>Check your inbox.</p>
            <p className={styles.sentNote}>
              If that address needs an account, a confirmation link is on its way. Paste the
              code below to finish.
            </p>
            <p className={styles.local}>
              Running locally? The mail goes to the API&rsquo;s log — look for the block
              starting <span style={{ color: "var(--dim)" }}>--- mail ---</span> in the
              terminal.
            </p>
          </div>
        )}

        <p className={styles.step}>{mode === "signUp" ? "02" : mode === "confirm" ? "03" : "01"}</p>
        <h1 className={styles.title}>
          {mode === "signIn" ? "Sign in" : mode === "signUp" ? "Create an account" : "Confirm"}
        </h1>
        <p className={styles.lede}>
          {mode === "signIn"
            ? "Your week is waiting where you left it."
            : mode === "signUp"
              ? "The time zone decides which day a task lands on, so it is worth getting right."
              : "One code, used once."}
        </p>

        <form className={styles.form} onSubmit={submit}>
          {mode !== "confirm" && (
            <>
              <label className={styles.field}>
                <span className={styles.label}>Email</span>
                <input
                  className={styles.input}
                  type="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                  }}
                  autoComplete="email"
                  required
                  autoFocus
                />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Password</span>
                <input
                  className={styles.input}
                  type="password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                  }}
                  autoComplete={mode === "signIn" ? "current-password" : "new-password"}
                  required
                />
                {mode === "signUp" && (
                  <span className={styles.hint}>
                    Eight characters or more. No other rules — what makes this expensive to
                    attack is the hashing, not a symbol you had to invent.
                  </span>
                )}
              </label>
            </>
          )}

          {mode === "signUp" && (
            <label className={styles.field}>
              <span className={styles.label}>Time zone</span>
              <input
                className={styles.inputMono}
                value={timezone}
                onChange={(event) => {
                  setTimezone(event.target.value);
                }}
                required
              />
            </label>
          )}

          {mode === "confirm" && (
            <label className={styles.field}>
              <span className={styles.label}>Confirmation code</span>
              <input
                className={styles.inputMono}
                value={token}
                onChange={(event) => {
                  setToken(event.target.value);
                }}
                required
                autoFocus
              />
            </label>
          )}

          {error !== null && (
            <div role="alert" className={styles.error}>
              {error}
            </div>
          )}

          <button type="submit" className={styles.submit} disabled={busy}>
            <span>
              {busy
                ? "working…"
                : mode === "signIn"
                  ? "sign in"
                  : mode === "signUp"
                    ? "create account"
                    : "confirm"}
            </span>
            <span className={styles.submitKey}>&#9166;</span>
          </button>
        </form>

        <div className={styles.switch}>
          {mode === "signIn" ? (
            <>
              <span>No account yet?</span>
              <button
                type="button"
                className={styles.link}
                onClick={() => {
                  go("signUp");
                }}
              >
                Create one
              </button>
              <span>·</span>
              <button
                type="button"
                className={styles.link}
                onClick={() => {
                  go("confirm");
                }}
              >
                I have a code
              </button>
            </>
          ) : (
            <>
              <span>Already have an account?</span>
              <button
                type="button"
                className={styles.link}
                onClick={() => {
                  go("signIn");
                }}
              >
                Sign in
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
