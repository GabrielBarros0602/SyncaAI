/**
 * Entering, in three states and no router.
 *
 * Three screens' worth of behaviour with two forms, because a router for two forms is
 * machinery with nothing to route. It arrives when there is a URL worth having — the
 * password reset link will be the first, since it carries a token in the address.
 *
 * The confirm state is not a dead end: it takes the code, so an account can be created and
 * confirmed without leaving the screen. That matters most in development, where the mail
 * goes to the API's log rather than to a mailbox.
 */
import { useEffect, useState, type SyntheticEvent } from "react";

import { ApiError } from "../api/client";
import * as auth from "./api";
import { cx } from "../lib/cx";
import { useSession } from "./useSession";
import styles from "./Auth.module.css";

type Mode = "signIn" | "signUp" | "confirm";

/** The one error whose answer is an action rather than a correction. */
const UNVERIFIED = "Confirm your address before signing in.";

/** The browser's zone, offered as a default the user can change. */
function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "America/Sao_Paulo";
  }
}

interface Problem {
  message: string;
  /** Seconds the server asked the caller to wait, from its own `Retry-After`. */
  retryAfter: number;
}

function problemOf(cause: unknown): Problem {
  // The API's own sentence when it has one. It already decided what is safe to say —
  // "Incorrect email or password" is one message for a missing account and a wrong
  // password, and rewording here would risk splitting them apart again (ADR-0019).
  if (cause instanceof ApiError) {
    return { message: cause.detail, retryAfter: cause.retryAfter ?? 0 };
  }
  return { message: "Couldn't reach the server.", retryAfter: 0 };
}

function asClock(seconds: number): string {
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")}`;
}

