/**
 * Exhaustive currency ledger. Every entry in the trade snapshot must fall into
 * exactly one bucket — a craftable action, a modelled crafting omen, a
 * map/ritual omen we deliberately don't model, or a documented out-of-scope
 * reason. This is the backstop for "does every upgrade item behave?": a new
 * currency arriving in a data refresh (or an action quietly ceasing to
 * resolve) fails this test until it is classified, and every craftable
 * currency is smoke-dispatched through the real odds/canApply plumbing so a
 * broken action (missing mod id, bad class map, throwing rune) surfaces here
 * rather than in the UI.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CurrencyItem } from "../data/schema.ts";
import { actionFor } from "./actions.ts";
import { createItem, type Item } from "./item.ts";
import { OMEN } from "./mechanics.ts";
import { oddsFor } from "./odds.ts";
import { seededRng } from "./rng.ts";
import { addSocket, socketRune } from "./runes.ts";
import { findBase, findBaseByName, loadEngineData, pickPoolMods, rareWith } from "./testutil.ts";

const data = loadEngineData();
const currency = JSON.parse(
  readFileSync("public/data/0.5/currency.json", "utf8"),
) as CurrencyItem[];
const ids = currency.map((c) => c.id);
const idSet = new Set(ids);

const modelledOmens = new Set<string>(Object.values(OMEN));

/**
 * Out-of-scope currency, grouped by the reason the simulator doesn't act on
 * it. Each `ids` entry must exist in the snapshot (no stale ledger); each
 * `match` rule must catch at least one id (no dead rule). Keeping the reasons
 * here — rather than a flat ignore-list — makes the scope decisions auditable
 * and forces a conscious choice when new currency appears.
 */
type ScopeRule = { reason: string; ids?: string[]; match?: (id: string) => boolean };

const OUT_OF_SCOPE: ScopeRule[] = [
  {
    reason: "Fragments/shards that combine into a full currency — never applied directly",
    match: (id) => id.endsWith("-shard") || id.endsWith("-splinter"),
  },
  {
    reason: "Ritual atlas idols — an atlas mechanic, not item crafting",
    match: (id) => id.endsWith("-idol") || id.startsWith("idol-of-"),
  },
  {
    reason: "Quality currencies (weapon/armour/gem/flask quality) — not yet modelled",
    ids: ["whetstone", "scrap", "etcher", "bauble", "gcp"],
  },
  {
    reason: "Item-target currency with no in-sim effect (identify, duplicate, upgrade-to-unique, rune-socket rerolls)",
    ids: [
      "wisdom",
      "chance",
      "mirror",
      "hinekoras-lock",
      "cryptic-key",
      "lesser-jewellers-orb",
      "greater-jewellers-orb",
      "perfect-jewellers-orb",
    ],
  },
  {
    reason: "Breach content — stones and wombgifts, not item crafting",
    ids: [
      "breachstone",
      "lavish-wombgift",
      "ornate-wombgift",
      "banded-wombgift",
      "signet-wombgift",
      "revelatory-wombgift",
    ],
  },
  { reason: "Delirium content — the Simulacrum encounter", ids: ["simulacrum"] },
  {
    reason: "Verisium Anvil materials — deferred (cost/ward formula unpublished, see HANDOFF)",
    ids: [
      "verisium",
      "exceptional-verisium",
      "mutated-verisium",
      "corrupted-verisium",
      "founders-verisium",
      "liquid-verisium",
      "starlit-ore",
      "venerable-starlit-ore",
      "revered-starlit-ore",
      "veridical-starlit-ore",
      "warding-starlit-ore",
      "medveds-crest-of-the-circle",
      "voranas-crest-of-the-scythe",
      "uhtreds-crest-of-the-chalice",
      "olroths-crest-of-the-sun",
    ],
  },
  {
    reason: "Waystone desecration — out of scope (no waystones simulated)",
    ids: ["preserved-vertebrae"],
  },
  {
    reason: "Ritual content — audience/king items, not item crafting",
    ids: ["an-audience-with-the-king", "call-of-the-shadows", "head-of-the-king"],
  },
];

function outOfScope(id: string): boolean {
  return OUT_OF_SCOPE.some((r) => r.ids?.includes(id) || r.match?.(id));
}

