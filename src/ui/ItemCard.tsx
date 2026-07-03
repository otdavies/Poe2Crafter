/** Game-style item tooltip for the item being crafted. */
import type { EngineData } from "../engine/data.ts";
import type { Item, RolledMod } from "../engine/item.ts";
import { renderModText } from "./modtext.ts";

function ModLine({ data, rolled, kind }: {
  data: EngineData;
  rolled: RolledMod;
  kind: "implicit" | "explicit";
}) {
  const mod = data.mod(rolled.modId);
  return (
    <li className={`mod ${kind} ${rolled.fractured ? "fractured" : ""}`}>
      {renderModText(mod.text, rolled.values)}
      {rolled.fractured && <span className="mod-tag"> (fractured)</span>}
    </li>
  );
}

export function ItemCard({ data, item, onClick, active }: {
  data: EngineData;
  item: Item;
  onClick?: () => void;
  active?: boolean;
}) {
  const base = data.base(item.baseId);
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
      {item.implicits.length > 0 && (
        <ul className="mods">
          {item.implicits.map((rolled, i) => (
            <ModLine key={`imp-${i}`} data={data} rolled={rolled} kind="implicit" />
          ))}
        </ul>
      )}
      {item.explicits.length > 0 && (
        <ul className="mods">
          {item.explicits.map((rolled, i) => (
            <ModLine key={`exp-${rolled.modId}-${i}`} data={data} rolled={rolled} kind="explicit" />
          ))}
        </ul>
      )}
      {item.explicits.length === 0 && item.rarity === "normal" && (
        <p className="item-hint">No explicit modifiers</p>
      )}
      {item.corrupted && <p className="corrupted-line">Corrupted</p>}
    </article>
  );
}
