/**
 * The shapes the API answers with.
 *
 * Written to mirror `apps/api/syncaai/schemas/` field for field, including the snake_case —
 * renaming here would mean a translation layer nobody asked for and a second place for the
 * two to drift apart.
 */

/** One day's aggregate. No task appears here, by design (ADR-0004). */
export interface DayCapacity {
  day: string;
  weekday: number;
  total_minutes: number;
  occupied_minutes: number;
  free_minutes: number;
  task_count: number;
  /** True when the day is booked past its own length. Free minutes floor at zero, so this
   * is the only thing that says the overflow happened. */
  over_capacity: boolean;
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

export interface NewTask {
  title: string;
  start_at: string;
  duration_minutes: number;
  tag?: string;
  items?: { label: string }[];
}
