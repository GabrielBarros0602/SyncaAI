/**
 * A window with a width, for the screens that choose their layout by it (ADR-0052).
 *
 * jsdom lays nothing out and has no `matchMedia` at all, so `useLayout` would have nothing to
 * ask. This answers `(min-width: Npx)` against a width a test sets, and
 * `(prefers-color-scheme: dark)` against a device a test turns dark, and tells whoever is
 * listening when either changes, which is all the hooks read. 1280px unless a test says otherwise:
 * the desktop week, which is what every test written before the day view assumed.
 *
 * It proves which layout a width chooses and what that layout renders. That the layout fits
 * the width is measured in a browser on each pull request, since nothing here has a size.
 */
const DESKTOP = 1280;

let width = DESKTOP;
// The device's own scheme, which the theme's System follows. Light unless a test says otherwise.
let dark = false;
const listeners = new Set<() => void>();

function matches(query: string): boolean {
  if (query === "(prefers-color-scheme: dark)") return dark;
  const minimum = /\(min-width:\s*(\d+)px\)/.exec(query);
  if (minimum === null) throw new Error(`viewport.ts cannot answer the media query ${query}`);
  return width >= Number(minimum[1]);
}

export function installViewport(): void {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      media: query,
      get matches() {
        return matches(query);
      },
      addEventListener: (_: string, listener: () => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_: string, listener: () => void) => {
        listeners.delete(listener);
      },
    }) as unknown as MediaQueryList;
}

/** Resize the window. Inside `act` when a screen is already rendered, since it re-renders. */
export function setViewportWidth(pixels: number): void {
  width = pixels;
  for (const listener of [...listeners]) listener();
}

/** Turn the device dark or light. Inside `act` when a screen is already rendered. */
export function setDeviceDark(on: boolean): void {
  dark = on;
  for (const listener of [...listeners]) listener();
}

export function resetViewport(): void {
  dark = false;
  setViewportWidth(DESKTOP);
}
