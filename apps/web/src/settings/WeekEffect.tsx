/**
 * The week under the usable day: what a change of the hours does to each day, before Save
 * (settings.dc.html).
 *
 * Both columns are the server's. Now is `/capacity` as saved; after is the same days measured
 * against the window typed, which the server judges as Save would and writes nothing for
 * (ADR-0060). The level of a day is never worked out here (`load.ts`), and the budget behind it
 * is the real time between the two ends on that day, which on a clock-change day is not the
 * length on the clock. A window the server would refuse has no after: the refusal is Save's to
 * say, in the server's words, and the week shows what stands.
 */
import { useEffect, useId, useState } from "react";

import { api } from "../api/client";
import type { DayCapacity } from "../api/types";
import { clock, daysFrom, formatCompact, mondayOf, parseClock, toLocalDate, todayIn, weekdayName } from "../lib/time";
import { warningFor } from "../week/load";
import styles from "./Settings.module.css";

/** A pause in the typing before the week is measured again. */
const SETTLE_MS = 300;

interface Window {
  start: string;
  end: string;
}

interface Props {
  timezone: string;
  saved: Window;
  draft: Window;
}

function capacityPath(timezone: string, window?: Window): string {
  const week = daysFrom(mondayOf(todayIn(timezone))).map(toLocalDate);
  const path = `/capacity?first_day=${week[0] ?? ""}&last_day=${week[6] ?? ""}`;
  return window === undefined ? path : `${path}&day_starts_at=${window.start}&day_ends_at=${window.end}`;
}

/** The window as the server takes it, or null while either end is not a time yet. */
function typed(window: Window): Window | null {
  const start = parseClock(window.start);
  const end = parseClock(window.end);
  return start === null || end === null ? null : { start: clock(start), end: clock(end) };
}

function length(window: Window | null): number | null {
  if (window === null) return null;
  return (parseClock(window.end) ?? 0) - (parseClock(window.start) ?? 0);
}

export function WeekEffect({ timezone, saved, draft }: Props): React.ReactNode {
  const heading = useId();
  const [now, setNow] = useState<DayCapacity[] | null>(null);
  const [after, setAfter] = useState<DayCapacity[] | null>(null);
  const today = toLocalDate(todayIn(timezone));
  const changed = draft.start !== saved.start || draft.end !== saved.end;
  const asked = changed ? typed(draft) : null;

  // As saved, read again after every Save.
  useEffect(() => {
    let current = true;
    api.get<DayCapacity[]>(capacityPath(timezone)).then(
      (days) => {
        if (current) setNow(days);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [timezone, saved.start, saved.end]);

  // After, once the typing pauses. The last answer stays while the next is on its way, so the
  // week does not flicker back between keystrokes; a refused or unreachable read clears it.
  const askedStart = asked?.start;
  const askedEnd = asked?.end;
  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(() => {
      if (askedStart === undefined || askedEnd === undefined) {
        setAfter(null);
        return;
      }
      api.get<DayCapacity[]>(capacityPath(timezone, { start: askedStart, end: askedEnd })).then(
        (days) => {
          if (current) setAfter(days);
        },
        () => {
          if (current) setAfter(null);
        },
      );
    }, askedStart === undefined ? 0 : SETTLE_MS);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [timezone, askedStart, askedEnd]);

  if (now === null) return null;

  // Only while a window other than the saved one is typed; with none, the week is as saved.
  const later = asked === null ? null : after;
  const from = length(typed(saved));
  const to = length(asked);
  const head =
    later === null || from === null || to === null
      ? `This week, with ${formatCompact(from ?? 0)}`
      : `This week, ${formatCompact(from)} → ${formatCompact(to)} (not saved yet)`;

  return (
    <div role="group" aria-labelledby={heading} className={styles.effect}>
      <span id={heading} className={styles.effectHead}>
        {head}
      </span>
      <ul className={styles.effectDays}>
        {now.map((before, index) => {
          const then = later?.[index] ?? before;
          const moved = then.load !== before.load;
          const warning = warningFor(then).message;
          const level = moved
            ? `Becomes ${then.load}${warning === null ? "" : `: ${warning}`}`
            : warning;
          return (
            <li key={before.day} className={styles.effectDay}>
              <span className={styles.effectTop}>
                <span className={styles.effectName}>
                  {`${weekdayName(before.weekday)} ${String(Number(before.day.slice(8)))}`}
                  {before.day === today ? " · today" : ""}
                </span>
                <span className={styles.effectBooked}>{formatCompact(before.occupied_minutes)} booked</span>
              </span>
              <span className={styles.muted}>
                {`${formatCompact(before.free_minutes)} free of ${formatCompact(before.usable_minutes)}`}
                {then.usable_minutes === before.usable_minutes
                  ? ""
                  : ` → ${formatCompact(then.free_minutes)} of ${formatCompact(then.usable_minutes)}`}
              </span>
              {level !== null && (
                <span className={then.load === "fine" ? styles.effectCalm : styles.effectLoud}>{level}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
