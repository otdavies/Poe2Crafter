/**
 * Computed item properties: the base defence/weapon numbers with LOCAL
 * modifiers folded in — the numbers the in-game tooltip shows. Only
 * `local_*` stats touch these; global mods ("+X to maximum Energy Shield"
 * without the local flag) change the character sheet, not the item card.
 *
 * Scaling follows the game's local formula per property:
 *   (base + Σ flat) × (1 + Σ increased% / 100)
 * Source: poe2wiki "Local modifier" + PoB's calc engine (unchanged in 0.5).
 *
 * Not folded in (documented gaps): hand-wraps "per character level" defence
 * stats (need a character level the sim doesn't have), spirit and accuracy
 * (not in the compiled base properties), weapon range.
 */
import type { BaseProperties } from "../data/schema.ts";
import type { EngineData } from "./data.ts";
import { effectiveValues, type Item } from "./item.ts";

type PropKey = keyof BaseProperties;

/** Flat local additions: stat id → affected properties (+ unit scale). */
const FLAT: Record<string, { props: PropKey[]; scale?: number }> = {
  local_base_physical_damage_reduction_rating: { props: ["armour"] },
  local_base_evasion_rating: { props: ["evasion"] },
  local_energy_shield: { props: ["energyShield"] },
  "local_additional_block_chance_%": { props: ["blockChance"] },
  local_minimum_added_physical_damage: { props: ["physMin"] },
  local_maximum_added_physical_damage: { props: ["physMax"] },
  local_minimum_added_fire_damage: { props: ["fireMin"] },
  local_maximum_added_fire_damage: { props: ["fireMax"] },
  local_minimum_added_cold_damage: { props: ["coldMin"] },
  local_maximum_added_cold_damage: { props: ["coldMax"] },
  local_minimum_added_lightning_damage: { props: ["lightningMin"] },
  local_maximum_added_lightning_damage: { props: ["lightningMax"] },
  local_minimum_added_chaos_damage: { props: ["chaosMin"] },
  local_maximum_added_chaos_damage: { props: ["chaosMax"] },
  // stored in 1/100 of a percent: "+(1.01-1.5)%" is datamined as 101-150
  local_critical_strike_chance: { props: ["critChance"], scale: 1 / 100 },
};

/** %-increased local scaling: stat id → affected properties. */
const INCREASED: Record<string, PropKey[]> = {
  "local_physical_damage_reduction_rating_+%": ["armour"],
  "local_evasion_rating_+%": ["evasion"],
  "local_energy_shield_+%": ["energyShield"],
  "local_armour_and_evasion_+%": ["armour", "evasion"],
  "local_armour_and_energy_shield_+%": ["armour", "energyShield"],
  "local_evasion_and_energy_shield_+%": ["evasion", "energyShield"],
  "local_armour_and_evasion_and_energy_shield_+%": ["armour", "evasion", "energyShield"],
  "local_ward_+%": ["ward"],
  "local_block_chance_+%": ["blockChance"],
  "local_physical_damage_+%": ["physMin", "physMax"],
  "local_attack_speed_+%": ["attacksPerSecond"],
  "local_critical_strike_chance_+%": ["critChance"],
};

/** Defences truncate; damage rounds to whole numbers; rates keep 2 dp. */
const FLOORED = new Set<PropKey>(["armour", "evasion", "energyShield", "ward", "blockChance"]);
const ROUNDED = new Set<PropKey>([
  "physMin", "physMax", "fireMin", "fireMax", "coldMin", "coldMax",
  "lightningMin", "lightningMax", "chaosMin", "chaosMax",
]);

function roundValue(key: PropKey, value: number): number {
  if (FLOORED.has(key)) return Math.floor(value);
  if (ROUNDED.has(key)) return Math.round(value);
  return Math.round(value * 100) / 100;
}

export interface ComputedProperties {
  properties: BaseProperties;
  /** Property keys whose displayed value differs from the plain base. */
  augmented: ReadonlySet<PropKey>;
}

export function computedProperties(data: EngineData, item: Item): ComputedProperties {
  const base = data.base(item.baseId).properties ?? {};
  const flat: Partial<Record<PropKey, number>> = {};
  const increased: Partial<Record<PropKey, number>> = {};

  for (const rolled of [...item.implicits, ...item.explicits]) {
    const mod = data.mod(rolled.modId);
    const values = effectiveValues(data, item, rolled);
    mod.stats.forEach((stat, i) => {
      const value = values[i] ?? 0;
      const flatSpec = FLAT[stat.id];
      if (flatSpec) {
        for (const key of flatSpec.props) {
          flat[key] = (flat[key] ?? 0) + value * (flatSpec.scale ?? 1);
        }
      }
      for (const key of INCREASED[stat.id] ?? []) {
        increased[key] = (increased[key] ?? 0) + value;
      }
    });
  }

  const properties: BaseProperties = { ...base };
  const augmented = new Set<PropKey>();
  const keys = new Set<PropKey>([
    ...(Object.keys(base) as PropKey[]),
    ...(Object.keys(flat) as PropKey[]),
    ...(Object.keys(increased) as PropKey[]),
  ]);
  for (const key of keys) {
    const baseValue = base[key] ?? 0;
    const value = roundValue(
      key,
      (baseValue + (flat[key] ?? 0)) * (1 + (increased[key] ?? 0) / 100),
    );
    properties[key] = value;
    if (value !== baseValue) augmented.add(key);
  }
  return { properties, augmented };
}
