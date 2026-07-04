/**
 * EngineData: indexed view over the compiled data bundle. Built once at app
 * startup (or per test) from the raw JSON arrays.
 */
import type { BaseItem, DistilledEmotion, Essence, Mod, Rune } from "../data/schema.ts";

/**
 * Trade-API id for a display name ("Lesser Essence of the Body" ->
 * "lesser-essence-of-the-body"). The trade site derives its ids this way;
 * a bundle test asserts the join holds for every essence and emotion.
 */
export function tradeSlug(name: string): string {
  // Unicode letters survive ("Legacy of Mjölner" -> "legacy-of-mjölner").
  return name
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");
}

export class EngineData {
  readonly modById: ReadonlyMap<string, Mod>;
  readonly baseById: ReadonlyMap<string, BaseItem>;
  /** The general craftable pool: prefixes/suffixes rollable by currency. */
  readonly affixPool: readonly Mod[];
  /** Desecrated modifiers — only revealed by abyssal bones, never rolled. */
  readonly desecratedPool: readonly Mod[];
  /** Vaal Orb implicit pool. */
  readonly corruptedPool: readonly Mod[];
  /** Essences/emotions keyed by trade currency id. */
  readonly essenceByCurrencyId: ReadonlyMap<string, Essence>;
  readonly emotionByCurrencyId: ReadonlyMap<string, DistilledEmotion>;
  /** Socketable runes keyed by trade currency id. */
  readonly runeById: ReadonlyMap<string, Rune>;

  constructor(
    mods: Mod[],
    bases: BaseItem[],
    essences: Essence[] = [],
    emotions: DistilledEmotion[] = [],
    runes: Rune[] = [],
  ) {
    this.modById = new Map(mods.map((m) => [m.id, m]));
    this.baseById = new Map(bases.map((b) => [b.id, b]));
    this.affixPool = mods.filter(
      (m) =>
        (m.generation === "prefix" || m.generation === "suffix") &&
        !m.essenceOnly &&
        !m.desecrated,
    );
    this.desecratedPool = mods.filter(
      (m) => m.desecrated && (m.generation === "prefix" || m.generation === "suffix"),
    );
    this.corruptedPool = mods.filter((m) => m.generation === "corrupted");
    this.essenceByCurrencyId = new Map(essences.map((e) => [tradeSlug(e.name), e]));
    this.emotionByCurrencyId = new Map(emotions.map((e) => [tradeSlug(e.name), e]));
    this.runeById = new Map(runes.map((r) => [r.id, r]));
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

  rune(id: string): Rune {
    const rune = this.runeById.get(id);
    if (!rune) throw new Error(`unknown rune: ${id}`);
    return rune;
  }
}
