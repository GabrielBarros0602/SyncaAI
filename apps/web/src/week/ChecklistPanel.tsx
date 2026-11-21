import { useEffect, useId, useRef, useState, type SyntheticEvent } from "react";

import { ApiError } from "../api/client";
import type { Task } from "../api/types";
import { cx } from "../lib/cx";
import type { ChecklistChange } from "./useWeek";
import day from "./Day.module.css";

/** Kept in step with the API's label bound. */
const MAX_LABEL = 200;

interface Props {
  task: Task;
  /** A write about this task has not reached the screen yet. */
  saving: boolean;
  /** Rejects with the server's `ApiError`, which the panel shows. */
  onChange: (change: ChecklistChange) => Promise<void>;
  /** Esc in the field that adds: back to the row's verbs, as every panel's fields do. */
  onCancel: () => void;
  /**
   * In the one day's list below 1100px, as day-phone.dc.html draws it: no handle to drag,
   * and a Reorder mode whose ↑, ↓ and × buttons move and remove an item with one press each
   * (WCAG 2.5.7). Alt+↑ and Alt+↓ stay, on the item's label (ADR-0056).
   */
  list?: boolean;
}

/**
 * A task's checklist, every change saved as it is made (the round's C panel).
 *
 * Each change is its own request and there is no save button: ticking, renaming, removing and
 * adding one item cannot conflict with another, and the list on screen is the server's until
 * the week is read again, as everywhere else on this screen (item 29 of the round).
 *
 * The order is the exception, because `PUT …/items/order` sends the whole list. It is built
 * from the list on screen, so while a write is still on its way back that list may be the one
 * the write is about to change, and a reorder built from it would undo the write or repeat
 * the last move. Reordering waits for the list to arrive; the row says "saving…" meanwhile.
 *
 * What a change did is said inside the panel, where the list is, rather than in the screen's
 * status region: it is about the list in front of somebody, not about the week.
 */
