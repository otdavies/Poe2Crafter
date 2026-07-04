/**
 * A game container grid — the character backpack (12×5) or a stash tab
 * (12×12). Items are tiles spanning their datamined w×h cells. Interaction
 * mimics the game: click picks an item up onto the cursor, a ghost shows
 * where it would land (centred under the cursor, red when blocked), click
 * again puts it down or swaps with a single blocking item, ctrl+click
 * quick-moves between containers, and clicking with a held currency crafts.
 */
import { useState, type MouseEvent } from "react";
import { canPlace, itemRect } from "../engine/grid.ts";
import {
  craftByKey,
  currentItem,
  GRIDS,
  takenRects,
  useApp,
  type Container,
} from "../state/store.ts";
import { tileProps } from "./tile.ts";

export function ItemGrid({
  container,
  onHoverCraft,
}: {
  container: Container;
  /** The centre column previews the hovered craft's card. */
  onHoverCraft?: (key: number | undefined) => void;
}) {
  const data = useApp((s) => s.data)!;
  const crafts = useApp((s) => s.crafts);
  const heldKey = useApp((s) => s.heldKey);
  const activeKey = useApp((s) => s.activeKey);
  const selectedCurrency = useApp((s) => s.selectedCurrency);
  const replaying = useApp((s) => s.replayIndex !== undefined);
  const grid = GRIDS[container];
  const [hoverCell, setHoverCell] = useState<{ x: number; y: number } | undefined>();

  const held = craftByKey(crafts, heldKey);
  const heldItem = held ? currentItem(held.session) : undefined;
  const placed = crafts.filter((c) => c.place?.container === container);

  /** Grid cell under the cursor. */
  const cellAt = (e: MouseEvent<HTMLElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = Math.floor(((e.clientX - box.left) / box.width) * grid.cols);
    const y = Math.floor(((e.clientY - box.top) / box.height) * grid.rows);
    if (x < 0 || y < 0 || x >= grid.cols || y >= grid.rows) return undefined;
    return { x, y };
  };

  /** Held items drop centred under the cursor, clamped into the grid. */
  const snapped = (cell: { x: number; y: number }) => {
    if (!data || !heldItem) return cell;
    const { w, h } = itemRect(data, heldItem, 0, 0);
    return {
      x: Math.max(0, Math.min(cell.x - Math.floor((w - 1) / 2), grid.cols - w)),
      y: Math.max(0, Math.min(cell.y - Math.floor((h - 1) / 2), grid.rows - h)),
    };
  };

  const ghost = (() => {
    if (!heldItem || !hoverCell) return undefined;
    const at = snapped(hoverCell);
    const rect = itemRect(data, heldItem, at.x, at.y);
    const free = canPlace(rect, takenRects(data, crafts, container, heldKey), grid);
    // A single blocker still works — the game swaps it onto the cursor.
    const blockers = placed.filter((c) => {
      const r = itemRect(data, currentItem(c.session), c.place!.x, c.place!.y);
      return rect.x < r.x + r.w && r.x < rect.x + rect.w && rect.y < r.y + r.h && r.y < rect.y + rect.h;
    });
    const valid =
      free ||
      (blockers.length === 1 &&
        canPlace(rect, takenRects(data, crafts, container, blockers[0].key), grid));
    return { rect, valid };
  })();

  const clickCell = (e: MouseEvent<HTMLElement>) => {
    if (replaying || heldKey === undefined) return;
    const cell = cellAt(e);
    if (!cell) return;
    const at = snapped(cell);
    useApp.getState().putDown(container, at.x, at.y);
  };

  const clickItem = (e: MouseEvent, key: number) => {
    e.stopPropagation();
    if (replaying) {
      useApp.getState().setActive(key);
      return;
    }
    if (e.ctrlKey || e.metaKey) useApp.getState().quickMove(key);
    else if (selectedCurrency) useApp.getState().applyTo(key);
    else useApp.getState().pickUp(key);
  };

  return (
    <div
      className={`item-grid ${heldKey !== undefined ? "grid-holding" : ""}`}
      style={{
        gridTemplateColumns: `repeat(${grid.cols}, var(--cell))`,
        gridTemplateRows: `repeat(${grid.rows}, var(--cell))`,
      }}
      onClick={clickCell}
      onMouseMove={(e) => setHoverCell(cellAt(e))}
      onMouseLeave={() => setHoverCell(undefined)}
    >
      {placed.map((c) => {
        const item = currentItem(c.session);
        const rect = itemRect(data, item, c.place!.x, c.place!.y);
        const { label, classes } = tileProps(item, data);
        if (c.key === activeKey) classes.push("tile-active");
        return (
          <button
            key={c.key}
            type="button"
            className={classes.join(" ")}
            style={{
              gridColumn: `${rect.x + 1} / span ${rect.w}`,
              gridRow: `${rect.y + 1} / span ${rect.h}`,
            }}
            onClick={(e) => clickItem(e, c.key)}
            onMouseEnter={() => onHoverCraft?.(c.key)}
            onMouseLeave={() => onHoverCraft?.(undefined)}
          >
            <span className="tile-name">{label}</span>
          </button>
        );
      })}
      {ghost && (
        <span
          className={`grid-ghost ${ghost.valid ? "ghost-valid" : "ghost-invalid"}`}
          style={{
            gridColumn: `${ghost.rect.x + 1} / span ${ghost.rect.w}`,
            gridRow: `${ghost.rect.y + 1} / span ${ghost.rect.h}`,
          }}
        />
      )}
    </div>
  );
}
