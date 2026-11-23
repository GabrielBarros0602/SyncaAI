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
 * Under review, a step opens on its verbs: give it a time or edit it, remove it. What did not
 * fit this week can be sent to the days after, and a step can be added by hand.
 *
 * A plan can also be written by hand from the start, next to asking for one and wherever asking
 * did not work: the same review, empty, with what it is for in place of what was asked.
 *
 * Approved, a plan has a page of its own: how many of its tasks are done, and the tasks. The
 * screen opens on the one the Plan button counts, and a task's "from your plan" on its own.
 */
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ApiError } from "../api/client";
import type { Job, NewPlanItem, Plan, PlanItem, PlanItemChanges, Task } from "../api/types";
import { cx } from "../lib/cx";
import { toLocalDate, todayIn } from "../lib/time";
import { AddStep } from "./AddStep";
import {
  MAX_HORIZON,
  MAX_REQUEST,
  horizonHelp,
  horizonOptions,
  retryText,
  unwrittenPlan,
  waitLine,
  waitWord,
} from "./asking";
import { addedText, nextWeekText, sentText } from "./editing";
import styles from "./Plan.module.css";
import { PlanProgress } from "./PlanProgress";
import { StepRow } from "./StepRow";
import { countText, coverText, dayCount, impactLines, precheckText, shortDate, stepNumbers } from "./steps";
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
  /** The person's days off: named by the form's help, and marked among a step's days. */
  daysOff: readonly number[];
  /** The person's preferred block, which a step added by hand starts at. */
  blockMinutes: number;
  /** Say what a change to the plan came to, in the status region. */
  onSay: (text: string) => void;
  /** A step was taken out: the region offers to put it back until its notice ends. */
  onRemoved: (step: { id: string; number: number; title: string }) => void;
  /** The approved plan whose page the address names, from a task's "from your plan". */
  planId: string | null;
  /** The week's load, which an approved plan's page is read again with. */
  revision: number;
  /** Complete or reopen a task of an approved plan, as the week does. */
  onToggle: (task: Task) => Promise<void>;
  /** Leave a plan's own page for the screen's: a plan asked for or written goes there. */
  onFollow: () => void;
  onClose: () => void;
  onApproved: (tasks: number) => void;
  onDiscarded: () => void;
}

/** Which of the screen's views is showing, from what the server said and what was asked here. */
type View = "loading" | "review" | "wait" | "ask" | "failed" | "progress" | "expired";

