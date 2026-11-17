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

function subscribe(onChange: () => void): () => void {
  const queries = [window.matchMedia(WEEK), window.matchMedia(BESIDE)];
  for (const query of queries) query.addEventListener("change", onChange);
  return () => {
    for (const query of queries) query.removeEventListener("change", onChange);
  };
}

function read(): Layout {
  if (window.matchMedia(WEEK).matches) return "week";
  return window.matchMedia(BESIDE).matches ? "beside" : "day";
}

export function useLayout(): Layout {
  return useSyncExternalStore(subscribe, read);
}
