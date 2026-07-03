/** Game-style item tooltip for the item being crafted. */
import type { BaseItem } from "../data/schema.ts";
import type { EngineData } from "../engine/data.ts";
import { effectiveValues, maxQuality, qualityTag, type Item, type RolledMod } from "../engine/item.ts";
import { renderModText } from "./modtext.ts";

function ModLine({ data, item, rolled, kind }: {
  data: EngineData;
  item: Item;
  rolled: RolledMod;
  kind: "implicit" | "explicit";
}) {
  const mod = data.mod(rolled.modId);
  const values = effectiveValues(data, item, rolled);
  const boosted = values !== rolled.values;
  return (
    <li className={`mod ${kind} ${rolled.fractured ? "fractured" : ""} ${boosted ? "boosted" : ""}`}>
      {renderModText(mod.text, values)}
      {rolled.fractured && <span className="mod-tag"> (fractured)</span>}
    </li>
  );
}

const defenceRows = (p: NonNullable<BaseItem["properties"]>): [string, string][] => {
  const rows: [string, string][] = [];
  if (p.blockChance) rows.push(["Block chance", `${p.blockChance}%`]);
  if (p.armour) rows.push(["Armour", `${p.armour}`]);
  if (p.evasion) rows.push(["Evasion Rating", `${p.evasion}`]);
  if (p.energyShield) rows.push(["Energy Shield", `${p.energyShield}`]);
  if (p.ward) rows.push(["Runic Ward", `${p.ward}`]);
  return rows;
};

const damageSpan = (min?: number, max?: number): string | undefined =>
  min !== undefined && max !== undefined ? `${min}-${max}` : undefined;

const weaponRows = (p: NonNullable<BaseItem["properties"]>): [string, string][] => {
  const rows: [string, string][] = [];
  const phys = damageSpan(p.physMin, p.physMax);
  if (phys) rows.push(["Physical Damage", phys]);
  const elemental = [
    damageSpan(p.fireMin, p.fireMax),
    damageSpan(p.coldMin, p.coldMax),
    damageSpan(p.lightningMin, p.lightningMax),
  ].filter((s): s is string => s !== undefined);
  if (elemental.length > 0) rows.push(["Elemental Damage", elemental.join(", ")]);
  const chaos = damageSpan(p.chaosMin, p.chaosMax);
  if (chaos) rows.push(["Chaos Damage", chaos]);
  if (p.critChance) rows.push(["Critical Hit Chance", `${p.critChance}%`]);
  if (p.attacksPerSecond) rows.push(["Attacks per Second", `${p.attacksPerSecond}`]);
  if (p.reloadTime) rows.push(["Reload Time", `${p.reloadTime}`]);
  return rows;
};

function requirementsLine(base: BaseItem): string | undefined {
  const req = base.req;
  if (!req) return undefined;
  const parts: string[] = [];
  if (req.level) parts.push(`Level ${req.level}`);
  if (req.str) parts.push(`${req.str} Str`);
  if (req.dex) parts.push(`${req.dex} Dex`);
  if (req.int) parts.push(`${req.int} Int`);
  return parts.length > 0 ? `Requires ${parts.join(", ")}` : undefined;
}

export function ItemCard({ data, item, onClick, active }: {
  data: EngineData;
  item: Item;
  onClick?: () => void;
  active?: boolean;
}) {
  const base = data.base(item.baseId);
  const stats = base.properties
    ? [...defenceRows(base.properties), ...weaponRows(base.properties)]
    : [];
  const requirements = requirementsLine(base);
  const tag = qualityTag(item);

  return (
    <article
      className={`item-card rarity-${item.rarity} ${active ? "item-card-active" : ""}`}
      onClick={onClick}
    >
      <header>
        <h2>{base.name}</h2>
        <p className="item-class">
          {base.itemClass} · Item Level {item.ilvl}
        </p>
      </header>
      {(stats.length > 0 || item.quality) && (
        <ul className="item-stats">
          {item.quality && tag && (
            <li className="stat-line quality-line">
              <span>Quality ({tag} modifiers)</span>
              <span className="stat-value">
                +{item.quality.percent}% (max {maxQuality(data, item)}%)
              </span>
            </li>
          )}
          {stats.map(([label, value]) => (
            <li key={label} className="stat-line">
              <span>{label}</span>
              <span className="stat-value">{value}</span>
            </li>
          ))}
        </ul>
      )}
      {requirements && <p className="item-reqs">{requirements}</p>}
      {item.implicits.length > 0 && (
        <ul className="mods">
          {item.implicits.map((rolled, i) => (
            <ModLine key={`imp-${i}`} data={data} item={item} rolled={rolled} kind="implicit" />
          ))}
        </ul>
      )}
      {item.explicits.length > 0 && (
        <ul className="mods">
          {item.explicits.map((rolled, i) => (
            <ModLine
              key={`exp-${rolled.modId}-${i}`}
              data={data}
              item={item}
              rolled={rolled}
              kind="explicit"
            />
          ))}
        </ul>
      )}
      {item.explicits.length === 0 && item.rarity === "normal" && (
        <p className="item-hint">No explicit modifiers</p>
      )}
      {item.sanctified && <p className="sanctified-line">Sanctified</p>}
      {item.corrupted && <p className="corrupted-line">Corrupted</p>}
    </article>
  );
}
