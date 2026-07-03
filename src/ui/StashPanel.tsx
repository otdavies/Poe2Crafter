/**
 * The stash: game-style tabs (Currency / Essences / Omens / Breach /
 * Delirium / Verisium) with dedicated slots per currency, like the in-game
 * specialised stash tabs. Click a slot to pick the currency up, click the
 * item to apply. Omen slots arm instead of picking up.
 */
import { useMemo, useState, type MouseEvent } from "react";
import type { CurrencyItem, Essence } from "../data/schema.ts";
import { actionFor } from "../engine/actions.ts";
import { tradeSlug, type EngineData } from "../engine/data.ts";
import type { Item } from "../engine/item.ts";
import { ALLOYS, CATALYSTS, CORRUPTED_ESSENCES, OMEN } from "../engine/mechanics.ts";

const TABS = ["Currency", "Essences", "Omens", "Breach", "Delirium", "Verisium"] as const;
type TabId = (typeof TABS)[number];

/** Currency tab: dedicated slot groups, like the game's currency tab. */
const CURRENCY_SECTIONS: { title: string; ids: string[] }[] = [
  {
    title: "Orbs of Enhancement",
    ids: [
      "transmute", "aug", "alch", "regal", "exalted", "chaos",
      "annul", "divine", "vaal", "fracturing-orb",
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

export function StashPanel({ data, currency, item, selected, armedOmens, onSelect, onToggleOmen }: {
  data: EngineData;
  currency: CurrencyItem[];
  item: Item | undefined;
  selected: string | undefined;
  armedOmens: string[];
  onSelect: (id: string | undefined) => void;
  onToggleOmen: (id: string) => void;
}) {
  const [tab, setTab] = useState<TabId>("Currency");
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const byId = useMemo(() => new Map(currency.map((c) => [c.id, c])), [currency]);
  const omens = useMemo(() => new Set(armedOmens), [armedOmens]);

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
    if (isOmen) {
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
    if (options.dim || blocked === undefined) classes.push("slot-unusable");
    else if (!isOmen && blocked) classes.push("slot-blocked");
    return (
      <button
        key={id}
        type="button"
        className={classes.join(" ")}
        onClick={() => {
          if (options.dim) return;
          if (isOmen) onToggleOmen(id);
          else if (blocked === undefined) return;
          else onSelect(selected === id ? undefined : id);
        }}
        onMouseEnter={(e) => showTooltip(e, info, isOmen)}
        onMouseMove={(e) => showTooltip(e, info, isOmen)}
        onMouseLeave={() => setTooltip(null)}
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
