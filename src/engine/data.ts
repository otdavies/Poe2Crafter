/**
 * EngineData: indexed view over the compiled data bundle. Built once at app
 * startup (or per test) from the raw JSON arrays.
 */
import type { BaseItem, Mod } from "../data/schema.ts";

export class EngineData {
  readonly modById: ReadonlyMap<string, Mod>;
  readonly baseById: ReadonlyMap<string, BaseItem>;
  /** The general craftable pool: prefixes/suffixes rollable by currency. */
  readonly affixPool: readonly Mod[];
  /** Vaal Orb implicit pool. */
  readonly corruptedPool: readonly Mod[];

  constructor(mods: Mod[], bases: BaseItem[]) {
    this.modById = new Map(mods.map((m) => [m.id, m]));
    this.baseById = new Map(bases.map((b) => [b.id, b]));
    this.affixPool = mods.filter(
      (m) => (m.generation === "prefix" || m.generation === "suffix") && !m.essenceOnly,
    );
    this.corruptedPool = mods.filter((m) => m.generation === "corrupted");
  }

  mod(id: string): Mod {
    const mod = this.modById.get(id);
    if (!mod) throw new Error(`unknown mod: ${id}`);
    return mod;
  }

  base(id: string): BaseItem {
    const base = this.baseById.get(id);
    if (!base) throw new Error(`unknown base: ${id}`);
    return base;
  }
}
