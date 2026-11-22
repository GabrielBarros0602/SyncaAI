/**
 * A step of the plan under review, drawn in the day it would land on (plan.dc.html).
 *
 * Not a task yet, so it has no box and no verbs: its time with "proposed", its title in ink-2,
 * a dashed edge, and the way to it in the review. In the week it is a cell of the grid like a
 * task's row (ADR-0053), and Enter on it does what its link does; in the list below 1100px it
 * is an item whose link is the target.
 */
import { cx } from "../lib/cx";
import styles from "./Plan.module.css";
import { type Proposed, stepTime } from "./steps";

export type { Proposed } from "./steps";

interface Props extends Proposed {
  timezone: string;
  /** Open the review on this step. */
  onOpen: () => void;
}

interface CellProps extends Props {
  cell: string;
  tabStop: boolean;
  onFocusCell: () => void;
}

function Lines({ item, number, timezone, onOpen, inGrid }: Props & { inGrid: boolean }): React.ReactNode {
  return (
    <>
      <span className={styles.proposedTime}>{stepTime(item.start_at, item.minutes, timezone)} · proposed</span>
      <span className={styles.proposedTitle}>{item.title}</span>
      <button
        type="button"
        className={styles.proposedLink}
        // In the grid the cell is the stop and Enter on it is this press.
        tabIndex={inGrid ? -1 : undefined}
        onClick={onOpen}
      >
        step {number} of your plan
      </button>
    </>
  );
}

export function ProposedCell({ cell, tabStop, onFocusCell, ...props }: CellProps): React.ReactNode {
  return (
    <div
      role="gridcell"
      data-cell={cell}
      tabIndex={tabStop ? 0 : -1}
      className={styles.proposed}
      onFocus={onFocusCell}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || event.key !== "Enter") return;
        event.preventDefault();
        props.onOpen();
      }}
    >
      <Lines {...props} inGrid />
    </div>
  );
}

export function ProposedItem(props: Props): React.ReactNode {
  return (
    <li className={cx(styles.proposed, styles.proposedItem)}>
      <Lines {...props} inGrid={false} />
    </li>
  );
}
