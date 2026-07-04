/**
 * The stash: game-style tabs (Currency / Essences / Omens / Breach /
 * Delirium / Verisium) with dedicated slots per currency, like the in-game
 * specialised stash tabs. Click a slot to pick the currency up, click the
 * item to apply. Omen slots arm instead of picking up.
 */
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import type { CurrencyItem, Essence } from "../data/schema.ts";
import { actionFor } from "../engine/actions.ts";
import { tradeSlug, type EngineData } from "../engine/data.ts";
import type { Item } from "../engine/item.ts";
import { ALLOYS, BONES, CATALYSTS, CORRUPTED_ESSENCES, OMEN } from "../engine/mechanics.ts";

const TABS = ["Currency", "Essences", "Runes", "Omens", "Abyss", "Breach", "Delirium", "Verisium"] as const;
type TabId = (typeof TABS)[number];

/** The stash tab a currency id lives in (tutorial mode jumps to it). */
function tabForCurrency(data: EngineData, id: string): TabId {
  if (data.essenceByCurrencyId.has(id)) return "Essences";
  if (data.emotionByCurrencyId.has(id)) return "Delirium";
  if (data.runeById.has(id)) return "Runes";
  if (CATALYSTS.has(id)) return "Breach";
  if (ALLOYS.has(id)) return "Verisium";
  if (BONES.has(id) || id === "preserved-vertebrae") return "Abyss";
  if (id.startsWith("omen-")) return "Omens";
  return "Currency";
}

/** The 15 standard rune kinds, in the game tab's order; 4 tiers each. */
const RUNE_KINDS = [
  "Desert", "Glacial", "Storm", "Iron", "Body", "Mind", "Rebirth",
  "Inspiration", "Stone", "Vision", "Robust", "Adept", "Resolve",
  "Ward", "Charging",
] as const;
const RUNE_TIERS = ["Lesser", "", "Greater", "Perfect"] as const;
const STANDARD_RUNE = new RegExp(
  `^(Lesser |Greater |Perfect )?(${RUNE_KINDS.join("|")}) Rune$`,
);

interface RuneGroups {
  /** kind -> currency id per tier column (Lesser/base/Greater/Perfect). */
  grid: [kind: string, row: (string | undefined)[]][];
  runecrafted: string[];
  warding: string[];
  ancient: string[];
  fabled: string[];
  legacy: string[];
}

function groupRunes(currency: CurrencyItem[]): RuneGroups {
  const grid = new Map<string, (string | undefined)[]>(RUNE_KINDS.map((k) => [k, []]));
  const groups: RuneGroups = {
    grid: [],
    runecrafted: [],
    warding: [],
    ancient: [],
    fabled: [],
    legacy: [],
  };
  for (const c of currency) {
    if (c.category !== "Runes") continue;
    const standard = STANDARD_RUNE.exec(c.name);
    if (standard) {
      const tier = standard[1]?.trim() ?? "";
      grid.get(standard[2])![RUNE_TIERS.indexOf(tier as (typeof RUNE_TIERS)[number])] = c.id;
    } else if (c.name.startsWith("Legacy of ")) groups.legacy.push(c.id);
    else if (c.name.startsWith("Warding Rune")) groups.warding.push(c.id);
    else if (c.name.startsWith("Ancient Rune")) groups.ancient.push(c.id);
    else if (/^(Lesser |Greater |Perfect )?Rune of /.test(c.name)) groups.runecrafted.push(c.id);
    else groups.fabled.push(c.id);
  }
  groups.grid = [...grid.entries()];
  return groups;
}

/** Abyssal bones by quality tier (Preserved Vertebrae = waystones, dimmed). */
const BONE_SECTIONS: { title: string; ids: string[] }[] = [
  { title: "Gnawed bones — up to item level 64", ids: [
    "gnawed-jawbone", "gnawed-rib", "gnawed-collarbone",
  ] },
  { title: "Preserved bones", ids: [
    "preserved-jawbone", "preserved-rib", "preserved-collarbone",
    "preserved-cranium", "preserved-vertebrae",
  ] },
  { title: "Ancient bones — modifier level 40+", ids: [
    "ancient-jawbone", "ancient-rib", "ancient-collarbone",
  ] },
];

