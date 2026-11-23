/**
 * The top of the screen below 1100px, where one day is on screen (day-phone.dc.html).
 *
 * Below 640px it is three lines, as a phone is held: the name, Today, Plan and Menu; the week with
 * its arrows; the week at a glance, passed in, and under it the zone every day is read in. From
 * 640px it is one line that wraps, with the zone shortened to its offset.
 *
 * In the desktop's words where the two drawings name the same thing (docs/design/README.md):
 * "go to date", the range as `16 – 22 Nov 2026`, and the date sheet's "go" and "cancel".
 * "Today" is the phone's own: the desktop has no button for the day, only "back to this week".
 *
 * The range is the page's heading, as it is on a desktop, so the router puts focus on it on
 * arrival. Below 640px the drawing makes the range itself the way to another date; a heading
 * cannot sit inside a button, so the button is "go to date" under it, and its target is
 * stretched over both.
 */
import { useEffect, useId, useRef, useState, type SyntheticEvent } from "react";

import type { Me } from "../api/types";
import { cx } from "../lib/cx";
import { clockChange, startOfLocalDay, utcOffset, weekdayLong } from "../lib/time";
import { Menu } from "../ui/Menu";
import styles from "./DayHeader.module.css";
import form from "./WeekHeader.module.css";

interface Props {
  layout: "day" | "beside";
  /** `16 – 22 Nov 2026`. */
  range: string;
  /** Weeks from the one holding today; zero is this week. */
  offset: number;
  /** Null until the first week has arrived; the Menu and the zone wait for it. */
  me: Me | null;
  /** The seven local dates of the week on screen, Monday first. */
  days: string[];
  /** The local date of the one day on screen. */
  shown: string;
  /** Today's local date, where "go to date" starts the first time it opens. */
  today: string;
  /** Today is the day on screen, which the Today button says by being pressed. */
  onToday: boolean;
  onGoTo: (offset: number) => void;
  /** Today, in this week: what Today, T and "back to this week" mean here. */
  onBack: () => void;
  onGoToDate: (localDate: string) => void;
  /** Resolves once the server has ended the session; rejects when it did not. */
  onSignOut: () => Promise<void>;
  /** The Plan button, beside Menu at every width (plan.dc.html). */
  plan?: React.ReactNode;
  /**
   * The plan or the settings page is in place of the day: the top line alone, as the drawings
   * have it, since the week's arrows and the day's date would move nothing on screen.
   */
  reviewing?: boolean;
  /** The week at a glance, drawn under the week below 640px. */
  children?: React.ReactNode;
}

/** `Sunday 25`, for a local date. */
function longDay(localDate: string): string {
  const [year = 1970, month = 1, day = 1] = localDate.split("-").map(Number);
  const weekday = new Date(year, month - 1, day).getDay();
  return `${weekdayLong(weekday === 0 ? 7 : weekday)} ${String(day)}`;
}

/** `an hour`, `30 minutes`. */
function amount(minutes: number): string {
  return Math.abs(minutes) === 60 ? "an hour" : `${String(Math.abs(minutes))} minutes`;
}

/**
 * The zone as a sentence, always on screen, because it decides which day a task lands on.
 *
 * In a week whose clocks change it says when, since that is the day whose hours do not add up;
 * any other week gives the offset, read at the start of the day on screen.
 */
function zoneSentence(zone: string, days: string[], shown: string): { long: string; short: string } {
  const offset = utcOffset(startOfLocalDay(shown, zone), zone);
  const short = `${zone} · ${offset}`;
  for (const day of days) {
    const change = clockChange(day, zone);
    if (change !== null) {
      const way = change.by < 0 ? "back" : "forward";
      return {
        long: `Times in ${zone}. Clocks go ${way} ${amount(change.by)} at ${change.at} on ${longDay(day)}.`,
        short,
      };
    }
  }
  return { long: `Times in ${zone} (${offset}).`, short };
}

