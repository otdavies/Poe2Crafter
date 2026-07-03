/** Human-readable one-liners for craft events, for the step log. */
import type { CraftEvent } from "../engine/actions.ts";
import type { EngineData } from "../engine/data.ts";
import type { RolledMod } from "../engine/item.ts";
import { renderModText } from "./modtext.ts";

function modLine(data: EngineData, rolled: RolledMod): string {
  const mod = data.mod(rolled.modId);
  const text = renderModText(mod.text, rolled.values);
  return mod.name ? `${mod.name} — ${text}` : text;
}

export function describeEvent(data: EngineData, event: CraftEvent): string {
  switch (event.kind) {
    case "rarity":
      return `Became ${event.to}`;
    case "added":
      return `+ ${modLine(data, event.mod)}`;
    case "removed":
      return `− ${modLine(data, event.mod)}`;
    case "implicit_added":
      return `+ implicit: ${modLine(data, event.mod)}`;
    case "values_rerolled":
      return "Rerolled modifier values";
    case "corrupted":
      return "Corrupted";
    case "no_change":
      return "No change";
  }
}
