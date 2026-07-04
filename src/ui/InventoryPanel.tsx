/**
 * The character inventory screen, laid out like the game's: equipment doll
 * on top (main hand top-left, off-hand top-right, helmet/body/belt down the
 * centre, amulet beside the helmet, rings beside the body, gloves and boots
 * at the sides), the flask + charm strip under it, and the 12×5 backpack
 * grid at the bottom. Slots accept the same classes as the game
 * (two-handers lock the off-hand, bow + quiver excepted).
 */
import { canEquip, type EquipSlot } from "../engine/grid.ts";
import { craftByKey, currentItem, useApp } from "../state/store.ts";
import { ItemGrid } from "./ItemGrid.tsx";
import { tileProps } from "./tile.ts";

/** Doll slot positions in cell units (12-column grid like the backpack). */
const DOLL_SLOTS: {
  slot: EquipSlot;
  label: string;
  col: number;
  row: number;
  w: number;
  h: number;
}[] = [
  { slot: "weapon", label: "Main Hand", col: 1, row: 1, w: 2, h: 4 },
  { slot: "helmet", label: "Helmet", col: 6, row: 1, w: 2, h: 2 },
  { slot: "amulet", label: "Amulet", col: 8, row: 2, w: 1, h: 1 },
  { slot: "offhand", label: "Off Hand", col: 11, row: 1, w: 2, h: 4 },
  { slot: "ringL", label: "Ring", col: 5, row: 3, w: 1, h: 1 },
  { slot: "body", label: "Body", col: 6, row: 3, w: 2, h: 3 },
  { slot: "ringR", label: "Ring", col: 8, row: 3, w: 1, h: 1 },
  { slot: "gloves", label: "Gloves", col: 3, row: 4, w: 2, h: 2 },
  { slot: "boots", label: "Boots", col: 9, row: 4, w: 2, h: 2 },
  { slot: "belt", label: "Belt", col: 6, row: 6, w: 2, h: 1 },
];

export function InventoryPanel({
  onHoverCraft,
}: {
  onHoverCraft?: (key: number | undefined) => void;
}) {
  const data = useApp((s) => s.data)!;
  const crafts = useApp((s) => s.crafts);
  const heldKey = useApp((s) => s.heldKey);
  const activeKey = useApp((s) => s.activeKey);
  const selectedCurrency = useApp((s) => s.selectedCurrency);
  const replaying = useApp((s) => s.replayIndex !== undefined);

  const held = craftByKey(crafts, heldKey);
  const heldItem = held ? currentItem(held.session) : undefined;
  const others = new Map(
    crafts
      .filter((c) => c.equipped && c.key !== heldKey)
      .map((c) => [c.equipped!, currentItem(c.session)] as const),
  );

  return (
    <section className="inventory-panel">
      <h3 className="panel-title">Inventory</h3>

      <div className="doll">
        {DOLL_SLOTS.map(({ slot, label, col, row, w, h }) => {
          const occupant = crafts.find((c) => c.equipped === slot);
          const item = occupant ? currentItem(occupant.session) : undefined;
          const accepts =
            heldItem && !replaying ? canEquip(data, heldItem, slot, others) === null : false;
          const classes = ["equip-slot"];
          if (accepts) classes.push("slot-accepts");
          if (occupant && occupant.key === activeKey) classes.push("tile-active");
          return (
            <button
              key={slot}
              type="button"
              className={classes.join(" ")}
              style={{ gridColumn: `${col} / span ${w}`, gridRow: `${row} / span ${h}` }}
              onClick={() => {
                if (replaying) return;
                if (heldItem) {
                  if (accepts) useApp.getState().equipHeld(slot);
                } else if (occupant) {
                  if (selectedCurrency) useApp.getState().applyTo(occupant.key);
                  else useApp.getState().pickUp(occupant.key);
                }
              }}
              onMouseEnter={() => occupant && onHoverCraft?.(occupant.key)}
              onMouseLeave={() => occupant && onHoverCraft?.(undefined)}
            >
              {item ? (
                <span className={tileProps(item, data).classes.join(" ")}>
                  <span className="tile-name">{tileProps(item, data).label}</span>
                </span>
              ) : (
                <span className="slot-label">{label}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Flasks and charms exist on the game screen; we don't craft them. */}
      <div className="flask-row">
        <span className="gear-slot flask-slot" title="Life Flask — not simulated">
          <span className="slot-label">Life</span>
        </span>
        {[0, 1, 2].map((i) => (
          <span key={i} className="gear-slot charm-slot" title="Charm — not simulated">
            <span className="slot-label">Charm</span>
          </span>
        ))}
        <span className="gear-slot flask-slot" title="Mana Flask — not simulated">
          <span className="slot-label">Mana</span>
        </span>
      </div>

      <ItemGrid container="inventory" onHoverCraft={onHoverCraft} />

      <div className="inventory-footer">
        <button type="button" className="primary" onClick={() => useApp.getState().openPicker()}>
          New base
        </button>
        {heldKey !== undefined && (
          <button
            type="button"
            className="trash"
            title="Destroy the held item"
            onClick={() => useApp.getState().discardHeld()}
          >
            Destroy item
          </button>
        )}
      </div>
    </section>
  );
}