export function AuthScreen(): React.ReactNode {
  const { signIn } = useSession();
  const [mode, setMode] = useState<Mode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [timezone, setTimezone] = useState(browserZone);
  const [token, setToken] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [busy, setBusy] = useState(false);

  const [retryIn, setRetryIn] = useState(0);
  const blocked = busy || retryIn > 0;

  // Counted down one second at a time from the server's own Retry-After. The write happens
  // in the timer's callback rather than in the effect body, so the remaining seconds are
  // never a second copy of something else that could drift from it.
  useEffect(() => {
    if (retryIn <= 0) return;
    const timer = setTimeout(() => {
      setRetryIn(retryIn - 1);
    }, 1000);
    return () => {
      clearTimeout(timer);
    };
  }, [retryIn]);

  function go(next: Mode): void {
    setMode(next);
    setProblem(null);
    setNote(null);
    setResent(false);
  }

  async function run(work: () => Promise<void>): Promise<void> {
    setBusy(true);
    setProblem(null);
    setNote(null);
    setResent(false);
    try {
      await work();
    } catch (cause) {
      const failure = problemOf(cause);
      setProblem(failure);
      setRetryIn(failure.retryAfter);
    } finally {
      setBusy(false);
    }
  }

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    if (blocked) return;

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
        setNote("Confirmed. Sign in below.");
      }
    });
  };

  /**
   * Deliberately not routed through `run`.
   *
   * `run` clears the current problem before it starts, which is right for a submission and
   * wrong here: the account is still unconfirmed after the link is sent, so the alert saying
   * so is still true. Clearing it would take a message that still applies off the screen and
   * replace it with a grey line under the button — a demotion for a fact that did not change.
   */
  const resend = (): void => {
    setBusy(true);
    void auth
      .resendVerification(email)
      .then(() => {
        setResent(true);
      })
      .catch((cause: unknown) => {
        const failure = problemOf(cause);
        setProblem(failure);
        setRetryIn(failure.retryAfter);
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const signingIn = mode === "signIn";
  const signingUp = mode === "signUp";
  const confirming = mode === "confirm";

  return (
    <div className={styles.screen}>
      <div className={styles.form}>
        <div className={cx(styles.top, styles.step)}>
          <span className={styles.wordmark}>SyncaAI</span>
          <span className={styles.status}>
            {busy ? "working" : confirming ? "one code, used once" : "no session"}
          </span>
        </div>

        <div key={mode} className={styles.swap}>
          <div className={cx(styles.lead, styles.step, styles.step1)}>
            <h1 className={styles.headline}>
              {signingIn ? "Welcome back" : signingUp ? "Start the week" : "Check your inbox"}
            </h1>
            <p className={styles.lede}>
              {signingIn
                ? "A day's capacity is a number the database knows, not a suggestion. Sign in to see what this week actually holds."
                : signingUp
                  ? "The time zone decides which day a task lands on, so it is the one field worth reading twice."
                  : "If that address needs an account, a confirmation link is on its way. Paste the code to finish."}
            </p>
          </div>

          {problem !== null && (
            <div role="alert" className={styles.alert}>
              <span className={styles.alertText}>{problem.message}</span>
              {problem.message === UNVERIFIED &&
                email !== "" &&
                (resent ? (
                  <span className={styles.alertNote}>Another link is on its way.</span>
                ) : (
                  <button
                    type="button"
                    className={styles.link}
                    onClick={resend}
                    disabled={busy}
                  >
                    Send the link again
                  </button>
                ))}
            </div>
          )}

          <form onSubmit={submit}>
            <div className={cx(styles.fields, styles.step, styles.step2)}>
              {!confirming && (
                <>
                  <div>
                    <div className={styles.fieldHead}>
                      <span className={styles.fieldIndex}>01</span>
                      <label htmlFor="auth-email" className={styles.label}>
                        Email
                      </label>
                    </div>
                    <input
                      id="auth-email"
                      className={styles.input}
                      type="email"
                      value={email}
                      onChange={(event) => {
                        setEmail(event.target.value);
                      }}
                      placeholder="you@example.com"
                      autoComplete="email"
                      required
                      autoFocus
                    />
                  </div>

                  <div>
                    <div className={styles.fieldHead}>
                      <span className={styles.fieldIndex}>02</span>
                      <label htmlFor="auth-password" className={styles.label}>
                        Password
                      </label>
                      {signingUp && (
                        <span className={styles.fieldProblem} style={{ color: "var(--faint)" }}>
                          eight or more
                        </span>
                      )}
                    </div>
                    <div className={styles.secret}>
                      <input
                        id="auth-password"
                        className={styles.input}
                        type={revealed ? "text" : "password"}
                        value={password}
                        onChange={(event) => {
                          setPassword(event.target.value);
                        }}
                        placeholder="&#183;&#183;&#183;&#183;&#183;&#183;&#183;&#183;"
                        autoComplete={signingIn ? "current-password" : "new-password"}
                        required
                      />
                      <button
                        type="button"
                        className={styles.reveal}
                        aria-pressed={revealed}
                        aria-label={revealed ? "Hide password" : "Show password"}
                        onClick={() => {
                          setRevealed(!revealed);
                        }}
                      >
                        {revealed ? "hide" : "show"}
                      </button>
                    </div>
                  </div>
                </>
              )}

              {signingUp && (
                <div>
                  <div className={styles.fieldHead}>
                    <span className={styles.fieldIndex}>03</span>
                    <label htmlFor="auth-zone" className={styles.label}>
                      Time zone
                    </label>
                  </div>
                  <input
                    id="auth-zone"
                    className={styles.input}
                    value={timezone}
                    onChange={(event) => {
                      setTimezone(event.target.value);
                    }}
                    required
                  />
                </div>
              )}

              {confirming && (
                <div>
                  <div className={styles.fieldHead}>
                    <span className={styles.fieldIndex}>01</span>
                    <label htmlFor="auth-code" className={styles.label}>
                      Confirmation code
                    </label>
                  </div>
                  <input
                    id="auth-code"
                    className={styles.input}
                    value={token}
                    onChange={(event) => {
                      setToken(event.target.value);
                    }}
                    required
                    autoFocus
                  />
                  <div className={styles.afterField}>
                    <span className={styles.status}>
                      running locally? the mail is in the API&rsquo;s log
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className={cx(styles.act, styles.step, styles.step3)}>
              <button type="submit" className={styles.submit} disabled={blocked}>
                <span>
                  {busy
                    ? "working…"
                    : signingIn
                      ? "sign in"
                      : signingUp
                        ? "create account"
                        : "confirm"}
                </span>
                <span className={styles.submitKey}>&#9166;</span>
              </button>
              <div className={styles.under}>
                <span>{note ?? (signingIn ? "your week is where you left it" : "")}</span>
                {retryIn > 0 && (
                  // The server's own Retry-After, not a guess. A guessed countdown either
                  // fails on retry or makes somebody wait longer than they had to.
                  <span className={styles.countdown}>retry in {asClock(retryIn)}</span>
                )}
              </div>
            </div>
          </form>
        </div>

        <div className={cx(styles.foot, styles.step, styles.step4)}>
          {signingIn ? (
            <span>
              New here?{" "}
              <button
                type="button"
                className={styles.linkStrong}
                onClick={() => {
                  go("signUp");
                }}
              >
                Create an account
              </button>{" "}
              ·{" "}
              <button
                type="button"
                className={styles.link}
                onClick={() => {
                  go("confirm");
                }}
              >
                I have a code
              </button>
            </span>
          ) : (
            <span>
              Already have an account?{" "}
              <button
                type="button"
                className={styles.linkStrong}
                onClick={() => {
                  go("signIn");
                }}
              >
                Sign in
              </button>
            </span>
          )}
          <span className={styles.zone}>{timezone}</span>
        </div>
      </div>

      <div className={styles.hero}>
        <div className={cx(styles.heroInner, styles.step, styles.step2)}>
          <p className={styles.heroLine}>
            Your Tuesday has <span className={styles.heroNumber}>90</span> minutes free.
          </p>
          <p className={styles.heroNote}>
            Seven days, the minutes each one holds, and what is left of them. Time as a
            contract, not a suggestion.
          </p>
        </div>
      </div>
    </div>
  );
}
