/**
 * Inventory geometry: datamined item footprints, grid placement/first-fit,
 * and equipment-doll rules (two-handers vs off-hand, bow + quiver pairing).
 */
import { describe, expect, it } from "vitest";
import {
  canEquip,
  canPlace,
  findSpot,
  INVENTORY_GRID,
  isTwoHanded,
  itemRect,
  overlaps,
  slotFor,
  STASH_GRID,
  type Rect,
} from "./grid.ts";
import type { Item } from "./item.ts";
import type { EquipSlot } from "./grid.ts";
import { findBase, loadEngineData, rareWith } from "./testutil.ts";

const data = loadEngineData();

const make = (cls: string): Item => rareWith(data, findBase(data, cls), []);
const equippedWith = (entries: [EquipSlot, Item][]) => new Map(entries);

describe("datamined footprints", () => {
  it("matches the game's inventory sizes per class", () => {
    const expects: [string, number, number][] = [
      ["Body Armour", 2, 3],
      ["Helmet", 2, 2],
      ["Belt", 2, 1],
      ["Ring", 1, 1],
      ["Two Hand Mace", 2, 4],
      ["Crossbow", 2, 4],
      ["Dagger", 1, 3],
      ["Spear", 1, 4],
      ["Jewel", 1, 1],
    ];
    for (const [cls, w, h] of expects) {
      const rect = itemRect(data, make(cls), 0, 0);
      expect([cls, rect.w, rect.h]).toEqual([cls, w, h]);
    }
  });

  it("grid shapes match the game (backpack 12×5, stash tab 12×12)", () => {
    expect(INVENTORY_GRID).toEqual({ cols: 12, rows: 5 });
    expect(STASH_GRID).toEqual({ cols: 12, rows: 12 });
  });
});

describe("placement", () => {
  const at = (x: number, y: number, w = 2, h = 3): Rect => ({ x, y, w, h });

  it("rejects out-of-bounds and overlapping placements", () => {
    expect(canPlace(at(11, 0), [], INVENTORY_GRID)).toBe(false); // 2 wide at col 11
    expect(canPlace(at(0, 3), [], INVENTORY_GRID)).toBe(false); // 3 tall at row 3
    expect(canPlace(at(0, 0), [at(1, 2, 1, 1)], INVENTORY_GRID)).toBe(false);
    expect(canPlace(at(0, 0), [at(2, 0, 1, 1)], INVENTORY_GRID)).toBe(true);
    expect(overlaps(at(0, 0), at(1, 2, 1, 1))).toBe(true);
  });

  it("findSpot fills row-major and reports a full grid", () => {
    expect(findSpot(2, 3, [], INVENTORY_GRID)).toEqual({ x: 0, y: 0 });
    expect(findSpot(2, 3, [at(0, 0)], INVENTORY_GRID)).toEqual({ x: 2, y: 0 });
    // A full row of 1×5 columns leaves no room for a 2×3.
    const full = Array.from({ length: 12 }, (_, x) => at(x, 0, 1, 5));
    expect(findSpot(2, 3, full, INVENTORY_GRID)).toBeUndefined();
    expect(findSpot(2, 3, full, STASH_GRID)).toEqual({ x: 0, y: 5 }); // taller tab has room below
  });
});

describe("equipment doll", () => {
  it("maps classes to their game slots", () => {
    expect(slotFor(data, make("Helmet"))).toBe("helmet");
    expect(slotFor(data, make("Two Hand Mace"))).toBe("weapon");
    expect(slotFor(data, make("Focus"))).toBe("offhand");
    expect(slotFor(data, make("Ring"))).toBe("ringL");
    expect(slotFor(data, make("Jewel"))).toBeUndefined(); // passive tree, not the doll
  });

  it("refuses class/slot mismatches", () => {
    expect(canEquip(data, make("Helmet"), "boots", equippedWith([]))).toMatch(/Cannot equip/);
    expect(canEquip(data, make("Helmet"), "helmet", equippedWith([]))).toBeNull();
    expect(canEquip(data, make("Ring"), "ringR", equippedWith([]))).toBeNull();
  });

  it("two-handers demand an empty off-hand; bow + quiver is the exception", () => {
    const mace = make("Two Hand Mace");
    expect(isTwoHanded(data, mace)).toBe(true);
    expect(canEquip(data, mace, "weapon", equippedWith([["offhand", make("Shield")]]))).toMatch(
      /empty off-hand/,
    );
    expect(canEquip(data, make("Shield"), "offhand", equippedWith([["weapon", mace]]))).toMatch(
      /two-handed/,
    );
    expect(
      canEquip(data, make("Quiver"), "offhand", equippedWith([["weapon", make("Bow")]])),
    ).toBeNull();
    expect(
      canEquip(data, make("Quiver"), "offhand", equippedWith([["weapon", make("Crossbow")]])),
    ).toMatch(/two-handed/);
  });

  it("one-handers dual-wield; talismans are two-handed caster weapons", () => {
    const sword = make("One Hand Sword");
    expect(isTwoHanded(data, sword)).toBe(false);
    expect(canEquip(data, sword, "offhand", equippedWith([["weapon", make("One Hand Axe")]]))).toBeNull();
    expect(isTwoHanded(data, make("Talisman"))).toBe(true);
    expect(slotFor(data, make("Talisman"))).toBe("weapon");
  });
});
