/**
 * The automated accessibility check every screen gets beside its tests (ADR-0052).
 *
 * axe reads the DOM that jsdom built and reports what it can prove from markup alone: a
 * control with no name, a label pointing nowhere, an ARIA role used wrongly, a duplicate id.
 * Colour contrast is left out, because jsdom computes no layout and paints nothing, so axe
 * cannot measure it here; tests/contrast.test.ts holds every pair the screens use to its
 * minimum from the tokens themselves. Widths and 200% text are measured in a browser on each
 * pull request, since nothing in jsdom has a width.
 */
import axe from "axe-core";
import { expect } from "vitest";

export async function expectNoViolations(root: Element): Promise<void> {
  const result = await axe.run(root, { rules: { "color-contrast": { enabled: false } } });
  // Each violation as its rule and the elements it found, so a failure names what to fix.
  const found = result.violations.map(
    (violation) =>
      `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`,
  );
  expect(found).toEqual([]);
}
