/**
 * "Password": changing it while signed in, its own form and its own action (settings.dc.html).
 *
 * What happens is said before the button, as the server does it (ADR-0051): this device stays
 * signed in, every other one is signed out, and the address is told. "Within 30 minutes"
 * because an access token already issued stays good until it expires, and "on its way" because
 * a mail that fails does not undo the change (ADR-0018); the drawing promised more than either
 * (decided on 2026-11-23). A wrong current password is the server's sentence under its field.
 * Too many attempts says when, from Retry-After, and holds the button until then.
 */
import { useEffect, useId, useRef, useState, type SyntheticEvent } from "react";

import { ApiError, api } from "../api/client";
import { clock, zonedMinutes } from "../lib/time";
import { cx } from "../lib/cx";
import styles from "./Settings.module.css";

const MAX_LENGTH = 128;
const MIN_LENGTH = 8;

/** `You can try again at 14:35, in 15 minutes.`, in the account's zone. */
export function tryAgainText(seconds: number, timeZone: string, now: Date = new Date()): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  const at = clock(zonedMinutes(new Date(now.getTime() + minutes * 60_000).toISOString(), timeZone));
  return `You can try again at ${at}, in ${String(minutes)} ${minutes === 1 ? "minute" : "minutes"}.`;
}

interface Props {
  email: string;
  timezone: string;
}

export function PasswordForm({ email, timezone }: Props): React.ReactNode {
  const id = useId();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [shown, setShown] = useState(false);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [limit, setLimit] = useState<{ until: number; detail: string; text: string } | null>(null);
  const [done, setDone] = useState(false);
  const currentField = useRef<HTMLInputElement>(null);
  const nextField = useRef<HTMLInputElement>(null);
  const again = useRef<HTMLButtonElement>(null);

  // The hold ends when the server said it would, and the button with it.
  useEffect(() => {
    if (limit === null) return;
    const timer = window.setTimeout(() => {
      setLimit(null);
    }, Math.max(0, limit.until - Date.now()));
    return () => {
      window.clearTimeout(timer);
    };
  }, [limit]);

  const currentError =
    wrong ?? (tried && current === "" ? "Type your current password." : null);
  const nextError = tried && next.length < MIN_LENGTH ? "At least 8 characters." : null;

  async function change(event: SyntheticEvent): Promise<void> {
    event.preventDefault();
    if (busy || limit !== null) return;
    setTried(true);
    if (current === "" || next.length < MIN_LENGTH) {
      (current === "" ? currentField : nextField).current?.focus();
      return;
    }
    setBusy(true);
    setWrong(null);
    setFailure(null);
    try {
      await api.post<undefined>("/auth/change-password", {
        current_password: current,
        new_password: next,
      });
      setCurrent("");
      setNext("");
      setTried(false);
      setDone(true);
    } catch (problem) {
      if (problem instanceof ApiError && problem.status === 429) {
        const seconds = problem.retryAfter ?? 60;
        setLimit({
          until: Date.now() + seconds * 1000,
          detail: problem.detail,
          text: tryAgainText(seconds, timezone),
        });
      } else if (problem instanceof ApiError && problem.status === 422) {
        setWrong(problem.detail);
      } else {
        setFailure(
          problem instanceof ApiError
            ? `${problem.detail} Your password was not changed.`
            : "Couldn’t reach the server. Your password was not changed.",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  // Focus follows the confirmation in, so its sentence is where the reader is.
  useEffect(() => {
    if (done) again.current?.focus();
  }, [done]);

  // A wrong current password takes focus back to its field, once the field is open again.
  useEffect(() => {
    if (wrong !== null && !busy) currentField.current?.focus();
  }, [wrong, busy]);

  return (
    <section aria-labelledby={`${id}-heading`} className={styles.section}>
      <h2 id={`${id}-heading`} className={styles.heading}>
        Password
      </h2>
      {done ? (
        <div role="status" className={styles.done}>
          <strong>Password changed.</strong>
          <span className={styles.pretty}>
            You’re still signed in here. Every other device is signed out within 30 minutes, and
            an email about it is on its way to {email}.
          </span>
          <button
            ref={again}
            type="button"
            className={styles.button}
            onClick={() => {
              setDone(false);
            }}
          >
            Change it again
          </button>
        </div>
      ) : (
        <form
          className={styles.form}
          noValidate
          aria-busy={busy}
          onSubmit={(event) => {
            void change(event);
          }}
        >
          <div className={styles.field}>
            <label htmlFor={`${id}-current`} className={styles.fieldLabel}>
              Current password
            </label>
            <input
              ref={currentField}
              id={`${id}-current`}
              type={shown ? "text" : "password"}
              autoComplete="current-password"
              className={cx(styles.input, currentError !== null && styles.inputBad)}
              value={current}
              maxLength={MAX_LENGTH}
              disabled={busy}
              aria-invalid={currentError !== null}
              aria-describedby={`${id}-current-error`}
              onChange={(event) => {
                setCurrent(event.target.value);
                setWrong(null);
              }}
            />
            <span id={`${id}-current-error`} className={styles.error}>
              {currentError}
            </span>
          </div>
          <div className={styles.field}>
            <label htmlFor={`${id}-new`} className={styles.fieldLabel}>
              New password
            </label>
            <input
              ref={nextField}
              id={`${id}-new`}
              type={shown ? "text" : "password"}
              autoComplete="new-password"
              className={cx(styles.input, nextError !== null && styles.inputBad)}
              value={next}
              maxLength={MAX_LENGTH}
              disabled={busy}
              aria-invalid={nextError !== null}
              aria-describedby={`${id}-new-help ${id}-new-error`}
              onChange={(event) => {
                setNext(event.target.value);
              }}
            />
            <span id={`${id}-new-help`} className={styles.count}>
              <span>8 to 128 characters.</span>
              <span className={styles.mono}>{`${String(next.length)} / ${String(MAX_LENGTH)}`}</span>
            </span>
            <span id={`${id}-new-error`} className={styles.error}>
              {nextError}
            </span>
          </div>
          <button
            type="button"
            className={cx(styles.button, styles.show)}
            aria-pressed={shown}
            onClick={() => {
              setShown((value) => !value);
            }}
          >
            {shown ? "Hide passwords" : "Show passwords"}
          </button>
          <div className={styles.when}>
            <strong>When you change it</strong>
            <ul className={styles.whenList}>
              <li>this device stays signed in;</li>
              <li>every other device is signed out within 30 minutes;</li>
              <li>an email tells {email} it changed.</li>
            </ul>
          </div>
          {limit !== null && (
            <div role="alert" className={styles.limit}>
              <strong className={styles.limitHead}>{limit.detail}</strong>
              <span className={styles.pretty}>{limit.text}</span>
            </div>
          )}
          <p role="alert" className={styles.error}>
            {failure}
          </p>
          <button
            type="submit"
            className={cx(styles.save, limit === null && styles.saveReady, styles.submit)}
            aria-busy={busy}
            aria-disabled={limit !== null}
          >
            {busy ? "Changing…" : "Change password"}
          </button>
        </form>
      )}
    </section>
  );
}
