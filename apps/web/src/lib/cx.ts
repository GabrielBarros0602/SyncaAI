/**
 * Join class names, dropping the ones that are not there.
 *
 * Exists because `noUncheckedIndexedAccess` types every CSS module class as possibly
 * undefined — which is correct, since a typo in a class name is exactly the mistake that
 * would otherwise reach the browser as an element with no styles and no error.
 */
export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter((name): name is string => typeof name === "string" && name !== "").join(" ");
}
