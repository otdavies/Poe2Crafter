/**
 * Desecration golden + statistical tests: reveal offers, omen shaping,
 * the one-desecrated-mod rule, putrefaction, and the odds invariant (the
 * first revealed option is a plain weighted draw from the pool).
 */
import { describe, expect, it } from "vitest";
import type { Mod } from "../data/schema.ts";
import { actionFor, NO_OMENS } from "./actions.ts";
import {
  canDesecrate,
  commitDesecration,
  desecrationPool,
  desecrationReveal,
  hasDesecratedMod,
  putrefy,
} from "./desecrate.ts";
import type { Item } from "./item.ts";
import { BONES, DESECRATION_CHOICES, OMEN } from "./mechanics.ts";
import { oddsFor, type Odds } from "./odds.ts";
import { seededRng } from "./rng.ts";
import { findBase, loadEngineData, pickPoolMods, rareWith } from "./testutil.ts";

const data = loadEngineData();
const jaw = BONES.get("preserved-jawbone")!;
const collar = BONES.get("preserved-collarbone")!;
const gnawedJaw = BONES.get("gnawed-jawbone")!;
const ancientJaw = BONES.get("ancient-jawbone")!;

const bowBase = findBase(data, "Bow");
const ringBase = findBase(data, "Ring");

function openBow(): Item {
  const empty = rareWith(data, bowBase, []);
  return rareWith(data, bowBase, [
    ...pickPoolMods(data, empty, "prefix", 1),
    ...pickPoolMods(data, empty, "suffix", 1),
  ]);
}

function fullRing(): Item {
  const empty = rareWith(data, ringBase, []);
  return rareWith(data, ringBase, [
    ...pickPoolMods(data, empty, "prefix", 3),
    ...pickPoolMods(data, empty, "suffix", 3),
  ]);
}

const familyKey = (mod: Mod): string =>
  `${mod.generation}:${mod.groups.join(",") || mod.id}`;

describe("canDesecrate", () => {
  it("requires a rare item of the bone's class, not yet desecrated", () => {
    const bow = openBow();
    expect(canDesecrate(data, bow, jaw, NO_OMENS)).toBeNull();
    expect(canDesecrate(data, { ...bow, rarity: "magic" }, jaw, NO_OMENS)).toBe(
      "Requires a Rare item",
    );
    expect(canDesecrate(data, bow, collar, NO_OMENS)).toBe("Cannot be applied to Bow");
    expect(canDesecrate(data, { ...bow, corrupted: true }, jaw, NO_OMENS)).toBe(
      "Corrupted items cannot be modified",
    );
  });

  it("Gnawed bones cap the item level at 64", () => {
    const bow = openBow();
    expect(canDesecrate(data, { ...bow, ilvl: 64 }, gnawedJaw, NO_OMENS)).toBeNull();
    expect(canDesecrate(data, { ...bow, ilvl: 65 }, gnawedJaw, NO_OMENS)).toContain(
      "level 64 or lower",
    );
  });

  it("an item can hold only one desecrated modifier", () => {
    const bow = openBow();
    const reveal = desecrationReveal(data, bow, seededRng(1), jaw, NO_OMENS);
    const result = commitDesecration(data, bow, reveal, 0, seededRng(2));
    expect(hasDesecratedMod(data, result.item)).toBe(true);
    expect(canDesecrate(data, result.item, jaw, NO_OMENS)).toBe(
      "Item already has a Desecrated modifier",
    );
  });
});

