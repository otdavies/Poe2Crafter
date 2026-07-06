/**
 * Rune socketing (0.5 Runes of Aldur): socket capacity per class, the
 * Artificer's Orb, per-host-class effects, replacement destroying the old
 * rune, datamined limit groups, and local-stat folding into computed
 * properties. Everything here is deterministic — runes have fixed values.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CurrencyItem } from "../data/schema.ts";
import { actionFor, applyMasterwork, applyRune } from "./actions.ts";
import { computedProperties } from "./defences.ts";
import type { Item } from "./item.ts";
import { ARTIFICER, MASTERWORK_RUNE } from "./mechanics.ts";
import { oddsFor } from "./odds.ts";
import { seededRng } from "./rng.ts";
import {
  addSocket,
  canAddSocket,
  canMasterwork,
  canSocketRune,
  firstSocketedIndex,
  runeEffectFor,
  runeSpecialEffect,
  socketRune,
  upgradedRuneId,
} from "./runes.ts";
import { findBase, loadEngineData, rareWith } from "./testutil.ts";

const data = loadEngineData();
const rng = seededRng(7);

const bodyBase = findBase(data, "Body Armour");
const maceBase = findBase(data, "Two Hand Mace");
const ringBase = findBase(data, "Ring");

const withSockets = (item: Item, count: number): Item => {
  let current = item;
  for (let i = 0; i < count; i++) current = addSocket(current);
  return current;
};

describe("rune data", () => {
  it("every trade-snapshot rune resolves to a socket or rune-upgrade action", () => {
    const currency = JSON.parse(
      readFileSync("public/data/0.5/currency.json", "utf8"),
    ) as CurrencyItem[];
    const tradeRunes = currency.filter((c) => c.category === "Runes");
    expect(tradeRunes.length).toBeGreaterThanOrEqual(200);
    for (const c of tradeRunes) {
      const action = actionFor(data, c.id);
      // The Masterwork Rune upgrades a socketed rune; every other rune sockets.
      const expected = c.id === MASTERWORK_RUNE ? "rune_upgrade" : "socket";
      expect(action?.kind, c.id).toBe(expected);
      expect(data.rune(c.id).effects.length).toBeGreaterThan(0);
    }
  });
});

describe("Artificer's Orb", () => {
  const artificer = actionFor(data, ARTIFICER)!;

  it("adds sockets up to the class maximum (body armour: 2)", () => {
    let item = rareWith(data, bodyBase, []);
    expect(artificer.canApply(data, item)).toBeNull();
    item = artificer.apply(data, item, rng).item;
    expect(item.sockets).toEqual([null]);
    item = artificer.apply(data, item, rng).item;
    expect(item.sockets).toEqual([null, null]);
    expect(artificer.canApply(data, item)).toMatch(/maximum number of Rune Sockets/);
  });

  it("one-socket classes cap at 1; jewellery can't have sockets at all", () => {
    const helmet = withSockets(rareWith(data, findBase(data, "Helmet"), []), 1);
    expect(canAddSocket(data, helmet)).toMatch(/maximum number/);
    expect(canAddSocket(data, rareWith(data, ringBase, []))).toMatch(/cannot have Rune Sockets/);
  });

  it("blocked on corrupted items", () => {
    const item = { ...rareWith(data, bodyBase, []), corrupted: true };
    expect(artificer.canApply(data, item)).toMatch(/Corrupted/);
  });
});

describe("socketing runes", () => {
  const iron = data.rune("iron-rune");

  it("requires a socket, works on any rarity, fills the first empty socket", () => {
    const bare = rareWith(data, maceBase, []);
    expect(canSocketRune(data, bare, iron)).toMatch(/no Rune Sockets/);

    const normal: Item = { ...withSockets(bare, 2), rarity: "normal", explicits: [] };
    expect(canSocketRune(data, normal, iron)).toBeNull();
    const result = applyRune(data, normal, iron);
    expect(result.item.sockets).toEqual(["iron-rune", null]);
    expect(result.events).toEqual([{ kind: "socketed", runeId: "iron-rune", index: 0, replaced: undefined }]);
  });

  it("resolves the effect variant by host class", () => {
    const mace = withSockets(rareWith(data, maceBase, []), 1);
    const body = withSockets(rareWith(data, bodyBase, []), 1);
    expect(runeEffectFor(data, mace, iron)!.text).toEqual(["16% increased Physical Damage"]);
    expect(runeEffectFor(data, body, iron)!.text).toEqual([
      "16% increased Armour, Evasion and Energy Shield",
    ]);
  });

  it("class-incompatible runes are refused", () => {
    const heart = data.rune("warding-rune-of-heart"); // body armour only
    const mace = withSockets(rareWith(data, maceBase, []), 1);
    expect(canSocketRune(data, mace, heart)).toMatch(/Cannot be socketed/);
  });

  it("socketing into an occupied socket destroys the old rune", () => {
    const item = withSockets(rareWith(data, maceBase, []), 1);
    const first = socketRune(item, data.rune("desert-rune")).item;
    const replaced = applyRune(data, first, iron, 0);
    expect(replaced.item.sockets).toEqual(["iron-rune"]);
    expect(replaced.events[0]).toEqual({
      kind: "socketed",
      runeId: "iron-rune",
      index: 0,
      replaced: "desert-rune",
    });
  });

  it("blocked on corrupted items", () => {
    const item = { ...withSockets(rareWith(data, maceBase, []), 1), corrupted: true };
    expect(canSocketRune(data, item, iron)).toMatch(/Corrupted/);
  });
});

describe("rune limits", () => {
  it("'limit 1' runes allow a single copy per item", () => {
    const astrids = data.rune("astrids-creativity");
    expect(astrids.limit).toBe("self");
    const item = withSockets(rareWith(data, bodyBase, []), 2);
    const once = socketRune(item, astrids, 0).item;
    expect(canSocketRune(data, once, astrids, 1)).toMatch(/Limited to 1 per item/);
    // Overwriting the copy itself is fine — nothing else conflicts.
    expect(canSocketRune(data, once, astrids, 0)).toBeNull();
  });

  it("Ancient-group augments allow one of the group per item", () => {
    const instinct = data.rune("emergent-instinct");
    const possibility = data.rune("emergent-possibility");
    expect(instinct.limit).toBe("ancient");
    expect(possibility.limit).toBe("ancient");
    const item = withSockets(rareWith(data, bodyBase, []), 2);
    const withInstinct = socketRune(item, instinct, 0).item;
    expect(canSocketRune(data, withInstinct, possibility, 1)).toMatch(/Limited to 1 Ancient/);
    // Replacing the conflicting rune with the other one is allowed.
    expect(canSocketRune(data, withInstinct, possibility, 0)).toBeNull();
  });

  it("Aldur's Legacy runes share a one-per-item group", () => {
    const legacies = [...data.runeById.values()].filter((r) => r.limit === "aldurs-legacy");
    expect(legacies.length).toBeGreaterThan(10);
  });
});

describe("non-simulated special runes", () => {
  // Elemental conversion, socket transformation, unique-consumption — effects
  // the sim has no model for. They must block with their prose, never socket
  // as a misleading inert no-op.
  const specials = [
    "betrayal-of-aldur",
    "breath-of-aldur",
    "ire-of-aldur",
    "passion-of-aldur",
    "cadigans-epiphany",
    "aldurs-legacy",
  ];

  it("flags each special rune and refuses to socket it, quoting the effect", () => {
    const body = withSockets(rareWith(data, bodyBase, []), 1);
    for (const id of specials) {
      const rune = data.rune(id);
      expect(runeSpecialEffect(rune), id).toBeTruthy();
      const reason = canSocketRune(data, body, rune);
      expect(reason, id).toMatch(/^Not simulated: /);
      // The blocked odds surface the same prose so the tooltip explains why.
      const odds = oddsFor(data, body, id);
      expect(odds, id).toEqual({ kind: "blocked", reason });
    }
  });

  it("leaves ordinary runes fully socketable", () => {
    expect(runeSpecialEffect(data.rune("iron-rune"))).toBeUndefined();
    const body = withSockets(rareWith(data, bodyBase, []), 1);
    expect(canSocketRune(data, body, data.rune("iron-rune"))).toBeNull();
  });
});

describe("Masterwork Rune", () => {
  const masterwork = actionFor(data, MASTERWORK_RUNE)!;
  const iron = () => data.rune("iron-rune");

  it("is a rune-upgrade action, not an ordinary socketable rune", () => {
    expect(masterwork.kind).toBe("rune_upgrade");
  });

  it("resolves the Lesser -> base -> Greater -> Perfect tier ladder", () => {
    expect(upgradedRuneId(data, "lesser-iron-rune")).toBe("iron-rune");
    expect(upgradedRuneId(data, "iron-rune")).toBe("greater-iron-rune");
    expect(upgradedRuneId(data, "greater-iron-rune")).toBe("perfect-iron-rune");
    // Perfect is the top; tier-less special runes have no higher tier.
    expect(upgradedRuneId(data, "perfect-iron-rune")).toBeUndefined();
    expect(upgradedRuneId(data, "astrids-creativity")).toBeUndefined();
    expect(upgradedRuneId(data, "ancient-rune-of-animosity")).toBeUndefined();
  });

  it("upgrades the socketed rune one tier in place, keeping the family", () => {
    const item = socketRune(withSockets(rareWith(data, maceBase, []), 2), iron(), 0).item;
    expect(masterwork.canApply(data, item)).toBeNull();
    const result = masterwork.apply(data, item, rng);
    expect(result.item.sockets).toEqual(["greater-iron-rune", null]);
    expect(result.events).toEqual([
      { kind: "rune_upgraded", index: 0, from: "iron-rune", to: "greater-iron-rune" },
    ]);
    // The default target is the first socketed rune.
    expect(firstSocketedIndex(item)).toBe(0);
  });

  it("can target an exact socket the player clicks", () => {
    let item = withSockets(rareWith(data, maceBase, []), 2);
    item = socketRune(item, data.rune("iron-rune"), 0).item;
    item = socketRune(item, data.rune("greater-desert-rune"), 1).item;
    expect(canMasterwork(data, item, 1)).toBeNull();
    const result = applyMasterwork(data, item, 1);
    expect(result.item.sockets).toEqual(["iron-rune", "perfect-desert-rune"]);
  });

  it("is blocked with no sockets, an empty socket, or a maxed rune", () => {
    const bare = rareWith(data, maceBase, []);
    expect(canMasterwork(data, bare)).toMatch(/no Rune Sockets/);
    const empty = withSockets(bare, 1);
    expect(canMasterwork(data, empty)).toMatch(/No socketed Rune/);
    const maxed = socketRune(withSockets(bare, 1), data.rune("perfect-iron-rune"), 0).item;
    expect(canMasterwork(data, maxed)).toMatch(/already at its highest tier/);
  });

  it("is blocked on corrupted items", () => {
    const item = {
      ...socketRune(withSockets(rareWith(data, maceBase, []), 1), iron(), 0).item,
      corrupted: true,
    };
    expect(masterwork.canApply(data, item)).toMatch(/Corrupted/);
  });

  it("odds quote the concrete tier upgrade and are deterministic", () => {
    const item = socketRune(withSockets(rareWith(data, maceBase, []), 1), iron(), 0).item;
    const odds = oddsFor(data, item, MASTERWORK_RUNE);
    if (odds?.kind !== "craft") throw new Error(`expected craft, got ${odds?.kind}`);
    expect(odds.notes[0]).toBe("Upgrades socket 1: Iron Rune → Greater Iron Rune");
    expect(odds.notes).toContain("Deterministic — upgrades the socketed rune one tier");
  });

  it("blocked odds mirror canApply", () => {
    const odds = oddsFor(data, rareWith(data, maceBase, []), MASTERWORK_RUNE);
    expect(odds?.kind).toBe("blocked");
  });
});

describe("computed properties with runes", () => {
  it("folds %-increased local rune stats (Iron Rune on a weapon)", () => {
    const item = withSockets(rareWith(data, maceBase, []), 1);
    const before = computedProperties(data, item).properties;
    const after = computedProperties(
      data,
      socketRune(item, data.rune("iron-rune")).item,
    );
    expect(before.physMin).toBeGreaterThan(0);
    expect(after.properties.physMin).toBe(Math.round(before.physMin! * 1.16));
    expect(after.properties.physMax).toBe(Math.round(before.physMax! * 1.16));
    expect(after.augmented.has("physMin")).toBe(true);
  });

  it("folds flat added damage (Desert Rune: adds 7 to 11 fire)", () => {
    const item = withSockets(rareWith(data, maceBase, []), 1);
    const before = computedProperties(data, item).properties;
    const after = computedProperties(
      data,
      socketRune(item, data.rune("desert-rune")).item,
    ).properties;
    expect(after.fireMin).toBe((before.fireMin ?? 0) + 7);
    expect(after.fireMax).toBe((before.fireMax ?? 0) + 11);
  });
});

describe("odds", () => {
  it("rune odds are deterministic and quote the granted effect", () => {
    const item = withSockets(rareWith(data, maceBase, []), 1);
    const odds = oddsFor(data, item, "iron-rune");
    expect(odds?.kind).toBe("craft");
    if (odds?.kind !== "craft") throw new Error("unreachable");
    expect(odds.notes[0]).toBe("Grants: 16% increased Physical Damage");
    expect(odds.notes).toContain("Deterministic — rune effects have fixed values");
  });

  it("blocked odds mirror canApply", () => {
    const odds = oddsFor(data, rareWith(data, maceBase, []), "iron-rune");
    expect(odds).toEqual({
      kind: "blocked",
      reason: "Item has no Rune Sockets (use an Artificer's Orb)",
    });
  });

  it("Artificer's Orb odds state the socket count", () => {
    const odds = oddsFor(data, rareWith(data, bodyBase, []), ARTIFICER);
    if (odds?.kind !== "craft") throw new Error(`expected craft, got ${odds?.kind}`);
    expect(odds.notes[0]).toBe("Adds a Rune Socket (1 of 2) — deterministic");
  });
});
