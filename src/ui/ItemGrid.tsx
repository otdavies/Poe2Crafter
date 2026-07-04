/**
 * A game container grid — the character backpack (12×5), a stash tab
 * (12×12), or the currency tab's central crafting slot / wildcard slots.
 * Items and currency stacks are tiles spanning their real cells.
 * Interaction mimics the game: left-click picks things up onto the cursor
 * (a snap ghost shows where they'd land, red when blocked), click again
 * puts them down — swapping with a single blocker or merging same-currency
 * stacks — ctrl+click quick-moves between containers, right-click a stack
 * readies its currency for use, and clicking an item with a currency armed
 * crafts it.
 */
import { useState, type MouseEvent } from "react";
import { canPlace } from "../engine/grid.ts";
import {
  GRIDS,
  isCraft,
  currentItem,
  objectByKey,
  objectRect,
  takenRects,
  useApp,
  type Container,
} from "../state/store.ts";
import { ItemTile, StackTile } from "./Tile.tsx";

export function ItemGrid({
  container,
  runeIcons,
  onHoverObject,
}: {
  container: Container;
  runeIcons?: ReadonlyMap<string, string>;
  /** The hovered object drives the floating tooltip — the item card for
   * crafts, the currency effect card for stacks. */
  onHoverObject?: (key: number | undefined, at?: { x: number; y: number }) => void;
}) {
  const data = useApp((s) => s.data)!;
  const currency = useApp((s) => s.currency);
  const objects = useApp((s) => s.objects);
  const heldKey = useApp((s) => s.heldKey);
  const activeKey = useApp((s) => s.activeKey);
  const selectedCurrency = useApp((s) => s.selectedCurrency);
  const selectedStack = useApp((s) => s.selectedStack);
  const replaying = useApp((s) => s.replayIndex !== undefined);
  const grid = GRIDS[container];
  const [hoverCell, setHoverCell] = useState<{ x: number; y: number } | undefined>();

  const held = objectByKey(objects, heldKey);
  const placed = objects.filter((o) => o.place?.container === container);
  const armedRune = selectedCurrency ? data.runeById.get(selectedCurrency) : undefined;

  /** Grid cell under the cursor. */
  const cellAt = (e: MouseEvent<HTMLElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = Math.floor(((e.clientX - box.left) / box.width) * grid.cols);
    const y = Math.floor(((e.clientY - box.top) / box.height) * grid.rows);
    if (x < 0 || y < 0 || x >= grid.cols || y >= grid.rows) return undefined;
    return { x, y };
  };

  /** Held objects drop centred under the cursor, clamped into the grid. */
  const snapped = (cell: { x: number; y: number }) => {
    if (!held) return cell;
    const { w, h } = objectRect(data, held, 0, 0);
    return {
      x: Math.max(0, Math.min(cell.x - Math.floor((w - 1) / 2), grid.cols - w)),
      y: Math.max(0, Math.min(cell.y - Math.floor((h - 1) / 2), grid.rows - h)),
    };
  };

  const ghost = (() => {
    if (!held || !hoverCell) return undefined;
    const at = container === "curtab" ? { x: 0, y: 0 } : snapped(hoverCell);
    const rect = objectRect(data, held, at.x, at.y);
    const free = canPlace(rect, takenRects(data, objects, container, held.key), grid);
    const blockers = placed.filter((o) => {
      const r = objectRect(data, o, o.place!.x, o.place!.y);
      return rect.x < r.x + r.w && r.x < rect.x + rect.w && rect.y < r.y + r.h && r.y < rect.y + rect.h;
    });
    const mergeable =
      blockers.length === 1 &&
      !isCraft(held) &&
      !isCraft(blockers[0]) &&
      held.currencyId === blockers[0].currencyId;
    const valid =
      (container === "curtab" ? isCraft(held) : container === "curwild" ? !isCraft(held) : true) &&
      (free ||
        mergeable ||
        (blockers.length === 1 &&
          canPlace(rect, takenRects(data, objects, container, blockers[0].key), grid)));
    return { rect, valid };
  })();

  const clickCell = (e: MouseEvent<HTMLElement>) => {
    if (replaying || heldKey === undefined) return;
    const cell = cellAt(e);
    if (!cell) return;
    const at = snapped(cell);
    useApp.getState().putDown(container, at.x, at.y);
  };

  const clickObject = (e: MouseEvent, key: number) => {
    e.stopPropagation();
    if (replaying) {
      useApp.getState().setActive(key);
      return;
    }
    const obj = objectByKey(objects, key);
    if (!obj) return;
    if (e.ctrlKey || e.metaKey) useApp.getState().quickMove(key);
    else if (selectedCurrency && isCraft(obj)) useApp.getState().applyTo(key);
    else useApp.getState().pickUp(key);
  };

  /** Right-click a stack readies its currency, consuming from the stack. */
  const armStack = (e: MouseEvent, key: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (replaying) return;
    const obj = objectByKey(objects, key);
    if (!obj || isCraft(obj)) return;
    const s = useApp.getState();
    if (s.selectedStack === key) s.selectCurrency(undefined);
    else s.selectCurrency(obj.currencyId, key);
  };

  return (
    <div
      className={`item-grid grid-${container} ${heldKey !== undefined ? "grid-holding" : ""}`}
      style={{
        gridTemplateColumns: `repeat(${grid.cols}, var(--cell))`,
        gridTemplateRows: `repeat(${grid.rows}, var(--cell))`,
      }}
      onClick={clickCell}
      onMouseMove={(e) => setHoverCell(cellAt(e))}
      onMouseLeave={() => setHoverCell(undefined)}
    >
      {placed.map((o) => {
        const rect = objectRect(data, o, o.place!.x, o.place!.y);
        const style = {
          gridColumn: `${rect.x + 1} / span ${rect.w}`,
          gridRow: `${rect.y + 1} / span ${rect.h}`,
        };
        if (!isCraft(o)) {
          const info = currency.find((c) => c.id === o.currencyId);
          const armed = selectedStack === o.key;
          return (
            <button
              key={o.key}
              type="button"
              className={`grid-object ${armed ? "stack-armed" : ""}`}
              style={style}
              onClick={(e) => clickObject(e, o.key)}
              onContextMenu={(e) => armStack(e, o.key)}
              onMouseEnter={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                onHoverObject?.(o.key, { x: r.right, y: r.top });
              }}
              onMouseLeave={() => onHoverObject?.(undefined)}
            >
              <StackTile
                name={info?.name ?? o.currencyId}
                icon={info?.icon ?? ""}
                count={o.count}
              />
            </button>
          );
        }
        const item = currentItem(o.session);
        return (
          <button
            key={o.key}
            type="button"
            className={`grid-object ${o.key === activeKey ? "tile-active" : ""}`}
            style={style}
            onClick={(e) => clickObject(e, o.key)}
            onMouseEnter={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              onHoverObject?.(o.key, { x: r.right, y: r.top });
            }}
            onMouseLeave={() => onHoverObject?.(undefined)}
          >
            <ItemTile
              data={data}
              item={item}
              runeIcons={runeIcons}
              onSocketClick={
                armedRune && !replaying ? (i) => useApp.getState().applyTo(o.key, i) : undefined
              }
            />
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