export function DayHeader({
  layout,
  range,
  offset,
  me,
  days,
  shown,
  today,
  onToday,
  onGoTo,
  onBack,
  onGoToDate,
  onSignOut,
  plan,
  reviewing = false,
  children,
}: Props): React.ReactNode {
  const zone = me === null ? null : zoneSentence(me.timezone, days, shown);

  const steps = (
    <>
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
      {/* The arrows stand either side of the range, so the range sits between them in the
          markup too; the heading is found by role, not by position. */}
      {layout === "day" ? (
        <div className={styles.range}>
          <h1 className={styles.rangeText}>{range}</h1>
          <DateSheet stretched today={today} onGoToDate={onGoToDate} onBack={onBack} />
        </div>
      ) : (
        <h1 className={styles.rangeText}>{range}</h1>
      )}
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
    </>
  );

  const todayButton = (
    <button type="button" className={styles.button} aria-pressed={onToday} aria-keyshortcuts="T" onClick={onBack}>
      Today
    </button>
  );
  const menu = me !== null && <Menu email={me.email} timezone={me.timezone} onSignOut={onSignOut} />;

  if (reviewing) {
    return (
      <header className={styles.narrow}>
        <div className={styles.top}>
          <span className={styles.wordmark}>SyncaAI</span>
          {plan}
          {menu}
        </div>
      </header>
    );
  }

  if (layout === "day") {
    return (
      <header className={styles.narrow}>
        <div className={styles.top}>
          <span className={styles.wordmark}>SyncaAI</span>
          {todayButton}
          {plan}
          {menu}
        </div>
        <nav aria-label="Weeks" className={styles.weeks}>
          {steps}
        </nav>
        {children}
        {zone !== null && <p className={styles.zone}>{zone.long}</p>}
      </header>
    );
  }

  return (
    <header className={styles.mid}>
      <span className={styles.wordmark}>SyncaAI</span>
      <nav aria-label="Weeks" className={styles.weeksInline}>
        {steps}
      </nav>
      {todayButton}
      <DateSheet today={today} onGoToDate={onGoToDate} onBack={onBack} />
      <span className={styles.zoneShort}>{zone?.short}</span>
      {plan}
      {menu}
    </header>
  );
}

interface SheetProps {
  /** Below 640px the button's target covers the range above it as well. */
  stretched?: boolean;
  today: string;
  onGoToDate: (localDate: string) => void;
  onBack: () => void;
}

/**
 * "go to date" and the sheet it opens from the bottom edge (day-phone.dc.html).
 *
 * The desktop's form, in the desktop's words, in a native modal dialog: the browser keeps
 * focus inside, makes the page behind inert and closes it on Esc. Focus goes back to the
 * button when it closes without going anywhere; after "go" it is on the day that was asked for.
 */
function DateSheet({ stretched = false, today, onGoToDate, onBack }: SheetProps): React.ReactNode {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  // The last date gone to, so a second jump starts from the first; today until there is one.
  const [date, setDate] = useState<string | null>(null);
  // Set when the sheet closes by going somewhere, which takes focus there instead.
  const went = useRef(false);

  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);

  function close(): void {
    dialog.current?.close();
  }

  function go(event: SyntheticEvent): void {
    event.preventDefault();
    // A date field half filled in reads as empty.
    if (date === null || date === "") return;
    // Closed first: closing a dialog puts focus back where it was, and the day comes after.
    went.current = true;
    close();
    onGoToDate(date);
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        className={cx(stretched ? styles.goto : styles.button)}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setDate((last) => last ?? today);
          went.current = false;
          dialog.current?.showModal();
          setOpen(true);
        }}
      >
        go to date
      </button>
      {/* A click on the dialog itself rather than on anything in it lands on the backdrop: a
          pointer's shortcut for cancel, which the keyboard has as Esc. */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
      <dialog
        ref={dialog}
        className={styles.sheet}
        aria-labelledby={`${id}-title`}
        onClose={() => {
          setOpen(false);
          if (!went.current) button.current?.focus();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
      >
        <form className={styles.sheetBody} onSubmit={go}>
          <div className={styles.sheetHead}>
            <h2 id={`${id}-title`} className={styles.sheetTitle}>
              Go to date
            </h2>
            <button type="button" className={styles.button} onClick={close}>
              cancel
            </button>
          </div>
          <label htmlFor={`${id}-date`} className={form.dateLabel}>
            Date
          </label>
          <input
            ref={field}
            id={`${id}-date`}
            type="date"
            required
            className={cx(form.dateInput, styles.dateInput)}
            value={date ?? ""}
            aria-describedby={`${id}-hint`}
            onChange={(event) => {
              setDate(event.target.value);
            }}
          />
          <span id={`${id}-hint`} className={form.hint}>
            Opens the week that holds it and focuses that day.
          </span>
          <div className={styles.sheetActions}>
            <button type="submit" className={cx(form.go, styles.primary)}>
              go
            </button>
            <button
              type="button"
              className={styles.button}
              onClick={() => {
                close();
                onBack();
              }}
            >
              back to this week
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
