import type { NewTask } from "../api/types";

/**
 * A task deleted in the last nine seconds that can still be put back (ADR-0025).
 *
 * Its notice is the week's status region, not the day's column: the region names the day, so
 * it still makes sense when that day is not on screen (ADR-0052).
 */
export interface Trash {
  /** One per delete, so a second delete is a new notice with its own nine seconds. */
  id: number;
  /** The local day it was on, which the notice names. */
  day: string;
  title: string;
  /** What the recreate sends, taken before the delete. */
  snapshot: NewTask;
  /** Undo was pressed and the recreate has not answered yet. */
  restoring: boolean;
  /** The server's sentence when the recreate was refused. Shown once; nothing retries. */
  failure: string | null;
}