/** Which bucket a currency id lands in, for the partition assertion. */
function classify(id: string): "craft" | "omen" | "out-of-scope" | "unclassified" {
  if (actionFor(data, id)) return "craft";
  // Both modelled crafting omens and the map/ritual omens we don't simulate
  // are armed/consumed elsewhere (or dimmed), never dispatched via actionFor.
  if (modelledOmens.has(id) || id.startsWith("omen-of-")) return "omen";
  if (outOfScope(id)) return "out-of-scope";
  return "unclassified";
}

describe("currency coverage ledger", () => {
  it("classifies every currency in the snapshot", () => {
    const unclassified = ids.filter((id) => classify(id) === "unclassified");
    expect(unclassified, "unclassified currency — add a craft action or an OUT_OF_SCOPE reason").toEqual(
      [],
    );
  });

  it("keeps the out-of-scope ledger free of stale or dead entries", () => {
    for (const rule of OUT_OF_SCOPE) {
      for (const id of rule.ids ?? []) {
        expect(idSet.has(id), `stale ledger id "${id}" (${rule.reason})`).toBe(true);
        // A ledger id must not also resolve to an action — that would be a
        // silently-shadowed craftable currency.
        expect(actionFor(data, id), `"${id}" is craftable, remove from ledger`).toBeUndefined();
      }
      if (rule.match) {
        expect(ids.some((id) => rule.match!(id)), `dead match rule: ${rule.reason}`).toBe(true);
      }
    }
  });

  it("every modelled crafting omen exists in the trade snapshot", () => {
    for (const omenId of modelledOmens) {
      expect(idSet.has(omenId), `omen ${omenId} missing from snapshot`).toBe(true);
    }
  });

  it("buckets are disjoint (no currency counted twice)", () => {
    for (const id of ids) {
      const craft = actionFor(data, id) !== undefined;
      const omen = modelledOmens.has(id) || id.startsWith("omen-of-");
      const scoped = outOfScope(id);
      expect(Number(craft) + Number(omen) + Number(scoped), `${id} in multiple buckets`).toBe(1);
    }
  });
});

describe("every craftable currency dispatches without throwing", () => {
  const rng = seededRng(5);
  const bodyBase = findBase(data, "Body Armour");
  const ringBase = findBase(data, "Ring");
  const maceBase = findBase(data, "Two Hand Mace");
  const ruby = findBaseByName(data, "Ruby");

  const emptyBody = rareWith(data, bodyBase, []);
  const fullBody = rareWith(data, bodyBase, [
    ...pickPoolMods(data, emptyBody, "prefix", 3),
    ...pickPoolMods(data, emptyBody, "suffix", 3),
  ]);
  const socketedMace = socketRune(
    addSocket(rareWith(data, maceBase, [])),
    data.rune("iron-rune"),
    0,
  ).item;

  // Representative item states across the classes crafting actions branch on.
  const samples: Item[] = [
    createItem(data, bodyBase, 82, rng), // normal
    { ...createItem(data, bodyBase, 82, rng), rarity: "magic" },
    emptyBody,
    fullBody,
    rareWith(data, ringBase, pickPoolMods(data, rareWith(data, ringBase, []), "suffix", 1)),
    socketedMace,
    rareWith(data, ruby, []), // rare jewel
  ];

  const craftable = ids.filter((id) => actionFor(data, id));

  it("covers a broad slice of the trade snapshot", () => {
    // Sanity that the smoke set is real coverage, not an empty loop.
    expect(craftable.length).toBeGreaterThanOrEqual(350);
  });

  it("returns defined odds (blocked or a plan) for every currency × item", () => {
    for (const id of craftable) {
      const action = actionFor(data, id)!;
      for (const item of samples) {
        // canApply must be a clean string|null (never throw)...
        const reason = action.canApply(data, item);
        expect(typeof reason === "string" || reason === null, `${id}: bad canApply`).toBe(true);
        // ...and odds mirror it without throwing (undefined means "not a
        // currency", which a resolved action never is).
        const odds = oddsFor(data, item, id);
        expect(odds, `${id}: odds undefined for a craftable currency`).toBeDefined();
        if (reason !== null) {
          expect(odds, `${id}: blocked reason must surface in odds`).toEqual({
            kind: "blocked",
            reason,
          });
        }
      }
    }
  });
});
