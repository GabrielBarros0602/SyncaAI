/**
 * The tag field, suggesting the person's own tags as they type (item 23 of the round).
 *
 * A combobox with a list: ↓ and ↑ walk the suggestions, Enter takes one, Esc closes them. A
 * name that is not one of their tags is allowed, since a task naming a tag is how a tag comes
 * to exist (ADR-0020), but it is said out loud, with the closest existing tag offered: a typo
 * here is a second tag nobody meant to make.
 */
import { useEffect, useId, useState } from "react";

import { api } from "../api/client";
import type { Tag } from "../api/types";
import { cx } from "../lib/cx";
import { normaliseTag } from "./changes";
import day from "./Day.module.css";

/** The fewest single-letter edits from one word to another. */
function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/**
 * Whether a typed tag would be a new one, and the existing tag it is likely a typo of: within
 * two edits, as the round draws it, so `facudade` finds `faculdade` and `gym` finds nothing.
 * With the tags unknown, nothing is claimed: "saving creates it" would be a guess.
 */
export function tagStatus(
  value: string,
  tags: string[] | null,
): { isNew: boolean; closest: string | null } {
  const typed = normaliseTag(value);
  if (tags === null || typed === null || tags.includes(typed)) return { isNew: false, closest: null };
  let closest: string | null = null;
  let best = 3;
  for (const tag of tags) {
    const edits = distance(typed, tag);
    if (edits < best) {
      best = edits;
      closest = tag;
    }
  }
  return { isNew: true, closest };
}

/** The person's tags, read once when a field that suggests them opens. Null until they are. */
export function useTags(): string[] | null {
  const [tags, setTags] = useState<string[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    // A failure leaves them unknown: the field still takes any name, it only stops suggesting
    // and stops saying a name is new, which is not worth a message of its own.
    api
      .get<Tag[]>("/tags?limit=100")
      .then((found) => {
        if (!cancelled) setTags(found.map((tag) => tag.name));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return tags;
}

interface Props {
  value: string;
  tags: string[] | null;
  onChange: (value: string) => void;
  /** Esc with no list open: the form's own way out. */
  onEscape: () => void;
}

export function TagField({ value, tags, onChange, onEscape }: Props): React.ReactNode {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const typed = normaliseTag(value) ?? "";
  const suggestions = (tags ?? []).filter((tag) => tag.includes(typed) && tag !== typed);
  const listOpen = open && suggestions.length > 0;
  const { isNew, closest } = tagStatus(value, tags);

  function pick(tag: string): void {
    onChange(tag);
    setOpen(false);
    setActive(-1);
  }

  return (
    <div className={day.field}>
      <label htmlFor={`${id}-input`} className={day.panelHead}>
        Tag
      </label>
      <input
        id={`${id}-input`}
        className={day.input}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={listOpen}
        aria-controls={`${id}-list`}
        aria-activedescendant={listOpen && active >= 0 ? `${id}-option-${String(active)}` : undefined}
        aria-describedby={`${id}-note`}
        autoComplete="off"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => {
          setOpen(true);
        }}
        onBlur={() => {
          setOpen(false);
          setActive(-1);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            const step = event.key === "ArrowDown" ? 1 : -1;
            setActive((at) => Math.max(-1, Math.min(suggestions.length - 1, at + step)));
          } else if (event.key === "Enter" && listOpen && active >= 0) {
            // Taking a suggestion, not saving the form.
            event.preventDefault();
            pick(suggestions[active] ?? value);
          } else if (event.key === "Escape" && listOpen) {
            // Closing the list first; a second Esc leaves the form.
            setOpen(false);
            setActive(-1);
          } else if (event.key === "Escape") {
            onEscape();
          }
        }}
      />
      {listOpen && (
        <ul id={`${id}-list`} role="listbox" aria-label="Your tags" className={day.options}>
          {suggestions.map((tag, index) => (
            <li
              key={tag}
              id={`${id}-option-${String(index)}`}
              role="option"
              aria-selected={index === active}
              className={cx(day.option, index === active && day.optionActive)}
              // Before the blur that would close the list takes the press with it.
              onMouseDown={(event) => {
                event.preventDefault();
                pick(tag);
              }}
            >
              {tag}
            </li>
          ))}
        </ul>
      )}
      <div id={`${id}-note`} aria-live="polite">
        {isNew && (
          <div className={day.notice}>
            <span>
              “{typed}” isn’t one of your tags yet. Saving creates it.
              {closest !== null && ` Did you mean “${closest}”?`}
            </span>
            {closest !== null && (
              <button
                type="button"
                className={day.secondary}
                onClick={() => {
                  pick(closest);
                }}
              >
                use “{closest}”
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
