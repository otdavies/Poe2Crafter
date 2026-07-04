/**
 * The visual for objects sitting in container grids and doll slots: item
 * tiles (base art from poe2wiki over a rarity-framed name-plate fallback)
 * with their rune sockets overlaid like the game, and 1×1 currency stacks
 * with a count badge.
 */
import { useState } from "react";
import type { EngineData } from "../engine/data.ts";
import type { Item } from "../engine/item.ts";
import { tileProps } from "./tile.ts";

export function ItemTile({
  data,
  item,
  runeIcons,
  onSocketClick,
}: {
  data: EngineData;
  item: Item;
  runeIcons?: ReadonlyMap<string, string>;
  /** Present while a rune is armed — socket dots become click targets. */
  onSocketClick?: (index: number) => void;
}) {
  const { label, art, classes } = tileProps(item, data);
  const [artLoaded, setArtLoaded] = useState(false);
  const [artFailed, setArtFailed] = useState(false);
  return (
    <span className={classes.join(" ") + (artLoaded ? " tile-has-art" : "")}>
      {!artFailed && (
        <img
          className="tile-art"
          src={art}
          alt=""
          loading="lazy"
          draggable={false}
          onLoad={() => setArtLoaded(true)}
          onError={() => setArtFailed(true)}
        />
      )}
      {!artLoaded && <span className="tile-name">{label}</span>}
      {item.sockets && item.sockets.length > 0 && (
        <span className="tile-sockets">
          {item.sockets.map((runeId, i) => {
            const icon = runeId ? runeIcons?.get(runeId) : undefined;
            return (
              <button
                key={i}
                type="button"
                className={`tile-socket ${onSocketClick ? "tile-socket-clickable" : ""}`}
                disabled={!onSocketClick}
                title={runeId ?? "Empty Rune Socket"}
                onClick={(e) => {
                  e.stopPropagation();
                  onSocketClick?.(i);
                }}
              >
                {icon && <img src={icon} alt="" draggable={false} />}
              </button>
            );
          })}
        </span>
      )}
    </span>
  );
}

export function StackTile({
  name,
  icon,
  count,
}: {
  name: string;
  icon: string;
  count: number;
}) {
  return (
    <span className="grid-item stack-tile" title={`${name} ×${count}`}>
      <img className="stack-icon" src={icon} alt={name} loading="lazy" draggable={false} />
      <span className="stack-count">{count}</span>
    </span>
  );
}
