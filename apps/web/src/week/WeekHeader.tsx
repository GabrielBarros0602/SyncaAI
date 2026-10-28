/**
 * The top of the week: which week it is, the way to the others, and the Menu.
 *
 * As week-desktop.dc.html draws it, with two departures the base already made (ADR-0052): who
 * is signed in, the zone and signing out live in the Menu, and the Plan button arrives with
 * S8. "go to date" is the round's too, and comes in its own change.
 *
 * The range is the page's heading. It is what changes when `[` or `]` is pressed, so it is
 * what a screen reader should be able to find, and the router puts focus on it on arrival.
 *
 * It stays on screen while a week loads, so a second press of › lands on the button the first
 * one left focus on rather than on a page with no button in it.
 */
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
  onGoTo: (offset: number) => void;
  onSignOut: () => void;
}

export function WeekHeader({
  range,
  offset,
  me,
  onGoTo,
  onSignOut,
}: Props): React.ReactNode {
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
        </nav>
      </div>
      {me !== null && <Menu email={me.email} timezone={me.timezone} onSignOut={onSignOut} />}
    </header>
  );
}
