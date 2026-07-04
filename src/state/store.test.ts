/**
 * Store behaviour for the game-mimicry containers: auto-placement, cursor
 * pickup/put-down with swapping, equipping, quick-move, and per-craft
 * sessions. The store is exercised headlessly via zustand's setState.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { currentItem, takenRects, useApp } from "./store.ts";
import { findBase, loadEngineData, rareWith } from "../engine/testutil.ts";

const data = loadEngineData();
const initial = useApp.getState();

const make = (cls: string) => rareWith(data, findBase(data, cls), []);
const craft = (key: number) => useApp.getState().crafts.find((c) => c.key === key)!;

beforeEach(() => {
  useApp.setState({ ...initial, status: "ready", data, crafts: [], nextKey: 1 }, true);
});

describe("startCraft placement", () => {
  it("auto-places new items into the inventory first-fit, then the stash", () => {
    const state = useApp.getState();
    // 12 body armours (2×3) fill the 12×5 inventory's top rows 6 wide ×1,
    // leaving rows 3-4 too short — overflow goes to the stash tab.
    for (let i = 0; i < 7; i++) state.startCraft(make("Body Armour"));
    const { crafts, activeKey } = useApp.getState();
    expect(crafts.filter((c) => c.place?.container === "inventory")).toHaveLength(6);
    expect(crafts[6].place).toEqual({ container: "stash", x: 0, y: 0 });
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
    expect(useApp.getState().crafts).toHaveLength(0);
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

describe("quick move + crafting target", () => {
  it("ctrl-click moves between inventory and stash", () => {
    useApp.getState().startCraft(make("Helmet"));
    useApp.getState().quickMove(1);
    expect(craft(1).place).toEqual({ container: "stash", x: 0, y: 0 });
    useApp.getState().quickMove(1);
    expect(craft(1).place?.container).toBe("inventory");
  });

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

  it("takenRects reports current footprints", () => {
    useApp.getState().startCraft(make("Body Armour"));
    expect(takenRects(data, useApp.getState().crafts, "inventory")).toEqual([
      { x: 0, y: 0, w: 2, h: 3 },
    ]);
  });
});
