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

export interface NewTask {
  title: string;
  start_at: string;
  duration_minutes: number;
  tag?: string;
  items?: { label: string }[];
}