const TITLES: Record<Exclude<View, "review">, string> = {
  loading: "The plan",
  wait: "Your plan",
  ask: "Ask for a plan",
  failed: "The plan didn’t come",
  progress: "The plan, in your week",
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
  blockMinutes,
  onSay,
  onRemoved,
  planId,
  revision,
  onToggle,
  onFollow,
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
  // A plan being written by hand, for the days it will cover. It is drawn over what was on
  // screen when it began, a closed plan or none, until the server has made it.
  const [writing, setWriting] = useState<{ days: number; over: string | null } | null>(null);
  const reviewed =
    pending ??
    (writing !== null && (plan?.id ?? null) === writing.over
      ? unwrittenPlan(toLocalDate(todayIn(timezone)), writing.days)
      : null);

  function write(days: number): void {
    setWriting({ days, over: plan?.id ?? null });
  }

  // A plan's own page reads itself, so it does not wait for what the screen follows.
  const progressOf = planId ?? (plan?.status === "approved" ? plan.id : null);

  const view: View =
    planId !== null
      ? "progress"
      : state.status !== "ready"
        ? "loading"
        : reviewed !== null
          ? "review"
          : job !== null && job.status !== "failed"
            ? "wait"
            : asking !== null
              ? "ask"
              : job?.status === "failed"
                ? "failed"
                : plan?.status === "approved"
                  ? "progress"
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
    view !== "review" ? TITLES[view] : reviewed?.job_id === null ? "Your plan" : "Review the plan";

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
        {view === "review" && reviewed !== null && (
          <Review
            // Another plan is another review: nothing refused or confirmed carries over. A plan
            // written by hand stays one review as the server makes it, so a first step refused
            // after the plan was made keeps what was typed. Only one is ever on screen: it
            // closes on approve and discard, and a closed one is not a review.
            key={reviewed.job_id ?? "by-hand"}
            plan={reviewed}
            state={state}
            timezone={timezone}
            focusStep={focusStep}
            docked={docked}
            barSlot={barSlot}
            daysOff={daysOff}
            blockMinutes={blockMinutes}
            onSay={onSay}
            onRemoved={onRemoved}
            onApproved={onApproved}
            onDiscarded={onDiscarded}
          />
        )}
        {view === "progress" && progressOf !== null && (
          <PlanProgress
            key={progressOf}
            planId={progressOf}
            timezone={timezone}
            revision={revision}
            onToggle={onToggle}
            onAsk={() => {
              onFollow();
              setAsking("");
            }}
            onWrite={(days) => {
              onFollow();
              write(days);
            }}
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
            onWrite={write}
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
              {/* For the days that were asked for, as the plan would have covered. */}
              <button
                type="button"
                className={styles.button}
                onClick={() => {
                  write(job.horizon_days);
                }}
              >
                Write it myself
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
              <button
                type="button"
                className={styles.button}
                onClick={() => {
                  write(dayCount(plan));
                }}
              >
                Write it myself
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
  /** Refused to guard the model, which a plan written by hand never reaches. */
  byHand: boolean;
}

function refusalOfAsk(problem: unknown, timezone: string): AskRefusal {
  if (!(problem instanceof ApiError)) {
    return { detail: "Couldn’t reach the server.", retry: null, open: false, byHand: false };
  }
  return {
    detail: problem.detail,
    retry: problem.retryAfter === null ? null : retryText(problem.retryAfter, timezone),
    open: problem.status === 409,
    // The rate limits and the month's allowance (429), the paused month and the breaker (503):
    // none of them reads a plan written by hand (ADR-0047).
    byHand: problem.status === 429 || problem.status === 503,
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
  /** Write the plan by hand instead, for the days chosen here. */
  onWrite: (days: number) => void;
}

/** What to plan and for how many days. Sent, the server queues it or says why not. */
function AskForm({ state, timezone, daysOff, initial, onSent, onWrite }: AskFormProps): React.ReactNode {
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
          {refusal.byHand && (
            <button
              type="button"
              className={styles.button}
              onClick={() => {
                onWrite(days);
              }}
            >
              Write it myself
            </button>
          )}
        </div>
      )}
      <div className={styles.actions}>
        <button type="submit" className={styles.primary} aria-busy={busy}>
          {busy ? "Sending…" : "Make a plan"}
        </button>
        <button
          type="button"
          className={styles.button}
          onClick={() => {
            onWrite(days);
          }}
        >
          Write it myself
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
  daysOff: readonly number[];
  blockMinutes: number;
  onSay: (text: string) => void;
  onRemoved: (step: { id: string; number: number; title: string }) => void;
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
  daysOff,
  blockMinutes,
  onSay,
  onRemoved,
  onApproved,
  onDiscarded,
}: ReviewProps): React.ReactNode {
  const discardedHeading = useId();
  const purposeId = useId();
  // Written by hand and not made yet: the server makes it with its first step.
  const unwritten = plan.id === "";
  const [purpose, setPurpose] = useState("");
  const [purposeTried, setPurposeTried] = useState(false);
  const purposeField = useRef<HTMLInputElement>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [busy, setBusy] = useState<"approve" | "discard" | "reread" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const alert = useRef<HTMLDivElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const discardPlan = useRef<HTMLButtonElement>(null);
  const confirmed = useRef(false);
  // One step open at a time, as one row is in the week; and in it, perhaps its form.
  const [openStep, setOpenStep] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  // A plan to write opens on what it is for, with the form for its first step under it. The
  // form takes focus as it mounts, and the field above takes it back after.
  const [adding, setAdding] = useState(unwritten);
  useEffect(() => {
    if (unwritten) purposeField.current?.focus();
  }, [unwritten]);
  const [sending, setSending] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  // Where focus goes once the change it follows is on screen: a step's row by its id, or the
  // button that adds one.
  const focusAfter = useRef<string | null>(null);
  useEffect(() => {
    const target = focusAfter.current;
    if (target === null) return;
    focusAfter.current = null;
    (target === "add" ? addButton.current : document.getElementById(target))?.focus();
  });

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
  const waiting = plan.items.filter((item) => item.state === "not_this_week");

  async function save(item: PlanItem, changes: PlanItemChanges): Promise<void> {
    await state.change(item.id, changes);
    setEditing(null);
    // A step the server named is answered by the change: its mark goes with it.
    setRefusal((current) => {
      if (current?.steps.has(item.id) !== true) return current;
      const steps = new Map(current.steps);
      steps.delete(item.id);
      return { ...current, steps };
    });
    focusAfter.current = `step-${item.id}`;
  }

  function remove(item: PlanItem): void {
    const index = plan.items.indexOf(item);
    const next = plan.items[index + 1] ?? plan.items[index - 1];
    onRemoved({ id: item.id, number: numbers.get(item.id) ?? 0, title: item.title });
    state.remove(item.id);
    setOpenStep(null);
    setEditing(null);
    // The row that takes its place, or the way to add one when it was the last.
    focusAfter.current = next === undefined ? "add" : `step-${next.id}`;
  }

  const purposeBad = purposeTried && purpose.trim() === "";

  /** The plan is named as it is made, and the API takes no name after (decided on 2026-11-22). */
  function purposeReady(): boolean {
    setPurposeTried(true);
    if (purpose.trim() !== "") return true;
    purposeField.current?.focus();
    return false;
  }

  async function add(step: NewPlanItem): Promise<void> {
    const added = unwritten
      ? await state.write(purpose.trim(), dayCount(plan), step)
      : await state.add(step);
    setAdding(false);
    onSay(addedText(added, timezone));
    focusAfter.current = `step-${added.id}`;
  }

  async function sendOn(): Promise<void> {
    if (sending) return;
    setSending(true);
    const sent = waiting.map((item) => item.id);
    try {
      onSay(sentText(sent, await state.sendOn(), timezone));
    } catch (problem) {
      setRefusal(refusalOf(problem));
    } finally {
      setSending(false);
    }
  }

  async function approve(): Promise<void> {
    if (busy !== null) return;
    if (unwritten) {
      // The server's sentence for a plan with no step (api/errors.py), with no plan to send.
      setRefusal({
        detail: "The plan has no steps to commit. Add one, or discard the plan.",
        steps: new Map(),
        order: [],
        reread: false,
      });
      return;
    }
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
      // Not made yet, it is nowhere but here.
      if (!unwritten) await state.discard();
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
        {unwritten ? (
          <div className={styles.field}>
            <label htmlFor={purposeId} className={styles.label}>
              What it’s for
            </label>
            <input
              ref={purposeField}
              id={purposeId}
              className={cx(styles.input, purposeBad && styles.fieldBad)}
              maxLength={MAX_REQUEST}
              value={purpose}
              aria-invalid={purposeBad}
              aria-describedby={`${purposeId}-error`}
              onChange={(event) => {
                setPurpose(event.target.value);
              }}
            />
            <span id={`${purposeId}-error`} className={styles.fieldError}>
              {purposeBad ? "Write what the plan is for." : ""}
            </span>
          </div>
        ) : plan.job_id === null ? (
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
          {/* With no step at all there is nothing to read again for: it is the plan's to fill. */}
          {refusal.reread && count > 0 && (
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
          <StepRow
            key={item.id}
            item={item}
            plan={plan}
            number={numbers.get(item.id) ?? 0}
            numbers={numbers}
            timezone={timezone}
            daysOff={daysOff}
            refused={refusal?.steps.get(item.id) ?? null}
            focus={focusStep === item.id}
            open={openStep === item.id}
            editing={editing === item.id}
            onToggle={() => {
              setOpenStep((current) => (current === item.id ? null : item.id));
              setEditing(null);
            }}
            onEdit={() => {
              setEditing(item.id);
            }}
            onCancelEdit={() => {
              setEditing(null);
              focusAfter.current = `step-${item.id}`;
            }}
            onSave={(changes) => save(item, changes)}
            onRemove={() => {
              remove(item);
            }}
          />
        ))}
      </ol>

      {count === 0 && <p className={styles.empty}>No steps yet. Add the first one; it goes to the first free time.</p>}

      {waiting.length > 0 && (
        <div className={styles.nextWeek}>
          <span>{nextWeekText(waiting, numbers, plan)}</span>
          <button
            type="button"
            className={styles.primary}
            aria-busy={sending}
            onClick={() => {
              void sendOn();
            }}
          >
            {sending ? "Sending…" : `Send ${String(waiting.length)} to next week`}
          </button>
        </div>
      )}

      {adding ? (
        <AddStep
          blockMinutes={blockMinutes}
          ready={unwritten ? purposeReady : undefined}
          onAdd={add}
          onCancel={() => {
            setAdding(false);
            focusAfter.current = "add";
          }}
        />
      ) : (
        <button
          ref={addButton}
          type="button"
          className={cx(styles.button, styles.addStep)}
          onClick={() => {
            setAdding(true);
          }}
        >
          + Add a step
        </button>
      )}

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
