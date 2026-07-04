/**
 * Grid-tile presentation for a crafted item: label + rarity/corruption
 * classes. PoE2's CDN only serves signed image URLs, so tiles render a
 * rarity-framed name instead of the item art (layout mimicry, not pixels).
 */
import type { EngineData } from "../engine/data.ts";
import type { Item } from "../engine/item.ts";
import { itemHeader } from "./itemname.ts";

export function tileProps(
  item: Item,
  data: EngineData,
): { label: string; classes: string[] } {
  const header = itemHeader(data, item);
  const classes = ["grid-item", `rarity-${item.rarity}`];
  if (item.corrupted) classes.push("tile-corrupted");
  return { label: header.name, classes };
}
