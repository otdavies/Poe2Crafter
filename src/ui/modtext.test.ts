import { describe, expect, it } from "vitest";
import { renderModText } from "./modtext.ts";

describe("renderModText", () => {
  it("substitutes a single range", () => {
    expect(renderModText("+(10-19) to maximum Life", [14])).toBe("+14 to maximum Life");
  });

  it("substitutes multiple ranges in stat order", () => {
    expect(renderModText("Adds (2-3) to (4-6) Physical Damage", [3, 5])).toBe(
      "Adds 3 to 5 Physical Damage",
    );
  });

  it("handles decimal ranges", () => {
    expect(renderModText("(2.1-3) Life Regeneration per second", [2.5])).toBe(
      "2.5 Life Regeneration per second",
    );
  });

  it("leaves text without ranges untouched", () => {
    expect(renderModText("Culling Strike", [])).toBe("Culling Strike");
  });

  it("ignores surplus values", () => {
    expect(renderModText("+(5-8) to Strength", [6, 99])).toBe("+6 to Strength");
  });
});
