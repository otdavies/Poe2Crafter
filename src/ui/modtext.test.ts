import { describe, expect, it } from "vitest";
import { familyText, renderModText, renderModTextRanges } from "./modtext.ts";

describe("familyText", () => {
  it("merges tier ranges positionally", () => {
    expect(
      familyText(["Adds (2-3) to (4-6) Physical Damage", "Adds (5-8) to (9-14) Physical Damage"]),
    ).toBe("Adds (2–8) to (4–14) Physical Damage");
  });

  it("falls back to the highest tier when texts differ structurally", () => {
    expect(familyText(["+20 to Armour", "+(30-40) to Armour"])).toBe("+(30-40) to Armour");
  });

  it("passes single tiers through unchanged", () => {
    expect(familyText(["+(10-19) to maximum Life"])).toBe("+(10-19) to maximum Life");
  });
});

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

  it("remaps stat units onto the text's display range (regen per minute)", () => {
    // stat stored per minute (120-240), text displays per second (2-4)
    expect(
      renderModText("(2-4) Life Regeneration per second", [180], [
        { id: "base_life_regeneration_rate_per_minute", min: 120, max: 240 },
      ]),
    ).toBe("3 Life Regeneration per second");
  });

  it("remaps permyriad leech onto percent text with decimals", () => {
    expect(
      renderModText("Leeches (0.2-0.4)% of Physical Damage as Life", [25], [
        { id: "local_life_leech_from_physical_damage_permyriad", min: 20, max: 40 },
      ]),
    ).toBe("Leeches 0.25% of Physical Damage as Life");
  });

  it("remaps negated 'reduced' stats to positive display values", () => {
    expect(
      renderModText("(10-20)% reduced Flask Charges used", [-15], [
        { id: "flask_charges_used_+%", min: -20, max: -10 },
      ]),
    ).toBe("15% reduced Flask Charges used");
  });

  it("keeps straight substitution when units already match", () => {
    expect(
      renderModText("+(10-19) to maximum Life", [14], [
        { id: "base_maximum_life", min: 10, max: 19 },
      ]),
    ).toBe("+14 to maximum Life");
  });

  it("appends display ranges in advanced mode, like the game's Alt view", () => {
    expect(renderModTextRanges("+(10-19) to maximum Life", [14])).toBe(
      "+14(10–19) to maximum Life",
    );
    expect(renderModTextRanges("Adds (2-3) to (4-6) Physical Damage", [3, 5])).toBe(
      "Adds 3(2–3) to 5(4–6) Physical Damage",
    );
  });

  it("advanced ranges always read low→high, even on negated 'reduced' texts", () => {
    expect(
      renderModTextRanges("(20-10)% reduced Flask Charges used", [-15], [
        { id: "flask_charges_used_+%", min: -20, max: -10 },
      ]),
    ).toBe("15(10–20)% reduced Flask Charges used");
  });

  it("pairs ranges to matching stats when counts disagree", () => {
    expect(
      renderModText("Flasks gain 0.17 charges per Second and +(5-8) Charges", [10, 6], [
        { id: "generate_x_charges_for_any_flask_per_minute", min: 10, max: 10 },
        { id: "flask_charges", min: 5, max: 8 },
      ]),
    ).toBe("Flasks gain 0.17 charges per Second and +6 Charges");
  });
});
