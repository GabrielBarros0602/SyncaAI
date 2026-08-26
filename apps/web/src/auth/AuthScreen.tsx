/**
 * Entering, in three states and no router.
 *
 * Three screens' worth of behaviour with two forms, because a router for two forms is
 * machinery with nothing to route. There is one URL worth having — `/verify?token=` — and it
 * is served by reading the address rather than by routing to it, since nothing about that
 * arrival needs a second screen.
 *
 * The confirm state is not a dead end: it also takes a pasted code, so an account can be
 * created and confirmed without leaving the screen. That matters most in development, where
 * the mail goes to the API's log rather than to a mailbox.
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

/**
 * The token a verification link carries, read once per page load.
 *
 * At module scope rather than in a hook because that is the truthful scope: the address is a
 * property of the page load, not of a component that can mount twice. React's development
 * mode mounts every component twice, and a one-time token spent by the first mount would
 * fail on the second — the person would see "this link has already been used", about
 * themselves, half a second after arriving.
 */
const LINK_TOKEN: string | null = readTheLinkToken();

/**
 * The confirmation, started once and shared by every mount.
 *
 * A boolean "already sent" flag is the obvious guard and it is wrong: React's development
 * mode mounts, unmounts and remounts, so the flag would stop the second mount from asking
 * while the first mount's answer went to a component that no longer exists. Nobody would
 * ever see the result. Holding the promise instead means the mount that survives subscribes
 * to the request the mount that died started.
 */
let linkConfirmation: Promise<void> | null = null;

function readTheLinkToken(): string | null {
  const found = new URLSearchParams(window.location.search).get("token");
  if (found === null || found === "") return null;

  // Out of the address bar immediately. A single-use credential in a URL is written to
  // browser history, offered to autocomplete, and attached to the `Referer` header of the
  // next request that leaves the page. None of those are places it should reach, and it
  // costs one line to keep it out of all three.
  window.history.replaceState(null, "", window.location.pathname);
  return found;
}

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
  const arrivedByLink = LINK_TOKEN !== null;
  const [mode, setMode] = useState<Mode>(arrivedByLink ? "confirm" : "signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [timezone, setTimezone] = useState(browserZone);
  const [token, setToken] = useState(LINK_TOKEN ?? "");
  const [revealed, setRevealed] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  // Starts busy when the address carried a token: the request goes out on the first effect,
  // and a screen that renders idle for one frame before admitting it is working is a flicker
  // with nothing behind it. Derived rather than set inside the effect, which would cascade a
  // second render for a fact already known before the first.
  const [busy, setBusy] = useState(arrivedByLink);

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

  /**
   * Confirm on arrival, without asking again.
   *
   * Opening the link *is* the confirmation — the person already acted, in their mail client.
   * A form asking them to press "confirm" a second time is a step that exists only because
   * of how this screen happens to be built, and they have no way to know that.
   *
   * Not routed through `run`, which reads the form's fields; this reads the address.
   */
  useEffect(() => {
    const carried = LINK_TOKEN;
    if (carried === null) return;

    let live = true;
    linkConfirmation ??= auth.verify(carried);
    linkConfirmation
      .then(() => {
        if (!live) return;
        setToken("");
        setMode("signIn");
        setNote("Confirmed. Sign in below.");
      })
      .catch((cause: unknown) => {
        if (!live) return;
        // The token stays in the field on failure. An expired link and a mistyped code fail
        // the same way, and leaving it visible is what lets somebody see which they have.
        const failure = problemOf(cause);
        setProblem(failure);
        setRetryIn(failure.retryAfter);
      })
      .finally(() => {
        if (live) setBusy(false);
      });

    return () => {
      live = false;
    };
  }, []);

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

  // Arriving by the link and arriving by "I have a code" are the same state with different
  // copy. Telling somebody who just clicked a link to check their inbox is the interface
  // failing to notice where the person came from.
  const headline = signingIn
    ? "Welcome back"
    : signingUp
      ? "Start the week"
      : !arrivedByLink
        ? "Check your inbox"
        : busy
          ? "Confirming"
          : "That link is spent";

  const lede = signingIn
    ? "A day's capacity is a number the database knows, not a suggestion. Sign in to see what this week actually holds."
    : signingUp
      ? "The time zone decides which day a task lands on, so it is the one field worth reading twice."
      : !arrivedByLink
        ? "If that address needs an account, a confirmation link is on its way. Paste the code to finish."
        : busy
          ? "You opened the link from your mail. This finishes by itself."
          : // A link works once. The way to another one is the sign-in screen, which offers
            // it on the unverified error — not registering again, which answers the same 202
            // it always does and sends nothing new.
            "A link works once and expires in a day. Sign in and another will be offered.";

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
            <h1 className={styles.headline}>{headline}</h1>
            <p className={styles.lede}>{lede}</p>
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
