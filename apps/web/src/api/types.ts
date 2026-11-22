/**
 * The shapes the API answers with.
 *
 * Written to mirror `apps/api/syncaai/schemas/` field for field, including the snake_case —
 * renaming here would mean a translation layer nobody asked for and a second place for the
 * two to drift apart.
 */

/** How heavy a day is, in four steps (ADR-0022). */
export type Load = "fine" | "heavy" | "strained" | "unsustainable";

/** One day's aggregate. No task appears here, by design (ADR-0004). */
export interface DayCapacity {
  day: string;
  weekday: number;
  /** The real length of the local day — 1440, or 1380/1500 on a daylight-saving
   * transition. Drives the geometry and nothing else. */
  total_minutes: number;
  /** What the day actually offers: sixteen hours, leaving eight for sleep. Every figure
   * below is measured against this rather than against the calendar day. */
  usable_minutes: number;
  occupied_minutes: number;
  free_minutes: number;
  /** What is left of the whole day. The two loudest messages report this, because past
   * sixteen hours booked a figure against the budget would read zero and say nothing. */
  unbooked_minutes: number;
  task_count: number;
  /** Booked past the usable day. Free minutes floor at zero, so this is the only thing
   * that says the overflow happened. */
  over_capacity: boolean;
  load: Load;
}

export interface ChecklistItem {
  id: string;
  label: string;
  position: number;
  completed_at: string | null;
}

export interface Tag {
  id: string;
  name: string;
}

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  start_at: string;
  end_at: string;
  duration_minutes: number;
  completed_at: string | null;
  tag: Tag | null;
  items: ChecklistItem[];
}

export interface Page<T> {
  items: T[];
  limit: number;
  offset: number;
}

export interface Me {
  id: string;
  email: string;
  /** The zone the *server* stores. Every local date sent to /capacity and /tasks is read in
   * this zone and not the browser's, and the two can differ. */
  timezone: string;
  verified_at: string | null;
  /** ISO weekdays, Monday is 1, the planner proposes nothing on (ADR-0032). */
  days_off: number[];
  /** How long a step the planner proposes may be: what a step added by hand starts at. */
  preferred_block_minutes: number;
}

/**
 * A partial change to a task, and partial is the whole point.
 *
 * The API distinguishes an absent field from a null one through Pydantic's
 * `model_fields_set`, and the service leans on that: `null` clears a note or a tag, absent
 * leaves it alone. Sending a field that did not change is not free either — `PATCH /tasks`
 * validates `start_at` against the past whenever it arrives, so a client that resends an
 * unchanged start time is refused for correcting a title on a task that already began.
 */
export interface TaskChanges {
  title?: string;
  start_at?: string;
  duration_minutes?: number;
  notes?: string | null;
  tag?: string | null;
}

/** `failed` is read, too, for a request no worker will ever take (ADR-0057). */
export type JobStatus = "queued" | "running" | "done" | "failed";

/** A request for a plan, as it is going (ADR-0038, ADR-0058). */
export interface Job {
  job_id: string;
  status: JobStatus;
  /** A sentence for the person, once it has failed. */
  failure_reason: string | null;
  /** The plan it made, once there is one. */
  plan_id: string | null;
  /** As the person wrote it; null once the purge has cleared it (ADR-0031). */
  request: string | null;
  horizon_days: number;
  created_at: string;
}

/**
 * How a step stands. Read against the clock, never stored: a placed step whose start has
 * passed reads `passed` (ADR-0033).
 */
export type StepState = "placed" | "passed" | "no_room" | "not_this_week" | "after_unplaced";

/** `expired` is read, too: a pending plan whose last day has ended (ADR-0050). */
export type PlanStatus = "pending" | "approved" | "discarded" | "expired";

export interface PlanLink {
  label: string;
  url: string;
}

export interface PlanItem {
  id: string;
  position: number;
  title: string;
  description: string;
  minutes: number;
  /** Null while the step has no time. */
  start_at: string | null;
  state: StepState;
  /** Why it has no time ahead of it, in a sentence that says what to change; null once it
   *  has one (ADR-0059). */
  reason: string | null;
  /** Steps of the same plan that must end before this one starts. */
  prerequisites: string[];
  links: PlanLink[];
}

/** A partial change to a step (ADR-0030). None of the three can be cleared. */
export interface PlanItemChanges {
  title?: string;
  minutes?: number;
  start_at?: string;
}

/** A step added by hand. It is placed where the plan would place it (ADR-0047). */
export interface NewPlanItem {
  title: string;
  minutes: number;
  description: string;
}

export interface PlanDiscard {
  position: number;
  title: string;
  reasons: string[];
}

export interface PlanProgress {
  done: number;
  total: number;
}

export interface Plan {
  id: string;
  /** The request that made it; null for a plan written by hand (ADR-0058). */
  job_id: string | null;
  created_at: string;
  status: PlanStatus;
  request: string;
  first_day: string;
  last_day: string;
  /** The Sunday a new plan fills up to on its own; what waits is offered the days after. */
  week_ends_on: string;
  items: PlanItem[];
  discarded: PlanDiscard[];
  progress: PlanProgress | null;
}

export interface PlanCommit {
  plan_id: string;
  task_ids: string[];
}

export interface NewTask {
  title: string;
  start_at: string;
  duration_minutes: number;
  /** Already accepted by `TaskCreate`; the new-task form never sent one, an undo does. */
  notes?: string;
  tag?: string;
  items?: { label: string }[];
}
