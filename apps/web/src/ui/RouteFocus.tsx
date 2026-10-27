/**
 * Where focus goes when the page changes (ADR-0052).
 *
 * A router swaps the page without the browser loading one, so nothing announces it: focus
 * stays on the link that was pressed, which may no longer exist, and a screen reader says
 * nothing. Moving focus to the new page's heading is what a full load would have done for
 * free, so the heading is what a person hears first.
 *
 * Never on the first render. The page a person opens starts at its top with nothing focused,
 * which the sign-in drawing decided on purpose: focus moves only when the person acts.
 */
import { useEffect, useRef } from "react";
import { useLocation } from "react-router";

export function RouteFocus(): null {
  const { pathname } = useLocation();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo(0, 0);
    const heading = document.querySelector<HTMLElement>("main h1, h1");
    if (heading === null) return;
    // A heading is not focusable on its own; -1 lets a script focus it without adding a stop
    // to the Tab order.
    if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true });
  }, [pathname]);

  return null;
}