/** Currency tab: dedicated slot groups, like the game's currency tab. */
const CURRENCY_SECTIONS: { title: string; ids: string[] }[] = [
  {
    title: "Orbs of Enhancement",
    ids: [
      "transmute", "aug", "alch", "regal", "exalted", "chaos",
      "annul", "divine", "vaal", "fracturing-orb", "artificers",
    ],
  },
  {
    title: "Greater Orbs",
    ids: [
      "greater-orb-of-transmutation", "greater-orb-of-augmentation",
      "greater-regal-orb", "greater-exalted-orb", "greater-chaos-orb",
    ],
  },
  {
    title: "Perfect Orbs",
    ids: [
      "perfect-orb-of-transmutation", "perfect-orb-of-augmentation",
      "perfect-regal-orb", "perfect-exalted-orb", "perfect-chaos-orb",
    ],
  },
];

/** Crafting omens in display order; the rest of the Ritual tab is dimmed. */
const CRAFT_OMEN_ORDER: string[] = [
  OMEN.whittling, OMEN.sinistralErasure, OMEN.dextralErasure,
  OMEN.sinistralAnnulment, OMEN.dextralAnnulment,
  OMEN.sinistralExaltation, OMEN.dextralExaltation, OMEN.greaterExaltation,
  OMEN.homogenisingExaltation, OMEN.catalysingExaltation,
  OMEN.homogenisingCoronation,
  OMEN.sinistralCrystallisation, OMEN.dextralCrystallisation,
  OMEN.sanctification,
  OMEN.sovereign, OMEN.liege, OMEN.blackblooded,
  OMEN.sinistralNecromancy, OMEN.dextralNecromancy,
  OMEN.putrefaction, OMEN.abyssalEchoes, OMEN.light,
];

const ESSENCE_TIERS = ["Lesser", "", "Greater", "Perfect"] as const;

function essenceTierIndex(name: string): number {
  if (name.startsWith("Lesser ")) return 0;
  if (name.startsWith("Greater ")) return 1 + 1;
  if (name.startsWith("Perfect ")) return 3;
  return 1;
}

interface TooltipState {
  x: number;
  y: number;
  name: string;
  note?: string;
  noteKind: "ok" | "blocked" | "info";
}

