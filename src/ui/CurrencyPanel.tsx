/** The currency stash: supported orbs with GGG icons, click to pick up. */
import type { CurrencyItem } from "../data/schema.ts";
import { ACTIONS } from "../engine/actions.ts";
import type { EngineData } from "../engine/data.ts";
import type { Item } from "../engine/item.ts";

/** Display order: base orbs first, then Greater/Perfect tiers. */
const ORDER = [
  "transmute", "aug", "regal", "alch", "exalted", "chaos", "annul", "divine", "vaal",
  "greater-orb-of-transmutation", "greater-orb-of-augmentation", "greater-regal-orb",
  "greater-exalted-orb", "greater-chaos-orb",
  "perfect-orb-of-transmutation", "perfect-orb-of-augmentation", "perfect-regal-orb",
  "perfect-exalted-orb", "perfect-chaos-orb",
];

export function CurrencyPanel({ data, currency, item, selected, onSelect }: {
  data: EngineData;
  currency: CurrencyItem[];
  item: Item | undefined;
  selected: string | undefined;
  onSelect: (id: string | undefined) => void;
}) {
  const byId = new Map(currency.map((c) => [c.id, c]));
  return (
    <section className="currency-panel">
      <h3>Currency</h3>
      <div className="currency-grid">
        {ORDER.map((id) => {
          const info = byId.get(id);
          const action = ACTIONS.get(id);
          if (!info || !action) return null;
          const blocked = item ? action.canApply(data, item) : "Pick a base item first";
          return (
            <button
              key={id}
              type="button"
              className={`currency ${selected === id ? "currency-selected" : ""} ${
                blocked ? "currency-blocked" : ""
              }`}
              title={blocked ? `${info.name} — ${blocked}` : info.name}
              onClick={() => onSelect(selected === id ? undefined : id)}
            >
              <img src={info.icon} alt={info.name} loading="lazy" />
            </button>
          );
        })}
      </div>
      {selected && (
        <p className="currency-hint">
          {byId.get(selected)?.name}: click the item to apply, click again to put down.
        </p>
      )}
    </section>
  );
}
