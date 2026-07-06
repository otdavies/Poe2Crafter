/** Human-readable one-liners for craft events, for the step log. */
import type { CraftEvent } from "../engine/actions.ts";
import type { EngineData } from "../engine/data.ts";
import type { RolledMod } from "../engine/item.ts";
import { renderModText } from "./modtext.ts";

function modLine(data: EngineData, rolled: RolledMod): string {
  const mod = data.mod(rolled.modId);
  const text = renderModText(mod.text, rolled.values, mod.stats);
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
    case "values_pushed":
      return "Modifier values pushed beyond their limits";
    case "sanctified":
      return "Sanctified — values locked in forever";
    case "fractured":
      return `Fractured: ${modLine(data, event.mod)}`;
    case "quality":
      return event.quality.percent > 0
        ? `Catalyst quality: ${event.quality.percent}%`
        : "Catalyst quality consumed";
    case "corrupted":
      return "Corrupted";
    case "no_change":
      return "No change";
    case "socket_added":
      return "+ Rune Socket";
    case "socketed": {
      const name = data.rune(event.runeId).name;
      return event.replaced
        ? `Socket ${event.index + 1}: ${name} (destroyed ${data.rune(event.replaced).name})`
        : `Socket ${event.index + 1}: ${name}`;
    }
    case "rune_upgraded":
      return `Socket ${event.index + 1}: ${data.rune(event.from).name} → ${data.rune(event.to).name}`;
  }
}