export function ChecklistPanel({ task, saving, onChange, onCancel, list = false }: Props): React.ReactNode {
  const id = useId();
  const self = useRef<HTMLDivElement>(null);
  const items = task.items;
  const ticked = items.filter((item) => item.completed_at !== null).length;
  const [said, setSaid] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const [adding, setAdding] = useState("");
  const [renaming, setRenaming] = useState<{ itemId: string; label: string } | null>(null);
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  // Only with something to put in order: one item has nowhere to go.
  const [reorderMode, setReorderMode] = useState(false);
  const reordering = list && reorderMode && items.length > 1;
  // Esc in the rename field: the blur that follows closes it without saving.
  const keep = useRef(false);
  // Where focus goes once the change is on screen: the control the next press is for. A
  // removed item takes its own buttons with it, and a moved one is drawn again elsewhere.
  const next = useRef<string | null>(null);

  useEffect(() => {
    if (next.current === null) return;
    const target = self.current?.querySelector<HTMLElement>(next.current);
    if (target === null || target === undefined) return;
    target.focus();
    next.current = null;
  }, [items, renaming]);

  function send(change: ChecklistChange, sentence: string | null, then?: () => void): void {
    setRefusal(null);
    onChange(change).then(
      () => {
        if (sentence !== null) setSaid(sentence);
        then?.();
      },
      (problem: unknown) => {
        next.current = null;
        setSaid("");
        setRefusal(problem instanceof ApiError ? problem.detail : "Couldn’t reach the server.");
      },
    );
  }

  /**
   * Move an item, and leave focus on the control the next press of the same kind is for: the
   * handle on a desktop, the label below 1100px, and in Reorder mode the arrow that moved it,
   * or the other one once it reaches an end and that arrow stops.
   */
  function reorder(from: number, to: number, by: "key" | "arrow" = "key"): void {
    const item = items[from];
    if (saving || item === undefined || to < 0 || to >= items.length || from === to) return;
    const order = items.map((each) => each.id);
    order.splice(from, 1);
    order.splice(to, 0, item.id);
    const up = to < from;
    const atEnd = up ? to === 0 : to === items.length - 1;
    next.current =
      by === "arrow"
        ? `[data-${up !== atEnd ? "up" : "down"}="${item.id}"]`
        : list
          ? `[data-label="${item.id}"]`
          : `[data-handle="${item.id}"]`;
    send(
      { kind: "order", itemIds: order },
      `Moved “${item.label}” to ${String(to + 1)} of ${String(items.length)}.`,
    );
  }

  // Every way out of the rename field comes through its blur, so a rename is sent once
  // however it ends: Enter, Esc, a click elsewhere, or the field leaving the page.
  function finishRename(): void {
    if (renaming === null) return;
    const item = items.find((each) => each.id === renaming.itemId);
    const label = renaming.label.trim();
    const cancelled = keep.current;
    keep.current = false;
    setRenaming(null);
    // Empty is not a label the server takes, and the round reads it as changing nothing.
    if (cancelled || item === undefined || label === "" || label === item.label) return;
    send({ kind: "rename", itemId: item.id, label }, `Renamed to “${label}”.`);
  }

  function add(event: SyntheticEvent): void {
    event.preventDefault();
    const typed = adding;
    const label = typed.trim();
    if (label === "") return;
    // Emptied once the server has it, and only if nothing more was typed meanwhile: a
    // refusal keeps the words, and the list at its limit is the refusal most likely here.
    send({ kind: "add", label }, `Added “${label}”.`, () => {
      setAdding((now) => (now === typed ? "" : now));
    });
  }

  return (
    <div ref={self} role="group" aria-labelledby={`${id}-head`} className={day.panel}>
      <div className={day.fieldHead}>
        <span id={`${id}-head`} className={day.panelHead}>
          Checklist
        </span>
        <span className={day.count}>
          {ticked}/{items.length} checked
        </span>
        {list && items.length > 1 && (
          <button
            type="button"
            className={cx(day.secondary, day.reorderToggle)}
            aria-pressed={reordering}
            onClick={() => {
              setRenaming(null);
              setReorderMode(!reordering);
            }}
          >
            {reordering ? "Done reordering" : "Reorder"}
          </button>
        )}
      </div>

      {items.length > 0 && (
        <ul className={day.checklist}>
          {items.map((item, at) => {
            const done = item.completed_at !== null;
            return (
              <li
                key={item.id}
                // Not while its label is a field: selecting text in it would start a drag.
                // Not below 1100px either, where a finger cannot drag and Reorder does it.
                draggable={!list && renaming === null}
                className={cx(
                  day.checkItem,
                  drag !== null && drag.over === at && drag.from !== at && day.checkItemOver,
                )}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  // Firefox starts no drag without data.
                  event.dataTransfer.setData("text/plain", item.id);
                  setDrag({ from: at, over: at });
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (drag !== null && drag.over !== at) setDrag({ ...drag, over: at });
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (drag !== null) reorder(drag.from, at);
                  setDrag(null);
                }}
                onDragEnd={() => {
                  setDrag(null);
                }}
              >
                {!list && (
                  <button
                    type="button"
                    data-handle={item.id}
                    className={day.handle}
                    aria-label={`Reorder “${item.label}”, ${String(at + 1)} of ${String(items.length)}`}
                    aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                    onKeyDown={(event) => {
                      if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
                      // Not the grid's arrows, and not the page scrolling under the list.
                      event.preventDefault();
                      event.stopPropagation();
                      reorder(at, event.key === "ArrowUp" ? at - 1 : at + 1);
                    }}
                  >
                    ⠿
                  </button>
                )}
                <button
                  type="button"
                  role="checkbox"
                  className={day.itemBox}
                  aria-checked={done}
                  aria-label={`${done ? "Untick" : "Tick"} ${item.label}`}
                  onClick={() => {
                    send({ kind: "tick", itemId: item.id, completed: !done }, null);
                  }}
                >
                  <span className={cx(day.itemMark, done && day.itemMarkDone)} />
                </button>
                {renaming?.itemId === item.id ? (
                  <input
                    data-rename
                    className={day.renameInput}
                    aria-label={`Rename “${item.label}”`}
                    maxLength={MAX_LABEL}
                    value={renaming.label}
                    onChange={(event) => {
                      setRenaming({ itemId: item.id, label: event.target.value });
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== "Escape") return;
                      event.preventDefault();
                      keep.current = event.key === "Escape";
                      next.current = `[data-label="${item.id}"]`;
                      event.currentTarget.blur();
                    }}
                    onBlur={finishRename}
                  />
                ) : reordering ? (
                  <span className={cx(day.itemLabel, day.itemLabelStill, done && day.itemLabelDone)}>
                    {item.label}
                  </span>
                ) : (
                  <button
                    type="button"
                    data-label={item.id}
                    className={cx(day.itemLabel, done && day.itemLabelDone)}
                    aria-label={`Rename “${item.label}”`}
                    // Below 1100px the handle is gone, and the keys that moved it come here.
                    aria-keyshortcuts={list ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
                    onClick={() => {
                      next.current = "[data-rename]";
                      setRenaming({ itemId: item.id, label: item.label });
                    }}
                    onKeyDown={(event) => {
                      if (!list || !event.altKey) return;
                      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                      event.preventDefault();
                      event.stopPropagation();
                      reorder(at, event.key === "ArrowUp" ? at - 1 : at + 1);
                    }}
                  >
                    {item.label}
                  </button>
                )}
                {reordering && (
                  <>
                    <button
                      type="button"
                      data-up={item.id}
                      className={day.itemRemove}
                      aria-label={`Move “${item.label}” up`}
                      disabled={at === 0}
                      onClick={() => {
                        reorder(at, at - 1, "arrow");
                      }}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      data-down={item.id}
                      className={day.itemRemove}
                      aria-label={`Move “${item.label}” down`}
                      disabled={at === items.length - 1}
                      onClick={() => {
                        reorder(at, at + 1, "arrow");
                      }}
                    >
                      ↓
                    </button>
                  </>
                )}
                {/* Below 1100px a remove sits only in Reorder mode, as drawn: the list at rest
                    is for ticking and renaming, and a × beside every label is a slip away. */}
                {(!list || reordering) && (
                  <button
                    type="button"
                    className={day.itemRemove}
                    aria-label={`Remove “${item.label}”`}
                    onClick={() => {
                      next.current = "[data-add]";
                      send({ kind: "remove", itemId: item.id }, `Removed “${item.label}”.`);
                    }}
                  >
                    ×
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <form className={day.field} onSubmit={add}>
        <label htmlFor={`${id}-add`} className={day.addLabel}>
          Add an item
        </label>
        <div className={day.addRow}>
          <input
            id={`${id}-add`}
            data-add
            className={cx(day.input, day.addInput)}
            maxLength={MAX_LABEL}
            value={adding}
            onChange={(event) => {
              setAdding(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") onCancel();
            }}
          />
          <button type="submit" className={cx(day.primary, day.addButton)}>
            add
          </button>
        </div>
      </form>

      <span className={day.panelHint}>
        {!list
          ? "Drag ⠿ to reorder, or focus it and press Alt+↑ or Alt+↓. Click a label to rename it."
          : reordering
            ? "Use ↑ and ↓ to change the order."
            : "Tap an item to rename it."}
      </span>
      <span role="status" className={day.said}>
        {said}
      </span>
      {refusal !== null && (
        <span role="alert" className={day.refusal}>
          {refusal}
        </span>
      )}
    </div>
  );
}