export function StashPanel({
  data,
  currency,
  item,
  selected,
  armedOmens,
  onSelect,
  onToggleOmen,
  onHover,
  highlight,
  readOnly = false,
}: {
  data: EngineData;
  currency: CurrencyItem[];
  item: Item | undefined;
  selected: string | undefined;
  armedOmens: string[];
  onSelect: (id: string | undefined) => void;
  onToggleOmen: (id: string) => void;
  /** Hovered currency id, for the odds panel. */
  onHover?: (id: string | undefined) => void;
  /** Tutorial mode: pulse these slots and jump to the currency's tab. */
  highlight?: { currencyId?: string; omens: readonly string[] };
  /** Tutorial mode: slots are display-only. */
  readOnly?: boolean;
}) {
  const [tab, setTab] = useState<TabId>("Currency");
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const byId = useMemo(() => new Map(currency.map((c) => [c.id, c])), [currency]);
  const omens = useMemo(() => new Set(armedOmens), [armedOmens]);
  const highlightId = highlight?.currencyId;
  const highlighted = useMemo(
    () => new Set([...(highlight?.omens ?? []), ...(highlightId ? [highlightId] : [])]),
    [highlight, highlightId],
  );

  useEffect(() => {
    if (highlightId) setTab(tabForCurrency(data, highlightId));
  }, [data, highlightId]);

  const blockedReason = (id: string): string | null | undefined => {
    const action = actionFor(data, id);
    if (!action) return undefined; // not simulated
    if (!item) return "Pick a base item first";
    return action.canApply(data, item, omens);
  };

  const showTooltip = (e: MouseEvent, info: CurrencyItem, isOmen: boolean) => {
    const blocked = blockedReason(info.id);
    let note: string | undefined;
    let noteKind: TooltipState["noteKind"] = "ok";
    if (readOnly) {
      note = "Tutorial mode — crafting is paused";
      noteKind = "info";
    } else if (isOmen) {
      note = omens.has(info.id)
        ? "Armed — consumed by the next matching currency use"
        : "Click to arm for the next currency use";
      noteKind = "info";
    } else if (blocked === undefined) {
      note = "Not usable in the simulator";
      noteKind = "info";
    } else if (blocked) {
      note = blocked;
      noteKind = "blocked";
    } else {
      note = selected === info.id ? "Click the item to apply" : "Click to pick up";
    }
    setTooltip({ x: e.clientX, y: e.clientY, name: info.name, note, noteKind });
  };

  const slot = (id: string, options: { omen?: boolean; dim?: boolean } = {}) => {
    const info = byId.get(id);
    if (!info) return null;
    const isOmen = options.omen ?? false;
    const blocked = blockedReason(id);
    const classes = ["slot"];
    if (selected === id) classes.push("slot-selected");
    if (isOmen && omens.has(id)) classes.push("slot-armed");
    if (highlighted.has(id)) classes.push("slot-highlight");
    if (options.dim || blocked === undefined) classes.push("slot-unusable");
    else if (!isOmen && blocked) classes.push("slot-blocked");
    return (
      <button
        key={id}
        type="button"
        className={classes.join(" ")}
        onClick={() => {
          if (options.dim || readOnly) return;
          if (isOmen) onToggleOmen(id);
          else if (blocked === undefined) return;
          else onSelect(selected === id ? undefined : id);
        }}
        onMouseEnter={(e) => {
          showTooltip(e, info, isOmen);
          if (blocked !== undefined) onHover?.(id);
        }}
        onMouseMove={(e) => showTooltip(e, info, isOmen)}
        onMouseLeave={() => {
          setTooltip(null);
          onHover?.(undefined);
        }}
      >
        <img src={info.icon} alt={info.name} loading="lazy" draggable={false} />
        {isOmen && omens.has(id) && <span className="slot-pip" />}
      </button>
    );
  };

  // --- Essences: one row per essence type, tier columns like the game tab ---
  const essenceRows = useMemo(() => {
    const rows = new Map<string, (Essence | undefined)[]>();
    const corrupted: Essence[] = [];
    for (const essence of data.essenceByCurrencyId.values()) {
      if (CORRUPTED_ESSENCES.has(essence.name)) {
        corrupted.push(essence);
        continue;
      }
      const row = rows.get(essence.type) ?? new Array(4).fill(undefined);
      row[essenceTierIndex(essence.name)] = essence;
      rows.set(essence.type, row);
    }
    return {
      rows: [...rows.entries()].sort((a, b) => a[0].localeCompare(b[0])),
      corrupted: corrupted.sort((a, b) => a.name.localeCompare(b.name)),
    };
  }, [data]);

  const emotionIds = useMemo(() => {
    const all = [...data.emotionByCurrencyId.entries()].map(([id, e]) => ({ ...e, id }));
    all.sort((a, b) => a.tierLevel - b.tierLevel || a.name.localeCompare(b.name));
    return {
      regular: all.filter((e) => !e.radiusJewel).map((e) => e.id),
      ancient: all.filter((e) => e.radiusJewel).map((e) => e.id),
    };
  }, [data]);

  const ritualIds = useMemo(
    () => currency.filter((c) => c.category === "Ritual" && c.id.startsWith("omen-")),
    [currency],
  );
  const otherOmens = ritualIds
    .map((c) => c.id)
    .filter((id) => !CRAFT_OMEN_ORDER.includes(id));

  const catalystIds = useMemo(() => {
    const breach = currency.filter((c) => CATALYSTS.has(c.id)).map((c) => c.id);
    return {
      regular: breach.filter((id) => !id.startsWith("refined-")),
      refined: breach.filter((id) => id.startsWith("refined-")),
    };
  }, [currency]);

  const alloyIds = useMemo(
    () => currency.filter((c) => ALLOYS.has(c.id)).map((c) => c.id),
    [currency],
  );

  const runeGroups = useMemo(() => groupRunes(currency), [currency]);

  return (
    <section className="stash">
      <div className="stash-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={`stash-tab stash-tab-${t.toLowerCase()} ${tab === t ? "stash-tab-active" : ""}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="stash-body">
        {tab === "Currency" &&
          CURRENCY_SECTIONS.map((section) => (
            <div key={section.title} className="stash-section">
              <h4>{section.title}</h4>
              <div className="slot-grid">{section.ids.map((id) => slot(id))}</div>
            </div>
          ))}

        {tab === "Essences" && (
          <>
            <div className="stash-section">
              <div className="essence-grid">
                <span className="essence-head" />
                {ESSENCE_TIERS.map((t, i) => (
                  <span key={i} className="essence-head">{t || "Essence"}</span>
                ))}
                {essenceRows.rows.map(([type, row]) => (
                  <EssenceRow key={type} type={type} row={row} slot={slot} />
                ))}
              </div>
            </div>
            <div className="stash-section">
              <h4>Corrupted</h4>
              <div className="slot-grid">
                {essenceRows.corrupted.map((e) => slot(tradeSlug(e.name)))}
              </div>
            </div>
          </>
        )}

        {tab === "Runes" && (
          <>
            <div className="stash-section">
              <div className="essence-grid">
                <span className="essence-head" />
                {RUNE_TIERS.map((t, i) => (
                  <span key={i} className="essence-head">{t || "Rune"}</span>
                ))}
                {runeGroups.grid.map(([kind, row]) => (
                  <RuneRow key={kind} kind={kind} row={row} slot={slot} />
                ))}
              </div>
            </div>
            <div className="stash-section">
              <h4>Runecrafted</h4>
              <div className="slot-grid">{runeGroups.runecrafted.map((id) => slot(id))}</div>
            </div>
            <div className="stash-section">
              <h4>Warding runes</h4>
              <div className="slot-grid">{runeGroups.warding.map((id) => slot(id))}</div>
            </div>
            <div className="stash-section">
              <h4>Ancient runes — limit 1 per item</h4>
              <div className="slot-grid">{runeGroups.ancient.map((id) => slot(id))}</div>
            </div>
            <div className="stash-section">
              <h4>Fabled &amp; Aldur runes</h4>
              <div className="slot-grid">{runeGroups.fabled.map((id) => slot(id))}</div>
            </div>
            <div className="stash-section">
              <h4>Aldur's Legacy — limit 1 per item</h4>
              <div className="slot-grid">{runeGroups.legacy.map((id) => slot(id))}</div>
            </div>
          </>
        )}

        {tab === "Omens" && (
          <>
            <div className="stash-section">
              <h4>Crafting omens — click to arm</h4>
              <div className="slot-grid">
                {CRAFT_OMEN_ORDER.map((id) => slot(id, { omen: true }))}
              </div>
            </div>
            <div className="stash-section">
              <h4>Other omens</h4>
              <div className="slot-grid">
                {otherOmens.map((id) => slot(id, { dim: true }))}
              </div>
            </div>
          </>
        )}

        {tab === "Abyss" &&
          BONE_SECTIONS.map((section) => (
            <div key={section.title} className="stash-section">
              <h4>{section.title}</h4>
              <div className="slot-grid">{section.ids.map((id) => slot(id))}</div>
            </div>
          ))}

        {tab === "Breach" && (
          <>
            <div className="stash-section">
              <h4>Catalysts — rings &amp; amulets</h4>
              <div className="slot-grid">{catalystIds.regular.map((id) => slot(id))}</div>
            </div>
            <div className="stash-section">
              <h4>Refined catalysts — jewels</h4>
              <div className="slot-grid">{catalystIds.refined.map((id) => slot(id))}</div>
            </div>
          </>
        )}

        {tab === "Delirium" && (
          <>
            <div className="stash-section">
              <h4>Liquid emotions — jewels</h4>
              <div className="slot-grid">{emotionIds.regular.map((id) => slot(id))}</div>
            </div>
            <div className="stash-section">
              <h4>Ancient emotions — Time-Lost jewels</h4>
              <div className="slot-grid">{emotionIds.ancient.map((id) => slot(id))}</div>
            </div>
          </>
        )}

        {tab === "Verisium" && (
          <div className="stash-section">
            <h4>Alloys</h4>
            <div className="slot-grid">{alloyIds.map((id) => slot(id))}</div>
          </div>
        )}
      </div>

      {tooltip && (
        <div
          className="stash-tooltip"
          style={{ left: Math.min(tooltip.x + 14, window.innerWidth - 280), top: tooltip.y + 18 }}
        >
          <div className="tooltip-name">{tooltip.name}</div>
          {tooltip.note && (
            <div className={`tooltip-note tooltip-${tooltip.noteKind}`}>{tooltip.note}</div>
          )}
        </div>
      )}
    </section>
  );
}

function RuneRow({ kind, row, slot }: {
  kind: string;
  row: (string | undefined)[];
  slot: (id: string) => React.ReactNode;
}) {
  return (
    <>
      <span className="essence-type">{kind}</span>
      {RUNE_TIERS.map((_, i) => (
        <span key={i} className="essence-cell">
          {row[i] ? slot(row[i]!) : <span className="slot slot-empty" />}
        </span>
      ))}
    </>
  );
}

function EssenceRow({ type, row, slot }: {
  type: string;
  row: (Essence | undefined)[];
  slot: (id: string) => React.ReactNode;
}) {
  return (
    <>
      <span className="essence-type">{type.replace(/([a-z])([A-Z])/g, "$1 $2")}</span>
      {row.map((essence, i) => (
        <span key={i} className="essence-cell">
          {essence ? slot(tradeSlug(essence.name)) : <span className="slot slot-empty" />}
        </span>
      ))}
    </>
  );
}
