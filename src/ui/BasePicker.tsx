/**
 * Choose an item class, base, and item level to start a craft — with a live
 * preview of the exact item you'll start on (the preview IS the starting
 * item, implicit rolls included, so what you see is what you craft).
 */
import { useMemo, useState } from "react";
import type { EngineData } from "../engine/data.ts";
import { createItem, type Item } from "../engine/item.ts";
import { liveRng } from "../engine/rng.ts";
import { ItemCard } from "./ItemCard.tsx";

const clampIlvl = (n: number): number =>
  Number.isFinite(n) ? Math.min(100, Math.max(1, Math.round(n))) : 1;

export function BasePicker({ data, onStart }: {
  data: EngineData;
  onStart: (item: Item) => void;
}) {
  const bases = useMemo(() => [...data.baseById.values()], [data]);
  const classes = useMemo(
    () => [...new Set(bases.map((b) => b.itemClass))].sort(),
    [bases],
  );
  const [itemClass, setItemClass] = useState("Amulet");
  const [baseId, setBaseId] = useState("");
  const [ilvl, setIlvl] = useState(82);

  const classBases = useMemo(
    () =>
      bases
        .filter((b) => b.itemClass === itemClass)
        .sort((a, b) => b.dropLevel - a.dropLevel),
    [bases, itemClass],
  );
  const chosen = classBases.find((b) => b.id === baseId) ?? classBases[0];
  const preview = useMemo(
    () => (chosen ? createItem(data, chosen.id, clampIlvl(ilvl), liveRng) : undefined),
    [data, chosen, ilvl],
  );

  return (
    <div className="base-picker-row">
      <section className="base-picker">
        <h3>Choose a base</h3>
        <label>
          Item class
          <select
            value={itemClass}
            onChange={(e) => {
              setItemClass(e.target.value);
              setBaseId("");
            }}
          >
            {classes.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Base
          <select value={chosen?.id ?? ""} onChange={(e) => setBaseId(e.target.value)}>
            {classBases.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} (drops ilvl {b.dropLevel})
              </option>
            ))}
          </select>
        </label>
        <label>
          Item level
          <input
            type="number"
            min={1}
            max={100}
            value={ilvl}
            onChange={(e) => setIlvl(Number(e.target.value))}
          />
        </label>
        <button
          type="button"
          className="primary"
          disabled={!preview}
          onClick={() => preview && onStart(preview)}
        >
          Start crafting
        </button>
      </section>
      {preview && (
        <div className="base-preview">
          <span className="base-preview-label">Preview</span>
          <ItemCard data={data} item={preview} />
        </div>
      )}
    </div>
  );
}
