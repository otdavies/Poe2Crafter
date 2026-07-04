/**
 * Inventory geometry for the game-mimicry UI. The character backpack is a
 * 12×5 cell grid and a stash tab is 12×12 (verified against 0.5 guides:
 * game8 491346, poe2wiki Stash, maxroll stash-tab-guide). Every base
 * occupies width×height cells — those come straight from the datamine's
 * inventory_width/inventory_height, so footprints match the game exactly
 * (body armours 2×3, two-handers/bows/crossbows 2×4, spears/staves 1×4,
 * daggers/wands 1×3, rings/amulets/jewels 1×1, belts 2×1, …).
 */
import type { EngineData } from "./data.ts";
import type { Item } from "./item.ts";

export interface GridSize {
  cols: number;
  rows: number;
}

export const INVENTORY_GRID: GridSize = { cols: 12, rows: 5 };
export const STASH_GRID: GridSize = { cols: 12, rows: 12 };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function itemRect(data: EngineData, item: Item, x: number, y: number): Rect {
  const base = data.base(item.baseId);
  return { x, y, w: base.width, h: base.height };
}

export const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export function canPlace(rect: Rect, taken: readonly Rect[], grid: GridSize): boolean {
  if (rect.x < 0 || rect.y < 0) return false;
  if (rect.x + rect.w > grid.cols || rect.y + rect.h > grid.rows) return false;
  return !taken.some((t) => overlaps(rect, t));
}

/** Row-major first fit — where the game auto-places picked-up items. */
export function findSpot(
  w: number,
  h: number,
  taken: readonly Rect[],
  grid: GridSize,
): { x: number; y: number } | undefined {
  for (let y = 0; y + h <= grid.rows; y++) {
    for (let x = 0; x + w <= grid.cols; x++) {
      if (canPlace({ x, y, w, h }, taken, grid)) return { x, y };
    }
  }
  return undefined;
}

// --- Equipment doll ----------------------------------------------------------
//
// Slot arrangement mirrors the in-game inventory screen: main-hand top-left,
// off-hand top-right, helmet/body/belt down the centre, amulet beside the
// helmet, rings beside the body, gloves lower-left, boots lower-right
// (mobalytics equipment-guide, dving beginner's-equipment-guide). Flask and
// charm slots exist on the screen but hold item kinds we don't craft.

export type EquipSlot =
  | "weapon"
  | "offhand"
  | "helmet"
  | "body"
  | "gloves"
  | "boots"
  | "belt"
  | "amulet"
  | "ringL"
  | "ringR";

export const WEAPON_CLASSES = new Set([
  "Bow", "Claw", "Crossbow", "Dagger", "Flail", "One Hand Axe", "One Hand Mace",
  "One Hand Sword", "Sceptre", "Spear", "Staff", "Talisman", "Two Hand Axe",
  "Two Hand Mace", "Two Hand Sword", "Wand", "Warstaff",
]);

/** Off-hand-only classes; one-handed weapons can also go there (dual wield). */
const OFFHAND_CLASSES = new Set(["Shield", "Buckler", "Focus", "Quiver"]);

const ARMOUR_SLOTS: Partial<Record<string, EquipSlot>> = {
  Helmet: "helmet",
  "Body Armour": "body",
  Gloves: "gloves",
  Boots: "boots",
  Belt: "belt",
  Amulet: "amulet",
};

/** Two-handedness comes from base tags, not a hand-kept class list. */
export function isTwoHanded(data: EngineData, item: Item): boolean {
  const tags = data.base(item.baseId).tags;
  return tags.includes("two_hand_weapon") || tags.includes("twohand");
}

/** The doll slot(s) an item class can occupy (rings report ringL only). */
export function slotFor(data: EngineData, item: Item): EquipSlot | undefined {
  const cls = data.base(item.baseId).itemClass;
  if (cls === "Ring") return "ringL";
  if (WEAPON_CLASSES.has(cls)) return "weapon";
  if (OFFHAND_CLASSES.has(cls)) return "offhand";
  return ARMOUR_SLOTS[cls];
}

/**
 * Whether `item` may sit in `slot` alongside what's already equipped
 * (`others` excludes the slot being filled). Returns the refusal reason or
 * null. Two-handers demand an empty off-hand — except bow + quiver, the
 * game's one two-hand pairing.
 */
export function canEquip(
  data: EngineData,
  item: Item,
  slot: EquipSlot,
  others: ReadonlyMap<EquipSlot, Item>,
): string | null {
  const cls = data.base(item.baseId).itemClass;
  const fits =
    slot === "weapon"
      ? WEAPON_CLASSES.has(cls)
      : slot === "offhand"
        ? OFFHAND_CLASSES.has(cls) || (WEAPON_CLASSES.has(cls) && !isTwoHanded(data, item))
        : slot === "ringL" || slot === "ringR"
          ? cls === "Ring"
          : ARMOUR_SLOTS[cls] === slot;
  if (!fits) return `Cannot equip a ${cls} there`;

  const weapon = others.get("weapon");
  const offhand = others.get("offhand");
  if (slot === "weapon" && isTwoHanded(data, item) && offhand) {
    const offCls = data.base(offhand.baseId).itemClass;
    if (!(offCls === "Quiver" && cls === "Bow")) {
      return "Two-handed weapons need an empty off-hand";
    }
  }
  if (slot === "offhand" && weapon && isTwoHanded(data, weapon)) {
    const weaponCls = data.base(weapon.baseId).itemClass;
    if (!(cls === "Quiver" && weaponCls === "Bow")) {
      return "The main hand holds a two-handed weapon";
    }
  }
  return null;
}
