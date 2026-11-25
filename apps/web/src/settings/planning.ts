/**
 * The usable day, the days off and the block, which save together (settings.dc.html).
 *
 * They share one Save because the server judges them as one request and writes none of them
 * when one part is refused (ADR-0029, ADR-0032). The form holds what was typed, and this turns
 * it into the change `PATCH /me` takes and the sentences the form says about it.
 */
import type { Me } from "../api/types";
import { clock, formatCompact, parseClock } from "../lib/time";

/** What the form holds: the times and the block as typed, the days off as ISO weekdays. */
export interface Planning {
  start: string;
  end: string;
  off: number[];
  block: string;
}

export type Part = "window" | "off" | "block";

/** In the form's order, and its words for each part. */
const PARTS: Record<Part, string> = { window: "usable day", off: "days off", block: "block" };

export function planningOf(me: Me): Planning {
  return {
    start: me.day_starts_at.slice(0, 5),
    end: me.day_ends_at.slice(0, 5),
    off: [...me.days_off].sort((a, b) => a - b),
    block: String(me.preferred_block_minutes),
  };
}

/** Which parts differ from what is saved, in the form's order. */
export function changedParts(saved: Planning, draft: Planning): Part[] {
  const parts: Part[] = [];
  if (draft.start !== saved.start || draft.end !== saved.end) parts.push("window");
  if (draft.off.join() !== saved.off.join()) parts.push("off");
  if (draft.block !== saved.block) parts.push("block");
  return parts;
}

export interface MeChanges {
  day_starts_at?: string;
  day_ends_at?: string;
  days_off?: number[];
  preferred_block_minutes?: number;
}

/**
 * The body of `PATCH /me`: only what changed, so a part another device changed meanwhile is
 * left as it is there. Null while either time is not one yet, which the form says itself.
 *
 * An empty block goes as 0, so the sentence that answers it is the server's own, "A block
 * lasts from 15 minutes to 4 hours.", rather than one written here (decided on 2026-11-23).
 */
export function changesOf(saved: Planning, draft: Planning): MeChanges | null {
  const start = parseClock(draft.start);
  const end = parseClock(draft.end);
  if (start === null || end === null) return null;
  const changes: MeChanges = {};
  if (draft.start !== saved.start) changes.day_starts_at = clock(start);
  if (draft.end !== saved.end) changes.day_ends_at = clock(end);
  if (draft.off.join() !== saved.off.join()) changes.days_off = draft.off;
  if (draft.block !== saved.block) changes.preferred_block_minutes = Number(draft.block);
  return changes;
}

/** The window's length on the clock; negative when it ends first, null while a time is not one. */
export function windowMinutes(planning: Planning): number | null {
  const start = parseClock(planning.start);
  const end = parseClock(planning.end);
  return start === null || end === null ? null : end - start;
}

/** The part a refusal is about, from the fields it names (ADR-0060). */
export function partOf(fields: readonly string[]): Part | null {
  if (fields.includes("day_starts_at") || fields.includes("day_ends_at")) return "window";
  if (fields.includes("days_off")) return "off";
  if (fields.includes("preferred_block_minutes")) return "block";
  return null;
}

/**
 * A quarter of an hour more or less, landing on a quarter of an hour, so a thumb never has to
 * type. Held to the bounds the server gives a block; typing can still pass them, and the
 * server answers that.
 */
export function stepBlock(block: string, by: 15 | -15): string {
  const minutes = Number(block) || 0;
  return String(Math.min(240, Math.max(15, Math.round((minutes + by) / 15) * 15)));
}

/** The line beside Save, which always says what is and is not saved. */
export function stateLine(parts: readonly Part[], saving: boolean, refused: boolean): string {
  const names = parts.map((part) => PARTS[part]).join(", ");
  if (saving) return `Saving ${names}…`;
  if (refused && parts.length > 0) return `Not saved. Still changed: ${names}.`;
  if (parts.length > 0) return `Changed, not saved yet: ${names}.`;
  return "Everything here is saved.";
}

/** The line above Save once one part was refused. */
export function refusedLine(part: Part): string {
  return `Nothing was saved. Fix the ${PARTS[part]} and save again; your other changes are still here.`;
}

/** `16h usable`, and what that length is for. */
export function lengthLine(minutes: number | null): { text: string; sub: string } {
  if (minutes === null) return { text: "—", sub: "" };
  if (minutes <= 0) return { text: "Ends before it starts", sub: "" };
  const length = formatCompact(minutes);
  return { text: `${length} usable`, sub: `· your budget each day, the “of ${length}” in “free of”.` };
}
