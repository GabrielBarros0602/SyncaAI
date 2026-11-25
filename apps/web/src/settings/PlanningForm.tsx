/**
 * "Your day and your plans": the usable day, the days off and the block, with one Save
 * (settings.dc.html).
 *
 * One form because the server judges the three as one request and writes none of them when one
 * part is refused. The refusal is the server's sentence, word for word, under the part it names
 * (ADR-0060), with a line above Save saying nothing was saved; what was typed stays to be fixed.
 * Nothing here pre-blocks the server's rules. The times are a task's fields, 24-hour and typed
 * (decided on 2026-11-23), and only a time that is not one is caught before sending.
 */
import { useEffect, useId, useRef, useState, type SyntheticEvent } from "react";

import { ApiError, api } from "../api/client";
import type { Me } from "../api/types";
import { cx } from "../lib/cx";
import { formatCompact, parseClock, weekdayLong, weekdayName } from "../lib/time";
import {
  type Part,
  type Planning,
  changedParts,
  changesOf,
  lengthLine,
  partOf,
  planningOf,
  refusedLine,
  stateLine,
  stepBlock,
  windowMinutes,
} from "./planning";
import styles from "./Settings.module.css";

const WEEK = [1, 2, 3, 4, 5, 6, 7];

interface Props {
  me: Me;
  /** Saved: what the status region says, while the week is read again with the new budget. */
  onSaved: (text: string) => void;
}

