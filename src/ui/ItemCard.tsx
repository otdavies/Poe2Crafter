/**
 * Game-style item tooltip. Mirrors the in-game layout: rarity name plate
 * (rares get their name above the base name), centred stat lines, golden
 * separators, then enchants → implicits → explicits. With `advanced` on
 * (game: hold Alt) it adds the Item Level line, per-mod headers
 * (`Prefix Modifier "Hale" (Tier: 7) — Life`) and roll ranges.
 */
import type { ReactNode } from "react";
import { Fragment } from "react";
import type { BaseItem, BaseProperties, Mod } from "../data/schema.ts";
import type { EngineData } from "../engine/data.ts";
import { computedProperties } from "../engine/defences.ts";
import { effectiveValues, maxQuality, qualityTag, type Item, type RolledMod } from "../engine/item.ts";
import { runeEffectFor, socketedRunes } from "../engine/runes.ts";
import { modTier } from "../engine/tiers.ts";
import { itemHeader } from "./itemname.ts";
import { renderModText, renderModTextRanges } from "./modtext.ts";

type PropKey = keyof BaseProperties;
type Augmented = ReadonlySet<PropKey>;
/** label, display value, whether any shown property was modified locally */
type StatRow = [string, string, boolean];

const capitalise = (tag: string): string => tag.charAt(0).toUpperCase() + tag.slice(1);

/**
 * The game's Alt header shows the simple mod tags ("Elemental, Cold,
 * Resistance"); the datamined list also carries compound catalyst tags
 * ("Cold_resistance") — drop those unless they're all we have.
 */
function displayTags(mod: Mod): string[] {
  const simple = mod.catalystTags.filter((t) => !t.includes("_"));
  const tags = simple.length > 0 ? simple : mod.catalystTags;
  return tags.map((t) => t.split("_").map(capitalise).join(" "));
}

/** Advanced header, e.g. `Prefix Modifier "Hale" (Tier: 7) — Life, Attack`. */
function modHeader(data: EngineData, item: Item, mod: Mod): string {
  const parts: string[] = [];
  if (mod.generation === "prefix" || mod.generation === "suffix") {
    let head = `${mod.desecrated ? "Desecrated " : ""}${capitalise(mod.generation)} Modifier`;
    if (mod.name) head += ` "${mod.name}"`;
    if (!mod.desecrated) {
      const tier = modTier(data, item, mod.id);
      if (tier && tier.count > 1) head += ` (Tier: ${tier.tier})`;
    }
    parts.push(head);
  } else if (mod.generation === "corrupted") {
    parts.push("Enchant Modifier");
  } else {
    parts.push("Implicit Modifier");
  }
  if (mod.catalystTags.length > 0) {
    parts.push(displayTags(mod).join(", "));
  }
  return parts.join(" — ");
}

/** Roll ranges are inserted with an en-dash; dim them like the game does. */
function withDimmedRanges(text: string): ReactNode {
  const pieces = text.split(/(\(\d+(?:\.\d+)?–\d+(?:\.\d+)?\))/);
  if (pieces.length === 1) return text;
  return pieces.map((piece, i) =>
    i % 2 === 1 ? <span key={i} className="mod-range">{piece}</span> : piece,
  );
}

/** Always-visible tier chip on the left of an affix. T1 = best (0.5). */
function TierBadge({ data, item, modId }: { data: EngineData; item: Item; modId: string }) {
  if (data.mod(modId).desecrated) {
    return (
      <span
        className="tier-badge tier-desecrated"
        title="Desecrated modifier — revealed at the Well of Souls"
      >
        ◆
      </span>
    );
  }
  const tier = modTier(data, item, modId);
  if (!tier) return null;
  const grade =
    tier.tier === 1 ? "tier-top" : (tier.tier - 1) / tier.count <= 0.25 ? "tier-high" : "";
  return (
    <span
      className={`tier-badge ${grade}`}
      title={`Tier ${tier.tier} of ${tier.count} — Tier 1 is the strongest`}
    >
      T{tier.tier}
    </span>
  );
}

