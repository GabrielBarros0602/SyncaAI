/**
 * The accessibility check itself, before any screen relies on it: it has to fail on what it
 * exists to catch, or every screen that passes it proves nothing.
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { expectNoViolations } from "./a11y";

describe("the accessibility check", () => {
  it("passes markup that names every control", async () => {
    const { container } = render(
      <main>
        <h1>Settings</h1>
        <label htmlFor="start">Day starts</label>
        <input id="start" type="time" />
        <button type="button">Save</button>
      </main>,
    );

    await expectNoViolations(container);
  });

  it("fails a button with no name", async () => {
    const { container } = render(
      <main>
        <button type="button" />
      </main>,
    );

    await expect(expectNoViolations(container)).rejects.toThrow(/button-name/);
  });

  it("fails a field with no label", async () => {
    const { container } = render(
      <main>
        <input type="text" />
      </main>,
    );

    await expect(expectNoViolations(container)).rejects.toThrow(/label/);
  });
});
