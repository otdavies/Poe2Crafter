/** Choose an item class, base, and item level to start a craft. */
import { useMemo, useState } from "react";
import type { EngineData } from "../engine/data.ts";

export function BasePicker({ data, onStart }: {
  data: EngineData;
  onStart: (baseId: string, ilvl: number) => void;
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

  return (
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
        disabled={!chosen}
        onClick={() => chosen && onStart(chosen.id, ilvl)}
      >
        Start crafting
      </button>
    </section>
  );
}