function ModLine({ data, item, rolled, kind, advanced }: {
  data: EngineData;
  item: Item;
  rolled: RolledMod;
  kind: "implicit" | "enchant" | "explicit";
  advanced: boolean;
}) {
  const mod = data.mod(rolled.modId);
  const values = effectiveValues(data, item, rolled);
  const boosted = values !== rolled.values;
  const text = advanced
    ? withDimmedRanges(renderModTextRanges(mod.text, values, mod.stats))
    : renderModText(mod.text, values, mod.stats);
  return (
    <li
      className={`mod ${kind} ${mod.desecrated ? "desecrated" : ""} ${
        rolled.fractured ? "fractured" : ""
      } ${boosted ? "boosted" : ""}`}
    >
      {kind === "explicit" && <TierBadge data={data} item={item} modId={rolled.modId} />}
      {advanced && <span className="mod-info">{modHeader(data, item, mod)}</span>}
      <span className="mod-text">
        {text}
        {rolled.fractured && <span className="mod-tag"> (fractured)</span>}
      </span>
    </li>
  );
}

const defenceRows = (p: BaseProperties, aug: Augmented): StatRow[] => {
  const rows: StatRow[] = [];
  if (p.blockChance) rows.push(["Block chance", `${p.blockChance}%`, aug.has("blockChance")]);
  if (p.armour) rows.push(["Armour", `${p.armour}`, aug.has("armour")]);
  if (p.evasion) rows.push(["Evasion Rating", `${p.evasion}`, aug.has("evasion")]);
  if (p.energyShield) rows.push(["Energy Shield", `${p.energyShield}`, aug.has("energyShield")]);
  if (p.ward) rows.push(["Runic Ward", `${p.ward}`, aug.has("ward")]);
  return rows;
};

const damageSpan = (min?: number, max?: number): string | undefined =>
  min !== undefined && max !== undefined ? `${min}-${max}` : undefined;

const weaponRows = (p: BaseProperties, aug: Augmented): StatRow[] => {
  const rows: StatRow[] = [];
  const phys = damageSpan(p.physMin, p.physMax);
  if (phys) rows.push(["Physical Damage", phys, aug.has("physMin") || aug.has("physMax")]);
  const elemental = [
    damageSpan(p.fireMin, p.fireMax),
    damageSpan(p.coldMin, p.coldMax),
    damageSpan(p.lightningMin, p.lightningMax),
  ].filter((s): s is string => s !== undefined);
  if (elemental.length > 0) {
    const elementalAug = (["fireMin", "fireMax", "coldMin", "coldMax", "lightningMin", "lightningMax"] as PropKey[])
      .some((k) => aug.has(k));
    rows.push(["Elemental Damage", elemental.join(", "), elementalAug]);
  }
  const chaos = damageSpan(p.chaosMin, p.chaosMax);
  if (chaos) rows.push(["Chaos Damage", chaos, aug.has("chaosMin") || aug.has("chaosMax")]);
  if (p.critChance) {
    rows.push(["Critical Hit Chance", `${p.critChance}%`, aug.has("critChance")]);
  }
  if (p.attacksPerSecond) {
    rows.push(["Attacks per Second", `${p.attacksPerSecond}`, aug.has("attacksPerSecond")]);
  }
  if (p.reloadTime) rows.push(["Reload Time", `${p.reloadTime}`, aug.has("reloadTime")]);
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
  return parts.length > 0 ? `Requires: ${parts.join(", ")}` : undefined;
}

/** Socket circles like the item art in game; click one to socket into it. */
function SocketBar({ data, item, runeIcons, onSocketClick }: {
  data: EngineData;
  item: Item;
  runeIcons?: ReadonlyMap<string, string>;
  onSocketClick?: (index: number) => void;
}) {
  return (
    <div className="item-sockets">
      {(item.sockets ?? []).map((runeId, i) => {
        const name = runeId ? data.rune(runeId).name : "Empty Rune Socket";
        const icon = runeId ? runeIcons?.get(runeId) : undefined;
        return (
          <button
            key={i}
            type="button"
            className={`socket ${runeId ? "socket-filled" : "socket-empty"} ${
              onSocketClick ? "socket-clickable" : ""
            }`}
            title={onSocketClick ? `${name} — click to socket here` : name}
            disabled={!onSocketClick}
            onClick={(e) => {
              e.stopPropagation();
              onSocketClick?.(i);
            }}
          >
            {icon && <img src={icon} alt={name} draggable={false} />}
          </button>
        );
      })}
    </div>
  );
}

/** Effect lines of the socketed runes, styled like the game's rune mods. */
function RuneLines({ data, item, advanced }: {
  data: EngineData;
  item: Item;
  advanced: boolean;
}) {
  return (
    <ul className="mods mods-rune">
      {socketedRunes(data, item).flatMap((rune, r) => {
        const effect = runeEffectFor(data, item, rune);
        return (effect?.text ?? []).map((line, i) => (
          <li key={`${r}-${i}`} className="mod rune">
            {advanced && <span className="mod-info">Rune Modifier — {rune.name}</span>}
            <span className="mod-text">
              {line}
              <span className="mod-tag"> (rune)</span>
            </span>
          </li>
        ));
      })}
    </ul>
  );
}

