/**
 * The plan under review, as plan.dc.html draws it (ADR-0052).
 *
 * A full view in place of the week, with ‹ Week to go back; from 1640px, where all seven days
 * still fit beside it, a panel beside the week, whose days show the proposed steps. What was
 * asked, the days it covers, how many steps were kept and discarded, what it adds to each day,
 * the steps in order and the steps the check discarded. Approve and Discard sit at its foot,
 * and below 1100px where the bar between days is.
 *
 * Read only, for now: giving a step a time, editing, removing and adding come with the next
 * steps of the screen (docs/backlog.md, "As telas do plano").
 */
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ApiError } from "../api/client";
import type { Plan, PlanItem } from "../api/types";
import { cx } from "../lib/cx";
import { formatCompact } from "../lib/time";
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
  onClose: () => void;
  onApproved: (tasks: number) => void;
  onDiscarded: () => void;
}

export function PlanReview({
  wide,
  state,
  timezone,
  focusStep,
  docked,
  barSlot,
  onClose,
  onApproved,
  onDiscarded,
}: Props): React.ReactNode {
  const heading = useId();
  const { plan } = state;
  const pending = plan?.status === "pending" ? plan : null;

  const title =
    pending === null ? "The plan" : pending.job_id === null ? "Your plan" : "Review the plan";

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
          <h2 id={heading} className={styles.heading} data-route-focus={focusStep === null ? "" : undefined}>
            {title}
          </h2>
          {wide && (
            <button type="button" className={cx(styles.button, styles.close)} onClick={onClose}>
              Close
            </button>
          )}
        </div>
        {pending !== null ? (
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
        ) : (
          <Elsewhere state={state} />
        )}
      </section>
    </div>
  );
}

/** What the review shows when there is no plan to review in it. */
function Elsewhere({ state }: { state: PlanState }): React.ReactNode {
  const { plan, status } = state;
  if (status === "loading") return <p className={styles.quiet}>Reading the plan…</p>;
  if (status === "unreachable") {
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
  if (plan?.status === "expired") {
    return (
      <>
        <p role="alert" className={styles.expired}>
          This plan is no longer open for review.
        </p>
        <p className={styles.quiet}>
          It covered {shortDate(plan.first_day)} – {shortDate(plan.last_day)}, and the last day
          passed before it was reviewed. Nothing from it was written.
        </p>
        <p className={styles.request}>{plan.request}</p>
      </>
    );
  }
  // shortcut: asking for a plan arrives with the next step of the screen, and replaces this.
  return <p className={styles.quiet}>No plan is waiting for review.</p>;
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
