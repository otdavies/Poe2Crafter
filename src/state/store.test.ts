/**
 * Store behaviour for the game-mimicry containers: auto-placement, cursor
 * pickup/put-down with swapping, equipping, quick-move, per-craft sessions,
 * and currency stacks (ordinary 1×1 stackables that merge, move, and are
 * consumed by crafting). Exercised headlessly via zustand's setState.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  currentItem,
  isCraft,
  stackSize,
  takenRects,
  useApp,
  type Craft,
  type Stack,
} from "./store.ts";
import { findBase, loadEngineData, rareWith } from "../engine/testutil.ts";
import type { CurrencyItem } from "../data/schema.ts";
import { readFileSync } from "node:fs";

const data = loadEngineData();
const currency = JSON.parse(
  readFileSync("public/data/0.5/currency.json", "utf8"),
) as CurrencyItem[];
const initial = useApp.getState();

const make = (cls: string) => rareWith(data, findBase(data, cls), []);
const craft = (key: number) =>
  useApp.getState().objects.find((o): o is Craft => o.key === key && isCraft(o))!;
const stack = (key: number) =>
  useApp.getState().objects.find((o): o is Stack => o.key === key && !isCraft(o))!;

beforeEach(() => {
  useApp.setState({ ...initial, status: "ready", data, currency, objects: [], nextKey: 1 }, true);
});

describe("startCraft placement", () => {
  it("auto-places new items into the inventory first-fit, then the stash", () => {
    const state = useApp.getState();
    // Six 2×3 body armours fill the 12×5 inventory's usable rows; the
    // seventh overflows to the stash tab.
    for (let i = 0; i < 7; i++) state.startCraft(make("Body Armour"));
    const { objects, activeKey } = useApp.getState();
    expect(objects.filter((o) => o.place?.container === "inventory")).toHaveLength(6);
    expect(objects[6].place).toEqual({ container: "stash", x: 0, y: 0 });
    expect(activeKey).toBe(7);
    expect(craft(1).place).toEqual({ container: "inventory", x: 0, y: 0 });
    expect(craft(2).place).toEqual({ container: "inventory", x: 2, y: 0 });
  });
});

describe("pick up / put down", () => {
  it("moves an item to the cursor and back to a chosen cell", () => {
    useApp.getState().startCraft(make("Helmet"));
    useApp.getState().pickUp(1);
    expect(useApp.getState().heldKey).toBe(1);
    expect(craft(1).place).toBeUndefined();
    useApp.getState().putDown("inventory", 4, 2);
    expect(useApp.getState().heldKey).toBeUndefined();
    expect(craft(1).place).toEqual({ container: "inventory", x: 4, y: 2 });
  });

  it("refuses out-of-bounds/overlap drops but swaps with a single blocker", () => {
    useApp.getState().startCraft(make("Helmet")); // key 1 at 0,0 (2×2)
    useApp.getState().startCraft(make("Ring")); // key 2 at 2,0
    useApp.getState().pickUp(2);
    useApp.getState().putDown("inventory", 11, 4); // in bounds (1×1)
    expect(craft(2).place).toEqual({ container: "inventory", x: 11, y: 4 });
    useApp.getState().pickUp(2);
    useApp.getState().putDown("inventory", 1, 1); // overlaps the helmet → swap
    const s = useApp.getState();
    expect(craft(2).place).toEqual({ container: "inventory", x: 1, y: 1 });
    expect(s.heldKey).toBe(1); // helmet is now on the cursor
    expect(craft(1).place).toBeUndefined();
  });

  it("Escape returns the held item to where it came from", () => {
    useApp.getState().startCraft(make("Body Armour"));
    useApp.getState().pickUp(1);
    useApp.getState().returnHeld();
    expect(craft(1).place).toEqual({ container: "inventory", x: 0, y: 0 });
    expect(useApp.getState().heldKey).toBeUndefined();
  });

  it("discardHeld destroys the craft", () => {
    useApp.getState().startCraft(make("Helmet"));
    useApp.getState().pickUp(1);
    useApp.getState().discardHeld();
    expect(useApp.getState().objects).toHaveLength(0);
    expect(useApp.getState().activeKey).toBeUndefined();
  });
});

describe("equipment", () => {
  it("equips from the cursor and swaps with the occupant", () => {
    useApp.getState().startCraft(make("Helmet"));
    useApp.getState().startCraft(make("Helmet"));
    useApp.getState().pickUp(1);
    useApp.getState().equipHeld("helmet");
    expect(craft(1).equipped).toBe("helmet");
    expect(useApp.getState().heldKey).toBeUndefined();
    useApp.getState().pickUp(2);
    useApp.getState().equipHeld("helmet"); // swap: 2 equips, 1 back on cursor
    expect(craft(2).equipped).toBe("helmet");
    expect(useApp.getState().heldKey).toBe(1);
  });

  it("refuses illegal equips (two-hander with an off-hand shield)", () => {
    useApp.getState().startCraft(make("Shield"));
    useApp.getState().pickUp(1);
    useApp.getState().equipHeld("offhand");
    useApp.getState().startCraft(make("Two Hand Mace"));
    useApp.getState().pickUp(2);
    useApp.getState().equipHeld("weapon");
    expect(craft(2).equipped).toBeUndefined(); // still on the cursor
    expect(useApp.getState().heldKey).toBe(2);
  });
});

describe("currency stacks", () => {
  it("takeStack puts a full game stack on the cursor; Escape dissolves it", () => {
    useApp.getState().takeStack("exalted");
    expect(useApp.getState().heldKey).toBe(1);
    expect(stack(1).count).toBe(stackSize(currency, "exalted"));
    expect(stack(1).count).toBe(20); // datamined
    useApp.getState().returnHeld(); // fresh off the tab → back into it
    expect(useApp.getState().objects).toHaveLength(0);
  });

  it("stacks place as 1×1, quick-move, and swap with items", () => {
    useApp.getState().takeStack("chaos");
    useApp.getState().putDown("inventory", 7, 3);
    expect(stack(1).place).toEqual({ container: "inventory", x: 7, y: 3 });
    expect(takenRects(data, useApp.getState().objects, "inventory")).toEqual([
      { x: 7, y: 3, w: 1, h: 1 },
    ]);
    useApp.getState().quickMove(1);
    expect(stack(1).place).toEqual({ container: "stash", x: 0, y: 0 });
  });

  it("dropping onto a same-currency stack merges up to the cap", () => {
    useApp.getState().takeStack("exalted"); // key 1, 20
    useApp.getState().putDown("inventory", 0, 0);
    useApp.setState({
      objects: useApp.getState().objects.map((o) => ({ ...o, count: 5 })),
    }); // partially used pile
    useApp.getState().takeStack("exalted"); // key 2, 20
    useApp.getState().putDown("inventory", 0, 0);
    expect(stack(1).count).toBe(20); // filled to the cap
    expect(useApp.getState().heldKey).toBe(2); // remainder stays on the cursor
    expect(stack(2).count).toBe(5);
  });

  it("crafting from a placed stack consumes it, one use at a time", () => {
    useApp.getState().startCraft({ ...make("Helmet"), rarity: "normal", explicits: [] });
    useApp.getState().takeStack("alch"); // key 2
    useApp.getState().putDown("inventory", 10, 0);
    const before = stack(2).count;
    useApp.getState().selectCurrency("alch", 2);
    useApp.getState().applyTo(1);
    expect(currentItem(craft(1).session).rarity).toBe("rare");
    expect(stack(2).count).toBe(before - 1);
    expect(useApp.getState().selectedCurrency).toBe("alch"); // still armed
  });

  it("a stack's last use removes it and disarms the currency", () => {
    useApp.getState().startCraft({ ...make("Helmet"), rarity: "normal", explicits: [] });
    useApp.getState().takeStack("transmute"); // key 2
    useApp.getState().putDown("inventory", 10, 0);
    useApp.setState({
      objects: useApp.getState().objects.map((o) =>
        o.key === 2 ? { ...o, count: 1 } : o,
      ),
    });
    useApp.getState().selectCurrency("transmute", 2);
    useApp.getState().applyTo(1);
    expect(useApp.getState().objects.find((o) => o.key === 2)).toBeUndefined();
    expect(useApp.getState().selectedCurrency).toBeUndefined();
  });

  it("currency-tab slots are specialised: curtab items-only, curwild stacks-only", () => {
    useApp.getState().startCraft(make("Two Hand Mace"));
    useApp.getState().pickUp(1);
    useApp.getState().putDown("curwild", 0, 0); // refused: stacks only
    expect(useApp.getState().heldKey).toBe(1);
    useApp.getState().putDown("curtab", 1, 3); // docks at 0,0 whatever the cell
    expect(craft(1).place).toEqual({ container: "curtab", x: 0, y: 0 });
    useApp.getState().startCraft(make("Ring"));
    useApp.getState().pickUp(2);
    useApp.getState().putDown("curtab", 0, 0); // occupied by the mace → swap
    expect(craft(2).place).toEqual({ container: "curtab", x: 0, y: 0 });
    expect(useApp.getState().heldKey).toBe(1); // the mace is on the cursor
    useApp.getState().returnHeld();
    useApp.getState().takeStack("chaos");
    useApp.getState().putDown("curwild", 3, 1);
    expect(stack(3).place).toEqual({ container: "curwild", x: 3, y: 1 });
  });
});

describe("quick move + crafting target", () => {
  it("applyTo crafts the clicked item, not just the active one", () => {
    const state = useApp.getState();
    state.startCraft({ ...make("Helmet"), rarity: "normal", explicits: [] });
    state.startCraft({ ...make("Ring"), rarity: "normal", explicits: [] });
    useApp.getState().selectCurrency("alch");
    useApp.getState().applyTo(1);
    expect(currentItem(craft(1).session).rarity).toBe("rare");
    expect(currentItem(craft(2).session).rarity).toBe("normal");
    expect(craft(1).session.steps).toHaveLength(1);
    expect(useApp.getState().activeKey).toBe(1);
  });
});
