/**
 * What jsdom does not implement and the screens rely on.
 *
 * jsdom has the dialog element but neither showModal nor close. In a browser those also make
 * the page behind inert, keep focus inside and close on Esc; here they only open and close,
 * which is all a test of what a dialog holds and where focus goes afterwards can observe.
 */
if (typeof HTMLDialogElement.prototype.showModal !== "function") {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement): void {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement): void {
    if (!this.open) return;
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
}
