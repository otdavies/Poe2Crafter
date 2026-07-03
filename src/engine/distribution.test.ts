/**
 * Statistical tests: roll many times and check the distribution matches the
 * weighted pool. Guards against bias bugs in weighted picking that
 * single-roll tests can't catch.
 */
import { describe, expect, it } from "vitest";
import { createItem, type Item } from "./item.ts";
import { pickFromPool, rollablePool } from "./modpool.ts";
import { seededRng } from "./rng.ts";
import { findBase, loadEngineData } from "./testutil.ts";

const data = loadEngineData();

describe("weighted mod selection", () => {
  it("matches pool weights within tolerance over 20k picks", () => {
    const rng = seededRng(99);
    const item: Item = {
      ...createItem(data, findBase(data, "Amulet"), 82, rng),
      rarity: "rare",
    };
    const pool = rollablePool(data, item);
    const total = pool.reduce((sum, e) => sum + e.weight, 0);
    expect(pool.length).toBeGreaterThan(50);

    const picks = new Map<string, number>();
    const N = 20_000;
    for (let i = 0; i < N; i++) {
      const mod = pickFromPool(rng, pool);
      picks.set(mod.id, (picks.get(mod.id) ?? 0) + 1);
    }

    // every observed pick must be in the pool; frequent mods must appear
    // within 4 standard deviations of their expected rate
    for (const [modId, count] of picks) {
      const entry = pool.find((e) => e.mod.id === modId);
      expect(entry, `picked mod ${modId} not in pool`).toBeDefined();
      const p = (entry as { weight: number }).weight / total;
      const expected = N * p;
      if (expected >= 50) {
        const sd = Math.sqrt(N * p * (1 - p));
        expect(Math.abs(count - expected)).toBeLessThanOrEqual(4 * sd);
      }
    }
  });

  it("never picks a zero-weight or out-of-level mod over 5k crafted items", () => {
    const rng = seededRng(1234);
    for (let i = 0; i < 5_000; i++) {
      const ilvl = 1 + Math.floor(rng.next() * 82);
      const item: Item = {
        ...createItem(data, findBase(data, "Spear"), ilvl, rng),
        rarity: "rare",
      };
      const pool = rollablePool(data, item);
      if (pool.length === 0) continue;
      const mod = pickFromPool(rng, pool);
      expect(mod.ilvl).toBeLessThanOrEqual(ilvl);
      expect(mod.essenceOnly).toBe(false);
    }
  });
});
