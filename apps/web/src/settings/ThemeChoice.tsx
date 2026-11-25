/**
 * "This device": the theme, applied as it is tapped, with nothing to save (settings.dc.html).
 *
 * Native radio buttons drawn as the drawing's three buttons, so the arrows move between them
 * and the group keeps one tab stop by themselves, as the drawing's script did by hand.
 */
import { useId, useState, useSyncExternalStore } from "react";

import { type Theme, chooseTheme, currentTheme } from "../ui/theme";
import styles from "./Settings.module.css";

const CHOICES: { theme: Theme; label: string }[] = [
  { theme: "system", label: "System" },
  { theme: "light", label: "Light" },
  { theme: "dark", label: "Dark" },
];

const DARK = "(prefers-color-scheme: dark)";

function subscribe(changed: () => void): () => void {
  const query = window.matchMedia(DARK);
  query.addEventListener("change", changed);
  return () => {
    query.removeEventListener("change", changed);
  };
}

export function ThemeChoice(): React.ReactNode {
  const heading = useId();
  const name = useId();
  const [theme, setTheme] = useState(currentTheme);
  // What System means right now, said rather than left to be found by trying it.
  const deviceDark = useSyncExternalStore(subscribe, () => window.matchMedia(DARK).matches);

  return (
    <section aria-labelledby={heading} className={styles.section}>
      <h2 id={heading} className={styles.heading}>
        This device
      </h2>
      <fieldset className={styles.fieldset} aria-describedby={`${name}-line`}>
        <legend className={styles.legend}>Theme</legend>
        <div className={styles.choices}>
          {CHOICES.map((choice) => (
            <label key={choice.theme} className={styles.choice}>
              <input
                type="radio"
                name={name}
                value={choice.theme}
                checked={theme === choice.theme}
                onChange={() => {
                  chooseTheme(choice.theme);
                  setTheme(choice.theme);
                }}
              />
              {choice.label}
            </label>
          ))}
        </div>
        <p id={`${name}-line`} className={styles.note}>
          {theme === "system" ? `Follows this device, which is ${deviceDark ? "dark" : "light"} right now. ` : ""}
          Only this device, and it applies as you tap.
        </p>
      </fieldset>
    </section>
  );
}
