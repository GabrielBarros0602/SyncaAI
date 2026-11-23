/**
 * An approved plan's page (plan.dc.html): how many of its tasks are done, as the large figure,
 * what it was for, and its tasks, each of which can be done from here.
 *
 * Read on its own, by the plan's id, so a task's "from your plan" leads to the plan it came
 * from, which need not be the one the Plan button counts. Its tasks are asked for by the plan
 * rather than by its days: one moved out of them still counts (ADR-0050). Read again with the
 * week, where a task is done as often as here.
 */
import { useEffect, useState } from "react";

import { ApiError, api } from "../api/client";
import { everyPage } from "../api/pages";
import type { Plan, Task } from "../api/types";
import { cx } from "../lib/cx";
import { zonedDay } from "../lib/time";
import day from "../week/Day.module.css";
import { MAX_HORIZON } from "./asking";
import styles from "./Plan.module.css";
import { shortDay, stepTime } from "./steps";

interface Props {
  planId: string;
  timezone: string;
  /** The week's load: a task done in the week moves the count, so the page reads it again. */
  revision: number;
  /** Complete or reopen a task, as its box in the week does. Rejects with the `ApiError`. */
  onToggle: (task: Task) => Promise<void>;
  /** Ask for another plan, or write one, from here: this one does not stand in the way. */
  onAsk: () => void;
  onWrite: (days: number) => void;
}

type Read = { plan: Plan; tasks: Task[] } | "loading" | "unreachable";

/**
 * `1 task from this plan was deleted, so it left the count.`, or null when none was.
 *
 * Each step became one task on approval and the steps stay with the plan, so the steps the
 * count no longer holds are the tasks deleted since (ADR-0050).
 */
export function goneText(plan: Plan): string | null {
  const gone = plan.items.length - (plan.progress?.total ?? plan.items.length);
  if (gone <= 0) return null;
  return gone === 1
    ? "1 task from this plan was deleted, so it left the count."
    : `${String(gone)} tasks from this plan were deleted, so they left the count.`;
}

async function readPlan(planId: string): Promise<{ plan: Plan; tasks: Task[] }> {
  const [plan, tasks] = await Promise.all([
    api.get<Plan>(`/plans/${planId}`),
    everyPage<Task>(`/tasks?plan_id=${planId}`),
  ]);
  return { plan, tasks };
}

export function PlanProgress({ planId, timezone, revision, onToggle, onAsk, onWrite }: Props): React.ReactNode {
  const [read, setRead] = useState<Read>("loading");
  const [attempt, setAttempt] = useState(0);
  // The task being completed or reopened, which keeps what it showed until the read after it.
  const [busy, setBusy] = useState<string | null>(null);
  const [refused, setRefused] = useState<{ task: string; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    readPlan(planId)
      .then((found) => {
        if (!cancelled) setRead(found);
      })
      .catch(() => {
        // A page already read stays as it was rather than going blank for one failed read.
        if (!cancelled) setRead((current) => (typeof current === "object" ? current : "unreachable"));
      });
    return () => {
      cancelled = true;
    };
  }, [planId, revision, attempt]);

  async function toggle(task: Task): Promise<void> {
    if (busy !== null) return;
    setBusy(task.id);
    setRefused(null);
    try {
      await onToggle(task);
      // Read before the row lets go of what it showed, so it never shows a guess.
      setRead(await readPlan(planId));
    } catch (problem) {
      setRefused({
        task: task.id,
        text: problem instanceof ApiError ? problem.detail : "Couldn’t reach the server.",
      });
    } finally {
      setBusy(null);
    }
  }

  if (read === "loading") return <p className={styles.quiet}>Reading the plan…</p>;
  if (read === "unreachable") {
    return (
      <div role="alert" className={styles.alert}>
        <strong>Couldn’t reach the server.</strong>
        <button
          type="button"
          className={styles.button}
          onClick={() => {
            setAttempt((count) => count + 1);
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  const { plan, tasks } = read;
  const gone = goneText(plan);

  return (
    <>
      {plan.progress !== null && (
        <p className={styles.figureLine}>
          <span className={styles.figure}>
            {plan.progress.done} of {plan.progress.total}
          </span>
          <span className={styles.quiet}>preparations done</span>
        </p>
      )}
      {gone !== null && <p className={styles.quiet}>{gone}</p>}
      <blockquote className={styles.request}>{plan.request}</blockquote>
      <ul aria-label="Tasks from this plan" className={styles.planTasks}>
        {tasks.map((task) => {
          const done = task.completed_at !== null;
          return (
            <li key={task.id} className={styles.planTask} aria-busy={busy === task.id}>
              <button
                type="button"
                role="checkbox"
                className={styles.planTaskBox}
                aria-checked={done}
                aria-label={`${done ? "Reopen" : "Complete"} ${task.title}`}
                onClick={() => {
                  void toggle(task);
                }}
              >
                <span className={cx(day.mark, done && day.markDone)} />
              </button>
              <div className={styles.planTaskBody}>
                <span className={styles.planTaskTime}>
                  {shortDay(zonedDay(task.start_at, timezone))} ·{" "}
                  {stepTime(task.start_at, task.duration_minutes, timezone)}
                </span>
                <span className={cx(styles.planTaskTitle, done && day.titleDone)}>{task.title}</span>
                {busy === task.id && <span className={styles.quiet}>saving…</span>}
                {refused?.task === task.id && (
                  <span role="alert" className={styles.fieldError}>
                    {refused.text}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <div className={styles.actions}>
        <button type="button" className={styles.button} onClick={onAsk}>
          Ask for a new plan
        </button>
        <button
          type="button"
          className={styles.button}
          onClick={() => {
            onWrite(MAX_HORIZON);
          }}
        >
          Write it myself
        </button>
      </div>
    </>
  );
}
