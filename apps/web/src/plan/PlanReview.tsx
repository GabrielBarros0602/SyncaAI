/**
 * The plan screen, as plan.dc.html draws it (ADR-0052): asking for a plan, waiting for it,
 * the failure if it does not come, and the plan under review.
 *
 * A full view in place of the week, with ‹ Week to go back; from 1640px, where all seven days
 * still fit beside it, a panel beside the week, whose days show the proposed steps. Under
 * review: what was asked, the days it covers, how many steps were kept and discarded, what it
 * adds to each day, the steps in order and the steps the check discarded. Approve and Discard
 * sit at its foot, and below 1100px where the bar between days is.
 *
 * The review is read only, for now: giving a step a time, editing, removing and adding come
 * with the next steps of the screen (docs/backlog.md, "As telas do plano").
 */
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ApiError } from "../api/client";
import type { Job, Plan, PlanItem } from "../api/types";
import { cx } from "../lib/cx";
import { formatCompact, toLocalDate, todayIn } from "../lib/time";
import {
  MAX_HORIZON,
  MAX_REQUEST,
  horizonHelp,
  horizonOptions,
  retryText,
  waitLine,
  waitWord,
} from "./asking";
import styles from "./Plan.module.css";
import {
  afterText,
  countText,
  coverText,
  hostOf,
  impactLines,
  precheckText,
  shortDate,
  stepNumbers,
  stepWhen,
} from "./steps";
import type { PlanState } from "./usePlan";

/** A refusal shown above the steps. `reread` offers to read the plan again. */
interface Refusal {
  detail: string;
  /** Each refused step's reason, by its id. */
  steps: Map<string, string>;
  /** The refused steps in the order the server named them, which is the plan's. */
  order: { id: string; title: string; reason: string }[];
  reread: boolean;
}

function refusalOf(problem: unknown): Refusal {
  if (problem instanceof ApiError) {
    return {
      detail: problem.detail,
      steps: new Map(problem.items.map((item) => [item.id, item.reason])),
      order: problem.items,
      // Without steps to change, what changed is elsewhere: a task booked on a step's time just
      // now, or a plan no longer open. Reading the plan again is what shows which.
      reread: problem.items.length === 0,
    };
  }
  return { detail: "Couldn’t reach the server.", steps: new Map(), order: [], reread: false };
}

interface Props {
  /** The panel beside the week; otherwise the view in place of it. */
  wide: boolean;
  state: PlanState;
  timezone: string;
  /** The step to put focus on when the review opens, from its proposed row in the week. */
  focusStep: string | null;
  /**
   * Below 1100px Approve and Discard go in `barSlot`: the place of the bar between days, under
   * the status region, which stays where it is so a notice it holds is still announced.
   */
  docked: boolean;
  barSlot: HTMLElement | null;
  /** The person's days off, which the form's help names when the plan stays in this week. */
  daysOff: readonly number[];
  onClose: () => void;
  onApproved: (tasks: number) => void;
  onDiscarded: () => void;
}

/** Which of the screen's views is showing, from what the server said and what was asked here. */
type View = "loading" | "review" | "wait" | "ask" | "failed" | "expired";

const TITLES: Record<Exclude<View, "review">, string> = {
  loading: "The plan",
  wait: "Your plan",
  ask: "Ask for a plan",
  failed: "The plan didn’t come",
  expired: "The plan",
};

