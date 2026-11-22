import { cx } from "../lib/cx";
import day from "./Day.module.css";

interface Props {
  /** The heading's id, which the sheet is labelled by. */
  id: string;
  heading: string;
  /** The id of the form save submits: it is under the bar, not around it. */
  form: string;
  saving: boolean;
  onCancel: () => void;
}

/**
 * The bar on top of a form opened as a full sheet below 1100px (day-phone.dc.html): cancel,
 * the heading, and save.
 *
 * On top because a phone's keyboard covers the bottom of the screen, where the desktop's
 * dialog keeps its buttons. Save stays "save" when a new tag is typed, unlike the desktop's
 * "save and create tag": the tag field already says saving creates it, and a label that grows
 * with the tag cannot share a 320px bar with the heading.
 */
export function SheetHead({ id, heading, form, saving, onCancel }: Props): React.ReactNode {
  return (
    <div className={day.sheetHead}>
      <button type="button" className={day.sheetCancel} onClick={onCancel}>
        cancel
      </button>
      <h2 id={id} className={day.sheetTitle}>
        {heading}
      </h2>
      <button type="submit" form={form} className={cx(day.primary, day.sheetSave)} aria-busy={saving}>
        {saving ? "saving…" : "save"}
      </button>
    </div>
  );
}