export function ItemCard({
  data,
  item,
  onClick,
  active,
  advanced = false,
  runeIcons,
  onSocketClick,
}: {
  data: EngineData;
  item: Item;
  onClick?: () => void;
  active?: boolean;
  advanced?: boolean;
  /** Rune currency id -> icon URL, for filled socket circles. */
  runeIcons?: ReadonlyMap<string, string>;
  /** Live crafting: clicking a socket applies the held rune to it. */
  onSocketClick?: (index: number) => void;
}) {
  const base = data.base(item.baseId);
  const header = itemHeader(data, item);
  const { properties, augmented } = computedProperties(data, item);
  const stats = base.properties
    ? [...defenceRows(properties, augmented), ...weaponRows(properties, augmented)]
    : [];
  const requirements = requirementsLine(base);
  const tag = qualityTag(item);
  // The game splits corruption-granted lines (enchants) from base implicits.
  const enchants = item.implicits.filter((m) => data.mod(m.modId).generation === "corrupted");
  const implicits = item.implicits.filter((m) => data.mod(m.modId).generation !== "corrupted");

  const modList = (mods: RolledMod[], kind: "implicit" | "enchant" | "explicit") => (
    <ul className={`mods mods-${kind}`}>
      {mods.map((rolled, i) => (
        <ModLine
          key={`${kind}-${rolled.modId}-${i}`}
          data={data}
          item={item}
          rolled={rolled}
          kind={kind}
          advanced={advanced}
        />
      ))}
    </ul>
  );

  const sections: ReactNode[] = [];
  if (stats.length > 0 || item.quality) {
    sections.push(
      <ul className="item-stats" key="stats">
        {item.quality && (
          <li className="stat-line quality-line">
            <span className="stat-label">
              {tag ? `Quality (${tag} Modifiers):` : "Quality:"}
            </span>
            <span className="stat-value">
              +{item.quality.percent}% (max {maxQuality(data, item)}%)
            </span>
          </li>
        )}
        {stats.map(([label, value, isAugmented]) => (
          <li key={label} className="stat-line">
            <span className="stat-label">{label}:</span>
            <span className={`stat-value ${isAugmented ? "stat-augmented" : ""}`}>{value}</span>
          </li>
        ))}
      </ul>,
    );
  }
  if ((item.sockets?.length ?? 0) > 0) {
    sections.push(
      <SocketBar
        key="sockets"
        data={data}
        item={item}
        runeIcons={runeIcons}
        onSocketClick={onSocketClick}
      />,
    );
  }
  if (requirements) sections.push(<p className="item-reqs" key="reqs">{requirements}</p>);
  if (advanced) {
    sections.push(
      <p className="item-ilvl" key="ilvl">
        Item Level: <span>{item.ilvl}</span>
      </p>,
    );
  }
  if (enchants.length > 0) sections.push(<Fragment key="enchants">{modList(enchants, "enchant")}</Fragment>);
  if (implicits.length > 0) sections.push(<Fragment key="implicits">{modList(implicits, "implicit")}</Fragment>);
  if ((item.sockets ?? []).some((s) => s !== null)) {
    sections.push(<RuneLines key="runes" data={data} item={item} advanced={advanced} />);
  }
  if (item.explicits.length > 0) {
    sections.push(<Fragment key="explicits">{modList(item.explicits, "explicit")}</Fragment>);
  }
  if (item.sanctified) sections.push(<p className="sanctified-line" key="sanctified">Sanctified</p>);
  if (item.corrupted) sections.push(<p className="corrupted-line" key="corrupted">Corrupted</p>);

  return (
    <article
      className={`item-card rarity-${item.rarity} ${active ? "item-card-active" : ""}`}
      onClick={onClick}
    >
      <header className={`item-header ${header.base ? "item-header-double" : ""}`}>
        <span className="item-class">{base.itemClass}</span>
        <h2>{header.name}</h2>
        {header.base && <p className="item-basename">{header.base}</p>}
      </header>
      <div className="item-body">
        {sections.map((section, i) => (
          <Fragment key={i}>
            {i > 0 && <div className="item-sep" />}
            {section}
          </Fragment>
        ))}
      </div>
    </article>
  );
}
