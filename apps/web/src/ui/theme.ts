/**
 * The theme, the one thing this app keeps in the browser (ADR-0061).
 *
 * It belongs to the device, as settings.dc.html has it ("Only this device"), and it applies as
 * it is chosen: the attribute on <html> is what the tokens read (ADR-0026). It is kept so a
 * reload opens in it, and the script in index.html applies the kept one before the first paint,
 * so a light choice never flashes dark on the way in.
 *
 * What ADR-0021 keeps out of storage is a credential, and a theme is none: a script that read
 * it would learn whether somebody likes a light screen.
 */
export type Theme = "system" | "light" | "dark";

/** The key index.html reads, written there as a literal: it runs before any module does. */
export const THEME_KEY = "syncaai.theme";

// eslint-disable-next-line no-restricted-globals -- ADR-0061: the theme is no credential, and the one thing kept here.
const storage = (): Storage => localStorage;

/** The theme in force, read from the page rather than from storage, which may keep nothing. */
export function currentTheme(): Theme {
  const theme = document.documentElement.dataset.theme;
  return theme === "light" || theme === "dark" ? theme : "system";
}

/** Apply it now, and keep it for the next visit. System is the absence of a choice. */
export function chooseTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
  try {
    if (theme === "system") storage().removeItem(THEME_KEY);
    else storage().setItem(THEME_KEY, theme);
  } catch {
    // Storage refused, as a private window may: the choice still holds on this page.
  }
}
