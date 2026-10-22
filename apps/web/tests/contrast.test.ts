/**
 * Every colour the screens draw, held to the contrast WCAG 2.2 AA asks of it (ADR-0026).
 *
 * The pairs come from contrast-pairs.json, which lists where each text and edge colour is
 * drawn. The colours come from tokens.css itself, the file the browser receives, so a value
 * changed there is a value measured here — there is no second copy of the palette to forget.
 */
import { describe, expect, it } from "vitest";

import pairs from "../src/styles/contrast-pairs.json";
import css from "../src/styles/tokens.css?raw";

type Theme = Record<string, string>;

/** The custom properties declared in the one block whose selector is exactly `selector`. */
function block(selector: string): Theme {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const [, head = "", body = ""] of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (head.replace(/\s+/g, " ").trim() !== selector) continue;
    const theme: Theme = {};
    for (const [, name = "", value = ""] of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      theme[name] = value.trim();
    }
    return theme;
  }
  throw new Error(`tokens.css has no block for ${selector}`);
}

/** Relative luminance, as WCAG 2.2 defines it. */
function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

const THEMES: Record<string, Theme> = {
  light: block(':root, :root[data-theme="light"]'),
  dark: block(':root[data-theme="dark"]'),
};

/** Every pair below its minimum, or naming a token the theme does not declare. */
function failures(theme: Theme, kind: "text" | "graphics"): string[] {
  const { minimum, pairs: byColour } = pairs[kind];
  const out: string[] = [];
  for (const [fg, grounds] of Object.entries(byColour)) {
    for (const ground of grounds) {
      const a = theme[fg];
      const b = theme[ground];
      if (a === undefined || b === undefined) {
        out.push(`${fg} on ${ground}: not declared`);
        continue;
      }
      const r = ratio(a, b);
      // Written this way round so that NaN, which a value that is not a hex colour produces
      // and which compares false with everything, fails instead of passing.
      if (!(r >= minimum)) out.push(`${fg} on ${ground}: ${r.toFixed(2)}:1`);
    }
  }
  return out;
}

describe("the contrast ratio", () => {
  // A wrong formula would pass every pair; these are the answers WCAG's own examples give.
  it("gives the known answers", () => {
    expect(ratio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(ratio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
    expect(ratio("#ffffff", "#767676")).toBe(ratio("#767676", "#ffffff"));
  });
});

describe("tokens.css", () => {
  it.each(Object.keys(THEMES))("declares every %s colour opaque", (name) => {
    const theme = THEMES[name] ?? {};
    const translucent = Object.entries(theme)
      .filter(([token]) => token !== "shadow-raised")
      .filter(([, value]) => !/^#[0-9a-f]{6}$/i.test(value))
      .map(([token, value]) => `${token}: ${value}`);

    expect(Object.keys(theme).length).toBeGreaterThan(0);
    expect(translucent).toEqual([]);
  });

  // :root carries the light values whatever the attribute says, so a token the dark block
  // forgets is not missing on a dark page — it is silently light.
  it("declares the same tokens in both themes", () => {
    expect(Object.keys(THEMES.dark ?? {}).sort()).toEqual(Object.keys(THEMES.light ?? {}).sort());
  });

  it("follows a dark system with exactly the dark theme", () => {
    expect(block(":root:not([data-theme])")).toEqual(THEMES.dark);
  });
});

describe.each(Object.keys(THEMES))("the %s theme", (name) => {
  const theme = THEMES[name] ?? {};

  it("holds text to 4.5:1 on every ground it is drawn on", () => {
    expect(failures(theme, "text")).toEqual([]);
  });

  it("holds edges and graphics to 3:1 against what they sit on", () => {
    expect(failures(theme, "graphics")).toEqual([]);
  });
});
