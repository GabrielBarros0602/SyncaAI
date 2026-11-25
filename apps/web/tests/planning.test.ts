/**
 * Tests for what the settings form sends and says about the usable day, the days off and the
 * block (settings.dc.html).
 *
 * It sends only what changed, so a part another device changed is left as it is there. A time
 * typed loosely goes as the minute it names, and one that is not a time goes nowhere. An empty
 * block goes as 0, for the server to answer in its own words (decided on 2026-11-23). A
 * refusal lands on the part its fields name (ADR-0060).
 */
import { describe, expect, it } from "vitest";

import {
  type Planning,
  changedParts,
  changesOf,
  lengthLine,
  partOf,
  refusedLine,
  stateLine,
  stepBlock,
} from "../src/settings/planning";

const SAVED: Planning = { start: "06:00", end: "22:00", off: [], block: "60" };

describe("the change sent", () => {
  it("carries only what changed", () => {
    expect(changesOf(SAVED, { ...SAVED, end: "20:00", block: "90" })).toEqual({
      day_ends_at: "20:00",
      preferred_block_minutes: 90,
    });
  });

  it("sends a time typed loosely as the minute it names", () => {
    expect(changesOf(SAVED, { ...SAVED, start: "7:30" })).toEqual({ day_starts_at: "07:30" });
  });

  it("goes nowhere while a time is not one", () => {
    expect(changesOf(SAVED, { ...SAVED, start: "7" })).toBeNull();
    expect(changesOf(SAVED, { ...SAVED, end: "24:00" })).toBeNull();
  });

  it("sends an empty block as 0, for the server to refuse in its own words", () => {
    expect(changesOf(SAVED, { ...SAVED, block: "" })).toEqual({ preferred_block_minutes: 0 });
  });

  it("names the parts that changed, in the form's order", () => {
    expect(changedParts(SAVED, { ...SAVED, block: "90", off: [6, 7], start: "07:00" })).toEqual([
      "window",
      "off",
      "block",
    ]);
    expect(changedParts(SAVED, SAVED)).toEqual([]);
  });
});

describe("a refusal", () => {
  it("lands on the part its fields name", () => {
    expect(partOf(["day_starts_at", "day_ends_at"])).toBe("window");
    expect(partOf(["days_off"])).toBe("off");
    expect(partOf(["preferred_block_minutes"])).toBe("block");
    expect(partOf([])).toBeNull();
  });

  it("is said above Save in the form's words for the part", () => {
    expect(refusedLine("off")).toBe(
      "Nothing was saved. Fix the days off and save again; your other changes are still here.",
    );
  });
});

describe("the lines beside the fields", () => {
  it("says what is and is not saved", () => {
    expect(stateLine([], false, false)).toBe("Everything here is saved.");
    expect(stateLine(["window", "block"], false, false)).toBe("Changed, not saved yet: usable day, block.");
    expect(stateLine(["window", "block"], true, false)).toBe("Saving usable day, block…");
    expect(stateLine(["block"], false, true)).toBe("Not saved. Still changed: block.");
  });

  it("says the window's length, and when it ends before it starts", () => {
    expect(lengthLine(16 * 60).text).toBe("16h usable");
    expect(lengthLine(16 * 60).sub).toBe("· your budget each day, the “of 16h” in “free of”.");
    expect(lengthLine(-60).text).toBe("Ends before it starts");
    expect(lengthLine(null).text).toBe("—");
  });

  it("steps the block a quarter of an hour, onto a quarter of an hour, within its bounds", () => {
    expect(stepBlock("60", 15)).toBe("75");
    expect(stepBlock("70", 15)).toBe("90");
    expect(stepBlock("15", -15)).toBe("15");
    expect(stepBlock("240", 15)).toBe("240");
    expect(stepBlock("", 15)).toBe("15");
  });
});
