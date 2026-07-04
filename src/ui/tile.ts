/**
 * Grid-tile presentation for a crafted item: label + rarity/corruption
 * classes, plus the wiki icon URL for the base art. poe2wiki hosts every
 * base's inventory icon as "<Name> inventory icon.png" (108×108 per cell,
 * e.g. body armours 212×316); Special:FilePath redirects to the file, so
 * no signed CDN URL is needed. Tiles fall back to the rarity-framed name
 * plate when the image can't load.
 */
import type { EngineData } from "../engine/data.ts";
import type { Item } from "../engine/item.ts";
import { itemHeader } from "./itemname.ts";

export function wikiIcon(baseName: string): string {
  return `https://www.poe2wiki.net/wiki/Special:FilePath/${encodeURIComponent(
    `${baseName} inventory icon.png`,
  )}`;
}

export function tileProps(
  item: Item,
  data: EngineData,
): { label: string; art: string; classes: string[] } {
  const header = itemHeader(data, item);
  const classes = ["grid-item", `rarity-${item.rarity}`];
  if (item.corrupted) classes.push("tile-corrupted");
  return { label: header.name, art: wikiIcon(data.base(item.baseId).name), classes };
}