export function PlanReview({
  wide,
  state,
  timezone,
  focusStep,
  docked,
  barSlot,
  daysOff,
  onClose,
  onApproved,
  onDiscarded,
}: Props): React.ReactNode {
  const heading = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { plan, job } = state;
  const pending = plan?.status === "pending" ? plan : null;
  // The form, opened from a failure or a closed plan with what it asked written in again.
  const [asking, setAsking] = useState<string | null>(null);

  const view: View =
    state.status !== "ready"
      ? "loading"
      : pending !== null
        ? "review"
        : job !== null && job.status !== "failed"
          ? "wait"
          : asking !== null
            ? "ask"
            : job?.status === "failed"
              ? "failed"
              : plan?.status === "expired"
                ? "expired"
                : "ask";

  // The view changed under whoever was in it: the form went once sent, the wait once the plan
  // came. Focus left on what went lands on the heading rather than on the page; arrival is the
  // router's to place.
  const arrived = useRef(false);
  useEffect(() => {
    if (!arrived.current) {
      arrived.current = true;
      return;
    }
    if (document.activeElement === null || document.activeElement === document.body) {
      headingRef.current?.focus();
    }
  }, [view]);

  const title =
    view !== "review" ? TITLES[view] : pending?.job_id === null ? "Your plan" : "Review the plan";

  return (
    <div className={wide ? styles.panel : styles.view}>
      <section aria-labelledby={heading} className={styles.body}>
        <div className={styles.head}>
          {!wide && (
            <button type="button" className={styles.back} onClick={onClose}>
              ‹ Week
            </button>
          )}
          {/* Where the router puts focus on arrival, unless a step was asked for. */}
          <h2
            ref={headingRef}
            id={heading}
            tabIndex={-1}
            className={styles.heading}
            data-route-focus={focusStep === null ? "" : undefined}
          >
            {title}
          </h2>
          {wide && (
            <button type="button" className={cx(styles.button, styles.close)} onClick={onClose}>
              Close
            </button>
          )}
        </div>
        {view === "review" && pending !== null && (
          <Review
            // Another plan is another review: nothing refused or confirmed carries over.
            key={pending.id}
            plan={pending}
            state={state}
            timezone={timezone}
            focusStep={focusStep}
            docked={docked}
            barSlot={barSlot}
            onApproved={onApproved}
            onDiscarded={onDiscarded}
          />
        )}
        {view === "loading" && <Unread state={state} />}
        {view === "wait" && job !== null && <Waiting job={job} timezone={timezone} wide={wide} onClose={onClose} />}
        {view === "ask" && (
          <AskForm
            state={state}
            timezone={timezone}
            daysOff={daysOff}
            initial={asking ?? ""}
            onSent={() => {
              setAsking(null);
            }}
          />
        )}
        {view === "failed" && job !== null && (
          <div role="alert" className={styles.alert}>
            <strong>{job.failure_reason}</strong>
            {job.request !== null && <blockquote className={styles.request}>{job.request}</blockquote>}
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.primary}
                onClick={() => {
                  setAsking(job.request ?? "");
                }}
              >
                Ask for it again
              </button>
            </div>
          </div>
        )}
        {view === "expired" && plan !== null && (
          <>
            <p role="alert" className={styles.expired}>
              This plan is no longer open for review.
            </p>
            <p className={styles.quiet}>
              It covered {shortDate(plan.first_day)} – {shortDate(plan.last_day)}, and the last day
              passed before it was reviewed. Nothing from it was written.
            </p>
            <p className={styles.request}>{plan.request}</p>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.primary}
                onClick={() => {
                  setAsking(plan.request);
                }}
              >
                Ask for a new plan
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/** Before the server has said what there is, or when it could not be reached. */
function Unread({ state }: { state: PlanState }): React.ReactNode {
  if (state.status === "loading") return <p className={styles.quiet}>Reading the plan…</p>;
  return (
    <div role="alert" className={styles.alert}>
      <strong>Couldn’t reach the server.</strong>
      <button
        type="button"
        className={styles.button}
        onClick={() => {
          void state.reload().catch(() => undefined);
        }}
      >
        Try again
      </button>
    </div>
  );
}

interface WaitingProps {
  job: Job;
  timezone: string;
  wide: boolean;
  onClose: () => void;
}

/** A request being made. Nothing moves: the word changes, so reduced motion changes nothing. */
function Waiting({ job, timezone, wide, onClose }: WaitingProps): React.ReactNode {
  return (
    <div aria-busy="true" className={styles.wait}>
      <p role="status" className={styles.waitWord}>
        {waitWord(job)}
      </p>
      <p className={styles.quiet}>{waitLine(job, timezone)}</p>
      {job.request !== null && <blockquote className={styles.request}>{job.request}</blockquote>}
      <p className={styles.quiet}>
        You can go back to the week. The request keeps its place here, and the notice at the bottom
        says when the plan is ready.
      </p>
      {!wide && (
        <button type="button" className={cx(styles.button, styles.close)} onClick={onClose}>
          Back to the week
        </button>
      )}
    </div>
  );
}

/** A refused request: the server's sentence, and when it may be sent again. */
interface AskRefusal {
  detail: string;
  retry: string | null;
  /** One plan at a time: the one there is can be opened from here. */
  open: boolean;
}

function refusalOfAsk(problem: unknown, timezone: string): AskRefusal {
  if (!(problem instanceof ApiError)) {
    return { detail: "Couldn’t reach the server.", retry: null, open: false };
  }
  return {
    detail: problem.detail,
    retry: problem.retryAfter === null ? null : retryText(problem.retryAfter, timezone),
    open: problem.status === 409,
  };
}

interface AskFormProps {
  state: PlanState;
  timezone: string;
  daysOff: readonly number[];
  /** What to write in the field: a failed or closed plan's request, asked for again. */
  initial: string;
  /** Queued: what was asked for again is asked, and a failure of it shows as one. */
  onSent: () => void;
}

/** What to plan and for how many days. Sent, the server queues it or says why not. */
function AskForm({ state, timezone, daysOff, initial, onSent }: AskFormProps): React.ReactNode {
  const id = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(initial);
  const [days, setDays] = useState(MAX_HORIZON);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<AskRefusal | null>(null);
  const today = toLocalDate(todayIn(timezone));
  const empty = text.trim() === "";
  const bad = tried && empty;

  async function send(): Promise<void> {
    if (busy) return;
    if (empty) {
      setTried(true);
      field.current?.focus();
      return;
    }
    setBusy(true);
    setRefusal(null);
    try {
      // Sent, the wait takes the form's place.
      await state.ask(text.trim(), days);
      onSent();
    } catch (problem) {
      setRefusal(refusalOfAsk(problem, timezone));
      setBusy(false);
    }
  }

  return (
    <form
      className={styles.form}
      aria-busy={busy}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <div className={styles.field}>
        <label htmlFor={`${id}-request`} className={styles.fieldLabel}>
          What do you want to plan?
        </label>
        <textarea
          ref={field}
          id={`${id}-request`}
          className={cx(styles.textarea, bad && styles.fieldBad)}
          rows={4}
          maxLength={MAX_REQUEST}
          value={text}
          aria-invalid={bad}
          aria-describedby={`${id}-help ${id}-error`}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
        <div className={styles.fieldFoot}>
          <span id={`${id}-error`} className={styles.fieldError}>
            {bad ? "Write what you want to plan." : ""}
          </span>
          <span className={styles.counter}>
            {text.length} / {MAX_REQUEST}
          </span>
        </div>
        <p id={`${id}-help`} className={styles.quiet}>
          The steps come back in your words and go into your free time. The model sees how much of
          each day is free, never what your tasks are.
        </p>
      </div>
      <div className={styles.field}>
        <label htmlFor={`${id}-days`} className={styles.label}>
          Days ahead
        </label>
        <select
          id={`${id}-days`}
          className={styles.select}
          value={days}
          aria-describedby={`${id}-days-help`}
          onChange={(event) => {
            setDays(Number(event.target.value));
          }}
        >
          {horizonOptions(today).map((option) => (
            <option key={option.days} value={option.days}>
              {option.label}
            </option>
          ))}
        </select>
        <p id={`${id}-days-help`} className={styles.quiet}>
          {horizonHelp(today, days, daysOff)}
        </p>
      </div>
      {refusal !== null && (
        <div role="alert" className={styles.alert}>
          <strong>{refusal.detail}</strong>
          {refusal.retry !== null && <span className={styles.problem}>{refusal.retry}</span>}
          {refusal.open && (
            <button
              type="button"
              className={styles.button}
              onClick={() => {
                void state.reload().catch(() => undefined);
              }}
            >
              Open the plan you have
            </button>
          )}
        </div>
      )}
      <div className={styles.actions}>
        <button type="submit" className={styles.primary} aria-busy={busy}>
          {busy ? "Sending…" : "Make a plan"}
        </button>
      </div>
    </form>
  );
}

interface ReviewProps {
  plan: Plan;
  state: PlanState;
  timezone: string;
  focusStep: string | null;
  docked: boolean;
  barSlot: HTMLElement | null;
  onApproved: (tasks: number) => void;
  onDiscarded: () => void;
}

function Review({
  plan,
  state,
  timezone,
  focusStep,
  docked,
  barSlot,
  onApproved,
  onDiscarded,
}: ReviewProps): React.ReactNode {
  const discardedHeading = useId();
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [busy, setBusy] = useState<"approve" | "discard" | "reread" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const alert = useRef<HTMLDivElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const discardPlan = useRef<HTMLButtonElement>(null);
  const confirmed = useRef(false);

  // Into the question when it opens, on the safe answer; back to the button when it closes
  // without discarding.
  useEffect(() => {
    if (confirming) keep.current?.focus();
    else if (confirmed.current) discardPlan.current?.focus();
    confirmed.current = confirming;
  }, [confirming]);

  // A refusal is where the eye has to go next, so focus goes there, as the drawing has it.
  // After the question above, so a discard refused while it was open still lands here.
  useEffect(() => {
    if (refusal !== null) alert.current?.focus();
  }, [refusal]);

  const numbers = stepNumbers(plan);
  const impact = impactLines(plan, state.capacity, timezone);
  const precheck = precheckText(plan);
  const count = plan.items.length;

  async function approve(): Promise<void> {
    if (busy !== null) return;
    setBusy("approve");
    setRefusal(null);
    try {
      const made = await state.approve();
      onApproved(made.task_ids.length);
    } catch (problem) {
      setRefusal(refusalOf(problem));
    } finally {
      setBusy(null);
    }
  }

  async function discard(): Promise<void> {
    if (busy !== null) return;
    setBusy("discard");
    try {
      await state.discard();
      onDiscarded();
    } catch (problem) {
      setConfirming(false);
      setRefusal(refusalOf(problem));
    } finally {
      setBusy(null);
    }
  }

  async function reread(): Promise<void> {
    if (busy !== null) return;
    setBusy("reread");
    try {
      await state.reload();
      setRefusal(null);
    } catch (problem) {
      setRefusal(refusalOf(problem));
    } finally {
      setBusy(null);
    }
  }

  const bar = (
    <div className={styles.bar}>
      {precheck !== null && <span className={styles.quiet}>{precheck}</span>}
      {confirming ? (
        <div role="group" aria-label="Discard this plan?" className={styles.confirm}>
          <span className={styles.confirmText}>
            Discard this plan? {count === 1 ? "Its step won’t become a task." : `Its ${String(count)} steps won’t become tasks.`}
          </span>
          <button
            type="button"
            className={styles.danger}
            aria-busy={busy === "discard"}
            onClick={() => {
              void discard();
            }}
          >
            Discard
          </button>
          <button
            ref={keep}
            type="button"
            className={styles.button}
            onClick={() => {
              setConfirming(false);
            }}
          >
            Keep it
          </button>
        </div>
      ) : (
        <div className={styles.actions}>
          <button
            ref={discardPlan}
            type="button"
            className={styles.button}
            onClick={() => {
              setConfirming(true);
            }}
          >
            Discard plan
          </button>
          <button
            type="button"
            className={styles.primary}
            aria-busy={busy === "approve"}
            onClick={() => {
              void approve();
            }}
          >
            {busy === "approve"
              ? "Approving…"
              : `Approve: make ${String(count)} ${count === 1 ? "task" : "tasks"}`}
          </button>
        </div>
      )}
    </div>
  );

  return (
    <>
      <div className={styles.asked}>
        {plan.job_id === null ? (
          <>
            <span className={styles.label}>What it’s for</span>
            <p className={styles.request}>{plan.request}</p>
          </>
        ) : (
          <>
            <span className={styles.quiet}>You asked</span>
            <blockquote className={styles.request}>{plan.request}</blockquote>
          </>
        )}
        <p className={styles.quiet}>{coverText(plan)}</p>
        <p className={styles.count}>{countText(plan)}</p>
      </div>

      {refusal !== null && (
        <div ref={alert} role="alert" tabIndex={-1} className={styles.alert}>
          <strong>{refusal.detail}</strong>
          {refusal.order.map((step) => (
            <span key={step.id} className={styles.problem}>
              Step {numbers.get(step.id) ?? "?"}, {step.title}: {step.reason}
            </span>
          ))}
          {refusal.reread && (
            <button
              type="button"
              className={styles.button}
              aria-busy={busy === "reread"}
              onClick={() => {
                void reread();
              }}
            >
              Read the plan again
            </button>
          )}
        </div>
      )}

      {impact.length > 0 && (
        <div role="group" aria-label="What it adds to each day" className={styles.impact}>
          <span className={styles.label}>What it adds</span>
          {impact.map((line) => (
            <span key={line.day} className={styles.impactLine}>
              {line.text}
            </span>
          ))}
        </div>
      )}

      <ol aria-label="Steps" className={styles.steps}>
        {plan.items.map((item) => (
          <Step
            key={item.id}
            item={item}
            number={numbers.get(item.id) ?? 0}
            numbers={numbers}
            timezone={timezone}
            refused={refusal?.steps.get(item.id) ?? null}
            focus={focusStep === item.id}
          />
        ))}
      </ol>

      {plan.discarded.length > 0 && (
        <div role="group" aria-labelledby={discardedHeading} className={styles.discarded}>
          <h3 id={discardedHeading} className={styles.discardedHeading}>
            Discarded ({plan.discarded.length})
          </h3>
          <p className={styles.quiet}>
            They failed the check and won’t become tasks. Add one yourself if you still want it.
          </p>
          {/* By title alone: their positions count the model's answer, not the review. */}
          <ul className={styles.discards}>
            {plan.discarded.map((step) => (
              <li key={step.position} className={styles.discard}>
                <span>{step.title}</span>
                {step.reasons.map((reason) => (
                  <span key={reason} className={styles.quiet}>
                    {reason}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}

      {docked ? barSlot !== null && createPortal(bar, barSlot) : <div className={styles.foot}>{bar}</div>}
    </>
  );
}

interface StepProps {
  item: PlanItem;
  number: number;
  numbers: Map<string, number>;
  timezone: string;
  /** The server's reason, when a commit was refused for this step. */
  refused: string | null;
  /** Where the router puts focus on arrival. */
  focus: boolean;
}

/**
 * One step at rest: its number, time or reason, length, what it waits on, its description and
 * links. No verbs yet; they arrive with editing.
 */
function Step({ item, number, numbers, timezone, refused, focus }: StepProps): React.ReactNode {
  const after = afterText(item, numbers);
  return (
    <li
      id={`step-${item.id}`}
      // Focus from script only: a proposed row in the week leads here.
      tabIndex={-1}
      data-route-focus={focus ? "" : undefined}
      className={cx(styles.step, refused !== null && styles.stepRefused)}
    >
      <span className={styles.stepMeta}>
        <span>Step {number}</span>
        <span>{stepWhen(item, timezone)}</span>
        <span>{formatCompact(item.minutes)}</span>
      </span>
      <span className={styles.stepTitle}>{item.title}</span>
      {after !== null && <span className={styles.stepNote}>{after}</span>}
      {item.description !== "" && <span className={styles.stepNote}>{item.description}</span>}
      {refused !== null ? (
        <span className={styles.stepError}>{refused}</span>
      ) : (
        item.reason !== null && <span className={styles.reason}>{item.reason}</span>
      )}
      {item.links.length > 0 && (
        <ul aria-label="Links" className={styles.links}>
          {item.links.map((link) => (
            <li key={link.url}>
              <a href={link.url} target="_blank" rel="noopener noreferrer" className={styles.link}>
                <span>{link.label}</span>
                <span className={styles.host}>{hostOf(link.url)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