describe("desecrationReveal", () => {
  it("offers three distinct desecrated mods fitting the open sides", () => {
    const bow = openBow();
    const reveal = desecrationReveal(data, bow, seededRng(7), jaw, NO_OMENS);
    expect(reveal.removed).toBeUndefined();
    expect(reveal.options).toHaveLength(DESECRATION_CHOICES);
    expect(new Set(reveal.options.map((m) => m.id)).size).toBe(DESECRATION_CHOICES);
    const taken = new Set(bow.explicits.flatMap((m) => data.mod(m.modId).groups));
    for (const mod of reveal.options) {
      expect(mod.desecrated).toBe(true);
      expect(mod.groups.some((g) => taken.has(g))).toBe(false);
    }
  });

  it("desecrated mods ignore the item-level gate (Gnawed grants L65 mods)", () => {
    const bow = { ...openBow(), ilvl: 30 };
    const reveal = desecrationReveal(data, bow, seededRng(3), gnawedJaw, NO_OMENS);
    expect(reveal.options.length).toBeGreaterThan(0);
    expect(Math.max(...reveal.options.map((m) => m.ilvl))).toBeGreaterThan(30);
  });

  it("Ancient bones enforce the minimum modifier level", () => {
    const bow = openBow();
    const reveal = desecrationReveal(data, bow, seededRng(4), ancientJaw, NO_OMENS);
    for (const mod of reveal.options) {
      expect(mod.ilvl).toBeGreaterThanOrEqual(ancientJaw.minModLevel!);
    }
  });

  it("lord omens restrict the offer to that lord", () => {
    const bow = openBow();
    const omens = new Set([OMEN.sovereign]);
    const reveal = desecrationReveal(data, bow, seededRng(5), jaw, omens);
    expect(reveal.options.length).toBeGreaterThan(0);
    for (const mod of reveal.options) expect(mod.lord).toBe("ulaman");
    expect(reveal.consumed).toContain(OMEN.sovereign);
  });

  it("necromancy omens force the offered side", () => {
    const bow = openBow();
    const omens = new Set([OMEN.dextralNecromancy]);
    const reveal = desecrationReveal(data, bow, seededRng(6), jaw, omens);
    expect(reveal.options.length).toBeGreaterThan(0);
    for (const mod of reveal.options) expect(mod.generation).toBe("suffix");
    expect(reveal.consumed).toContain(OMEN.dextralNecromancy);
  });

  it("a full item loses one uniform-random modifier first", () => {
    const ring = fullRing();
    const n = 6000;
    const rng = seededRng(42);
    const counts = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const reveal = desecrationReveal(data, ring, rng, collar, NO_OMENS);
      expect(reveal.removed).toBeDefined();
      counts.set(reveal.removed!.modId, (counts.get(reveal.removed!.modId) ?? 0) + 1);
      // the offer never conflicts with the surviving mods' groups
      const left = new Set(
        ring.explicits
          .filter((m) => m !== reveal.removed)
          .flatMap((m) => data.mod(m.modId).groups),
      );
      for (const mod of reveal.options) {
        expect(mod.groups.some((g) => left.has(g))).toBe(false);
      }
    }
    const sd = Math.sqrt(n * (1 / 6) * (5 / 6));
    for (const rolled of ring.explicits) {
      expect(Math.abs((counts.get(rolled.modId) ?? 0) - n / 6)).toBeLessThanOrEqual(4 * sd);
    }
  });

  it(
    "first offered option matches the pool weights (odds invariant)",
    { timeout: 30_000 },
    () => {
      const bow = openBow();
      const pool = desecrationPool(data, bow, jaw, NO_OMENS);
      const total = pool.reduce((sum, e) => sum + e.weight, 0);
      const expected = new Map<string, number>();
      for (const entry of pool) {
        const key = familyKey(entry.mod);
        expected.set(key, (expected.get(key) ?? 0) + entry.weight / total);
      }
      const n = 8000;
      const rng = seededRng(11);
      const counts = new Map<string, number>();
      for (let i = 0; i < n; i++) {
        const reveal = desecrationReveal(data, bow, rng, jaw, NO_OMENS);
        const key = familyKey(reveal.options[0]);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      for (const [key, p] of expected) {
        const exp = n * p;
        if (exp < 50) continue;
        const sd = Math.sqrt(n * p * (1 - p));
        expect(
          Math.abs((counts.get(key) ?? 0) - exp),
          `family ${key}`,
        ).toBeLessThanOrEqual(4 * sd);
      }
    },
  );
});

describe("putrefaction and Omen of Light", () => {
  it("putrefaction replaces everything with desecrated mods and corrupts", () => {
    const ring = fullRing();
    const result = putrefy(data, ring, seededRng(9), collar, new Set([OMEN.putrefaction]));
    expect(result.item.corrupted).toBe(true);
    expect(result.item.explicits).toHaveLength(6);
    for (const rolled of result.item.explicits) {
      expect(data.mod(rolled.modId).desecrated).toBe(true);
    }
    expect(result.consumedOmens).toContain(OMEN.putrefaction);
    // dispatched through the bone action when the omen is armed
    const action = actionFor(data, "preserved-collarbone")!;
    const viaAction = action.apply(data, ring, seededRng(9), new Set([OMEN.putrefaction]));
    expect(viaAction.item.corrupted).toBe(true);
  });

  it("Omen of Light makes annulment remove only the desecrated modifier", () => {
    const bow = openBow();
    const reveal = desecrationReveal(data, bow, seededRng(1), jaw, NO_OMENS);
    const desecrated = commitDesecration(data, bow, reveal, 0, seededRng(2)).item;
    const annul = actionFor(data, "annul")!;
    for (let seed = 0; seed < 8; seed++) {
      const result = annul.apply(data, desecrated, seededRng(seed), new Set([OMEN.light]));
      const removed = result.events.find((e) => e.kind === "removed") as {
        mod: { modId: string };
      };
      expect(data.mod(removed.mod.modId).desecrated).toBe(true);
      expect(result.consumedOmens).toContain(OMEN.light);
    }
    // without a desecrated mod the omen blocks the orb
    expect(annul.canApply(data, bow, new Set([OMEN.light]))).toBe(
      "No Desecrated modifiers to remove",
    );
  });
});

describe("odds panel integration", () => {
  it("bone odds mirror canApply and sum to 1 over families", () => {
    const bow = openBow();
    const odds = oddsFor(data, bow, "preserved-jawbone");
    expect(odds?.kind).toBe("craft");
    const craft = odds as Extract<Odds, { kind: "craft" }>;
    const sum = craft.addition!.families.reduce((s, f) => s + f.chance, 0);
    expect(sum).toBeCloseTo(1, 6);
    expect(craft.notes.join(" ")).toContain("Well of Souls");

    const magic = { ...bow, rarity: "magic" as const };
    expect(oddsFor(data, magic, "preserved-jawbone")).toEqual({
      kind: "blocked",
      reason: "Requires a Rare item",
    });
  });
});
