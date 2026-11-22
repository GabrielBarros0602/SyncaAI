import { useSyncExternalStore } from "react";

/**
 * Which of the round's three layouts the window is wide enough for (ADR-0052):
 *
 * - `week`, from 1100px: the week in seven columns;
 * - `beside`, from 640px: one day beside the week as a column of seven rows;
 * - `day`, below that: one day under the week as a strip of seven cells.
 *
 * Read in script rather than left to a stylesheet, because the layouts differ in what they
 * render and not only in where it sits: a week hidden with `display: none` would still hold
 * every row's id twice. Widths are CSS pixels, so a desktop window zoomed to 200% lands on the
 * layout its text now needs.
 */
export type Layout = "week" | "beside" | "day";

const WEEK = "(min-width: 1100px)";
const BESIDE = "(min-width: 640px)";
// Where the plan's 440px review fits beside the week with every column still at its 155px
// floor: 7 × 155 + 6 × 8 for the days, 20 + 440 for the gap and the panel, 24 for the shell's
// left edge, 1617 in all, as measured. A scrollbar that takes width adds its own, 15px in
// Chrome on Windows, so 1640 holds one up to 23px wide.
const PANEL = "(min-width: 1640px)";

function subscribeTo(...media: string[]): (onChange: () => void) => () => void {
  return (onChange) => {
    const queries = media.map((query) => window.matchMedia(query));
    for (const query of queries) query.addEventListener("change", onChange);
    return () => {
      for (const query of queries) query.removeEventListener("change", onChange);
    };
  };
}

const subscribe = subscribeTo(WEEK, BESIDE);
const subscribePanel = subscribeTo(PANEL);

function read(): Layout {
  if (window.matchMedia(WEEK).matches) return "week";
  return window.matchMedia(BESIDE).matches ? "beside" : "day";
}

export function useLayout(): Layout {
  return useSyncExternalStore(subscribe, read);
}

/**
 * Whether the plan's review opens beside the week rather than in place of it.
 *
 * Only where all seven days stay on screen beside it, so a change the plan makes to a day is
 * never on a day scrolled out of view; below, the review takes the page, as it does below
 * 1100px (decided on 2026-11-22).
 */
export function useReviewBesideWeek(): boolean {
  return useSyncExternalStore(subscribePanel, () => window.matchMedia(PANEL).matches);
}
