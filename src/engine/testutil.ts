/** Test helper: load the real committed data bundle into an EngineData. */
import { readFileSync } from "node:fs";
import type { BaseItem, Mod } from "../data/schema.ts";
import { EngineData } from "./data.ts";

let cached: EngineData | undefined;

export function loadEngineData(): EngineData {
  if (!cached) {
    const read = <T>(file: string): T =>
      JSON.parse(readFileSync(`public/data/0.5/${file}`, "utf8")) as T;
    cached = new EngineData(read<Mod[]>("mods.json"), read<BaseItem[]>("bases.json"));
  }
  return cached;
}

export function findBase(data: EngineData, itemClass: string): string {
  for (const [id, base] of data.baseById) {
    if (base.itemClass === itemClass) return id;
  }
  throw new Error(`no base with class ${itemClass}`);
}
