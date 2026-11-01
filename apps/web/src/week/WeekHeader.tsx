/**
 * The top of the week: which week it is, the way to the others, and the Menu.
 *
 * As week-desktop.dc.html draws it, with two departures the base already made (ADR-0052): who
 * is signed in, the zone and signing out live in the Menu, and the Plan button arrives with
 * S8.
 *
 * The range is the page's heading. It is what changes when `[` or `]` is pressed, so it is
 * what a screen reader should be able to find, and the router puts focus on it on arrival.
 *
 * It stays on screen while a week loads, so a second press of › lands on the button the first
 * one left focus on rather than on a page with no button in it.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type SyntheticEvent } from "react";

import type { Me } from "../api/types";
import { Menu } from "../ui/Menu";
import styles from "./WeekHeader.module.css";

interface Props {
  /** `19 – 25 Oct 2026`. */
  range: string;
  /** Weeks from the one holding today; zero is this week. */
  offset: number;
  /** Null until the first week has arrived; the Menu waits for it. */
  me: Me | null;
  /** Today's local date, where "go to date" starts the first time it opens. */
  today: string;
  onGoTo: (offset: number) => void;
  /** Open the week holding a local date, with focus on that day. */
  onGoToDate: (localDate: string) => void;
  onSignOut: () => void;
}

export function WeekHeader({
  range,
  offset,
  me,
  today,
  onGoTo,
  onGoToDate,
  onSignOut,
}: Props): React.ReactNode {
  const form = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const [dateOpen, setDateOpen] = useState(false);
  // The last date gone to, so a second jump starts from the first; today until there is one.
  const [date, setDate] = useState<string | null>(null);

  useEffect(() => {
    if (dateOpen) field.current?.focus();
  }, [dateOpen]);

  function closeDate(): void {
    setDateOpen(false);
    toggle.current?.focus();
  }

  // On the field and both buttons, since a form takes no key handler of its own here.
  function onEscape(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closeDate();
  }

  function go(event: SyntheticEvent): void {
    event.preventDefault();
    // A date field half filled in reads as empty.
    if (date === null || date === "") return;
    // Focus goes to the day, not back to the button: the date was asked for to act there.
    onGoToDate(date);
    setDateOpen(false);
  }

  return (
    <header className={styles.header}>
      <div className={styles.lead}>
        <span className={styles.wordmark}>SyncaAI</span>
        <nav aria-label="Weeks" className={styles.nav}>
          <div className={styles.steps}>
            <button
              type="button"
              className={styles.step}
              aria-label="Previous week"
              aria-keyshortcuts="["
              onClick={() => {
                onGoTo(offset - 1);
              }}
            >
              ‹
            </button>
            <button
              type="button"
              className={styles.step}
              aria-label="Next week"
              aria-keyshortcuts="]"
              onClick={() => {
                onGoTo(offset + 1);
              }}
            >
              ›
            </button>
          </div>
          <h1 className={styles.range}>{range}</h1>
          {/* A label on this week and a way back from any other, never both: a button that
              does nothing where it stands reads as broken. */}
          {offset === 0 ? (
            <span className={styles.here}>this week</span>
          ) : (
            <button
              type="button"
              className={styles.back}
              aria-keyshortcuts="T"
              onClick={() => {
                onGoTo(0);
              }}
            >
              back to this week
              <kbd aria-hidden="true" className={styles.key}>
                T
              </kbd>
            </button>
          )}
          <div className={styles.goto}>
            <button
              ref={toggle}
              type="button"
              className={styles.back}
              aria-expanded={dateOpen}
              aria-controls={dateOpen ? form : undefined}
              onClick={() => {
                if (dateOpen) {
                  setDateOpen(false);
                  return;
                }
                setDate((last) => last ?? today);
                setDateOpen(true);
              }}
            >
              go to date
            </button>
            {dateOpen && (
              <form id={form} className={styles.popover} onSubmit={go}>
                <label htmlFor={`${form}-date`} className={styles.dateLabel}>
                  Date
                </label>
                <input
                  ref={field}
                  id={`${form}-date`}
                  type="date"
                  required
                  className={styles.dateInput}
                  value={date ?? ""}
                  aria-describedby={`${form}-hint`}
                  onChange={(event) => {
                    setDate(event.target.value);
                  }}
                  onKeyDown={onEscape}
                />
                <span id={`${form}-hint`} className={styles.hint}>
                  Opens the week that holds it and focuses that day.
                </span>
                <div className={styles.actions}>
                  <button type="submit" className={styles.go} onKeyDown={onEscape}>
                    go
                  </button>
                  <button type="button" className={styles.back} onClick={closeDate} onKeyDown={onEscape}>
                    cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </nav>
      </div>
      {me !== null && <Menu email={me.email} timezone={me.timezone} onSignOut={onSignOut} />}
    </header>
  );
}
