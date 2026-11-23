/**
 * The Plan button, beside Menu at every width (plan.dc.html).
 *
 * Plan is a destination, not a quick capture, and the button is also where the plan reports
 * back: its label carries the state, as a word, so nothing moves and reduced motion changes
 * nothing. Pressed while the review is open.
 */
import type { Job, Plan } from "../api/types";
import { cx } from "../lib/cx";
import styles from "./Plan.module.css";

/**
 * What the button adds to "Plan", or null for nothing.
 *
 * A request says where it is, and a failed one says so until something newer happens. A plan
 * the model made is "ready to review"; one written by hand is a "draft", since nobody but its
 * author made it and there is nothing to review but their own steps (ADR-0058). An approved
 * plan counts its tasks done, `3 of 5`, while any is still to do (decided on 2026-10-28).
 */
export function planState(plan: Plan | null, job: Job | null): string | null {
  if (job?.status === "queued") return "queued";
  if (job?.status === "running") return "making…";
  if (job?.status === "failed") return "didn’t work";
  if (plan?.status === "approved" && plan.progress !== null && plan.progress.done < plan.progress.total) {
    return `${String(plan.progress.done)} of ${String(plan.progress.total)}`;
  }
  if (plan?.status !== "pending") return null;
  return plan.job_id === null ? "draft" : "ready to review";
}

interface Props {
  state: string | null;
  open: boolean;
  onToggle: () => void;
}

export function PlanButton({ state, open, onToggle }: Props): React.ReactNode {
  return (
    <button
      type="button"
      className={cx(styles.trigger, open && styles.triggerOpen)}
      aria-expanded={open}
      // The comma is what a screen reader pauses on; the dot drawn in its place is not read.
      aria-label={state === null ? "Plan" : `Plan, ${state}`}
      onClick={onToggle}
    >
      <span>Plan</span>
      {state !== null && <span className={styles.triggerState}>· {state}</span>}
    </button>
  );
}