export function PlanningForm({ me, onSaved }: Props): React.ReactNode {
  const id = useId();
  // What the server last said is saved. From the account once, then from each Save's answer:
  // the week reloading behind the page is not what decides what this form shows as saved.
  const [saved, setSaved] = useState(() => planningOf(me));
  const [draft, setDraft] = useState(saved);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<{ part: Part | null; text: string } | null>(null);
  const startField = useRef<HTMLInputElement>(null);
  const endField = useRef<HTMLInputElement>(null);
  const blockField = useRef<HTMLInputElement>(null);
  const offHelp = useRef<HTMLParagraphElement>(null);

  const parts = changedParts(saved, draft);
  const dirty = parts.length > 0;
  const startBad = tried && parseClock(draft.start) === null;
  const endBad = tried && parseClock(draft.end) === null;
  const refused = (part: Part): string | null => (refusal?.part === part ? refusal.text : null);
  const windowError = startBad || endBad ? "Use 24-hour time, like 14:30." : refused("window");
  const length = lengthLine(windowMinutes(draft));
  const block = Number(draft.block);

  // The part refused takes focus once the fields are open again, so nobody hunts for it.
  useEffect(() => {
    if (refusal === null || saving) return;
    const field = { window: startField, off: offHelp, block: blockField };
    if (refusal.part !== null) field[refusal.part].current?.focus();
  }, [refusal, saving]);

  /** From the draft as it is when React applies it: two quick taps of + are two steps. */
  function set(patch: Partial<Planning> | ((current: Planning) => Partial<Planning>)): void {
    setDraft((current) => ({ ...current, ...(typeof patch === "function" ? patch(current) : patch) }));
  }

  async function save(event: SyntheticEvent): Promise<void> {
    event.preventDefault();
    if (saving || !dirty) return;
    setTried(true);
    const changes = changesOf(saved, draft);
    if (changes === null) {
      (parseClock(draft.start) === null ? startField : endField).current?.focus();
      return;
    }
    setSaving(true);
    setRefusal(null);
    try {
      const kept = planningOf(await api.patch<Me>("/me", changes));
      setSaved(kept);
      setDraft(kept);
      setTried(false);
      onSaved(`Saved. Each day now has ${formatCompact(windowMinutes(kept) ?? 0)} to give.`);
    } catch (problem) {
      const part = problem instanceof ApiError ? partOf(problem.fields) : null;
      setRefusal(
        problem instanceof ApiError
          ? { part, text: problem.detail }
          : { part: null, text: "Couldn’t reach the server. Nothing was saved, and your changes are still here." },
      );
    } finally {
      setSaving(false);
    }
  }

  const summary =
    refusal === null ? null : refusal.part === null ? refusal.text : refusedLine(refusal.part);

  return (
    <section
      aria-labelledby={`${id}-heading`}
      className={cx(styles.section, refusal !== null && styles.sectionRefused)}
    >
      <div className={styles.intro}>
        <h2 id={`${id}-heading`} className={styles.heading}>
          Your day and your plans
        </h2>
        <p className={styles.note}>
          These three save together, with one Save. If one is refused, none of them is saved, and
          what you typed stays here to fix.
        </p>
      </div>
      <form
        className={styles.form}
        noValidate
        aria-busy={saving}
        onSubmit={(event) => {
          void save(event);
        }}
      >
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Usable day</legend>
          <div className={styles.times}>
            <div className={styles.time}>
              <label htmlFor={`${id}-start`} className={styles.label}>
                Starts
              </label>
              <input
                ref={startField}
                id={`${id}-start`}
                className={cx(styles.input, styles.mono, (startBad || refused("window") !== null) && styles.inputBad)}
                inputMode="numeric"
                value={draft.start}
                disabled={saving}
                aria-invalid={startBad || refused("window") !== null}
                aria-describedby={`${id}-length ${id}-window`}
                onChange={(event) => {
                  set({ start: event.target.value });
                }}
              />
            </div>
            <div className={styles.time}>
              <label htmlFor={`${id}-end`} className={styles.label}>
                Ends
              </label>
              <input
                ref={endField}
                id={`${id}-end`}
                className={cx(styles.input, styles.mono, (endBad || refused("window") !== null) && styles.inputBad)}
                inputMode="numeric"
                value={draft.end}
                disabled={saving}
                aria-invalid={endBad || refused("window") !== null}
                aria-describedby={`${id}-length ${id}-window`}
                onChange={(event) => {
                  set({ end: event.target.value });
                }}
              />
            </div>
          </div>
          <p id={`${id}-length`} className={styles.length}>
            <strong>{length.text}</strong> <span className={styles.muted}>{length.sub}</span>
          </p>
          <p id={`${id}-window`} role="alert" className={styles.error}>
            {windowError}
          </p>
        </fieldset>

        <fieldset className={styles.fieldset} aria-describedby={`${id}-off-help ${id}-off`}>
          <legend className={styles.legend}>Days off</legend>
          <p ref={offHelp} id={`${id}-off-help`} tabIndex={-1} className={styles.note}>
            A plan puts no steps on these days. They keep their usable day and their load; only
            plans skip them.
          </p>
          <ul className={styles.days}>
            {WEEK.map((weekday) => {
              const off = draft.off.includes(weekday);
              return (
                <li key={weekday}>
                  <button
                    type="button"
                    className={cx(styles.day, off && styles.dayOff, refused("off") !== null && styles.dayBad)}
                    aria-pressed={off}
                    aria-label={`${weekdayLong(weekday)}, ${off ? "day off" : "plans can use it"}`}
                    disabled={saving}
                    onClick={() => {
                      set((current) => ({
                        off: current.off.includes(weekday)
                          ? current.off.filter((day) => day !== weekday)
                          : [...current.off, weekday].sort((a, b) => a - b),
                      }));
                    }}
                  >
                    <span className={styles.dayShort}>{weekdayName(weekday)}</span>
                    <span className={styles.dayWord}>{off ? "off" : "plans"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p id={`${id}-off`} role="alert" className={styles.error}>
            {refused("off")}
          </p>
        </fieldset>

        <div className={styles.block}>
          <label htmlFor={`${id}-block`} className={styles.legend}>
            Longest step a plan proposes
          </label>
          <div className={styles.stepper}>
            <button
              type="button"
              className={styles.step}
              aria-label="15 minutes less"
              disabled={saving}
              onClick={() => {
                set((current) => ({ block: stepBlock(current.block, -15) }));
              }}
            >
              −
            </button>
            <input
              ref={blockField}
              id={`${id}-block`}
              className={cx(styles.input, styles.mono, styles.blockInput, refused("block") !== null && styles.inputBad)}
              inputMode="numeric"
              value={draft.block}
              disabled={saving}
              aria-invalid={refused("block") !== null}
              aria-describedby={`${id}-block-help ${id}-block-error`}
              onChange={(event) => {
                // Digits only, as a time field takes only a time: whatever is typed is a number.
                set({ block: event.target.value.replace(/\D/g, "") });
              }}
            />
            <button
              type="button"
              className={styles.step}
              aria-label="15 minutes more"
              disabled={saving}
              onClick={() => {
                set((current) => ({ block: stepBlock(current.block, 15) }));
              }}
            >
              +
            </button>
            <span className={styles.muted}>minutes{block >= 60 ? ` · ${formatCompact(block)}` : ""}</span>
          </div>
          <p id={`${id}-block-help`} className={styles.note}>
            From 15 minutes to 4 hours; 60 if you never change it. A plan splits anything longer
            into steps of this size or less.
          </p>
          <p id={`${id}-block-error`} role="alert" className={styles.error}>
            {refused("block")}
          </p>
        </div>

        {summary !== null && !saving && (
          <p role="alert" className={styles.summary}>
            {summary}
          </p>
        )}

        <div className={styles.actions}>
          <button
            type="submit"
            className={cx(styles.save, dirty && styles.saveReady)}
            aria-busy={saving}
            aria-disabled={!dirty}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {dirty && (
            <button
              type="button"
              className={styles.button}
              disabled={saving}
              onClick={() => {
                setDraft(saved);
                setRefusal(null);
                setTried(false);
              }}
            >
              Put back what’s saved
            </button>
          )}
          <span className={styles.state}>{stateLine(parts, saving, refusal !== null)}</span>
        </div>
      </form>
    </section>
  );
}
