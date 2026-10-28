/**
 * The keys a screen answers to, where they can be seen without a screen reader (ADR-0052).
 *
 * The round's desktop week went back to the designer once for hiding it: shortcuts nobody can
 * see are shortcuts only a screen reader user finds. It stays visible and can be folded away.
 * On a device with no hover and a coarse pointer there is almost certainly no keyboard, so it
 * is not shown at all.
 */
import { useId, useState } from "react";

import styles from "./ShortcutLegend.module.css";

export interface Shortcut {
  /** Each key as it is printed on the keyboard; more than one means any of them. */
  keys: string[];
  label: string;
}

interface Props {
  shortcuts: Shortcut[];
}

export function ShortcutLegend({ shortcuts }: Props): React.ReactNode {
  const [open, setOpen] = useState(true);
  const list = useId();

  return (
    <section aria-label="Keyboard shortcuts" className={styles.legend}>
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        aria-controls={list}
        onClick={() => {
          setOpen((was) => !was);
        }}
      >
        <span aria-hidden="true" className={styles.caret}>
          {open ? "▾" : "▸"}
        </span>
        keyboard shortcuts
      </button>
      {open && (
        <dl id={list} className={styles.list}>
          {shortcuts.map((shortcut) => (
            <div key={shortcut.label} className={styles.entry}>
              <dt className={styles.keys}>
                {shortcut.keys.map((key) => (
                  <kbd key={key} className={styles.key}>
                    {key}
                  </kbd>
                ))}
              </dt>
              <dd className={styles.label}>{shortcut.label}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
