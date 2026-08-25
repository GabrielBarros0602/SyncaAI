import { useCallback, useRef, type MouseEvent } from "react";

/**
 * The one interaction worth keeping from the references.
 *
 * A hover fill that grows from whichever edge the pointer crossed. It reads as the row
 * answering rather than lighting up, and the difference is entirely in the origin: fixed to
 * the left it looks like a state change, taken from the cursor it looks like a response.
 *
 * The origin is set once per hover rather than on every mouse move. Recomputing it while
 * the pointer travels across the row makes the fill lurch, because the transform origin
 * moves under an element that is already scaled.
 *
 * Two CSS custom properties would not do: `transform-origin` has to be committed before the
 * transform, in the same frame, or the first fill of a session animates from the wrong side.
 */
export function useDirectionalFill(): {
  onMouseEnter: (event: MouseEvent<HTMLElement>) => void;
  onMouseLeave: (event: MouseEvent<HTMLElement>) => void;
  fillRef: (element: HTMLElement | null) => void;
} {
  const fill = useRef<HTMLElement | null>(null);
  const filled = useRef(false);

  const fillRef = useCallback((element: HTMLElement | null) => {
    fill.current = element;
  }, []);

  const onMouseEnter = useCallback((event: MouseEvent<HTMLElement>) => {
    const element = fill.current;
    if (element === null || filled.current) return;

    const bounds = event.currentTarget.getBoundingClientRect();
    const fromLeft = event.clientX - bounds.left < bounds.width / 2;
    element.style.transformOrigin = `${fromLeft ? "left" : "right"} center`;
    element.style.transform = "scaleX(1)";
    filled.current = true;
  }, []);

  const onMouseLeave = useCallback(() => {
    const element = fill.current;
    if (element === null) return;

    element.style.transform = "scaleX(0)";
    filled.current = false;
  }, []);

  return { onMouseEnter, onMouseLeave, fillRef };
}
