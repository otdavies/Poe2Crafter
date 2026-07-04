/**
 * App state: loaded game data + crafted items living in game-shaped
 * containers (character inventory 12×5, stash items tab 12×12, equipment
 * doll). Interaction mimics the game: click an item to pick it up onto the
 * cursor, click a cell to put it down, click with a held currency to craft.
 * The engine stays pure — this store is the only place that mutates.
 */
import { create } from "zustand";
import type {
  BundleMeta,
  CurrencyItem,
  DistilledEmotion,
  Essence,
  Rune,
} from "../data/schema.ts";
import { actionFor, applyRune, type CraftEvent } from "../engine/actions.ts";
import { canSocketRune } from "../engine/runes.ts";
import { EngineData } from "../engine/data.ts";
import {
  commitDesecration,
  desecrationReveal,
  rerollReveal,
  type DesecrationReveal,
} from "../engine/desecrate.ts";
import {
  canEquip,
  canPlace,
  findSpot,
  INVENTORY_GRID,
  itemRect,
  overlaps,
  STASH_GRID,
  type EquipSlot,
  type GridSize,
  type Rect,
} from "../engine/grid.ts";
import type { Item } from "../engine/item.ts";
import { BONES, OMEN } from "../engine/mechanics.ts";
import { liveRng } from "../engine/rng.ts";
import { decodeSession, encodedFromHash } from "./share.ts";

export interface CraftStep {
  currencyId: string;
  /** Omens that were armed and consumed by this step. */
  omens: string[];
  events: CraftEvent[];
  /** Item state after this step (initial item lives in session.initial). */
  after: Item;
}

export interface Session {
  initial: Item;
  steps: CraftStep[];
}

export type Container = "inventory" | "stash";

export interface Placement {
  container: Container;
  x: number;
  y: number;
}

/** One crafted item and where it currently sits. */
export interface Craft {
  key: number;
  session: Session;
  /** Grid placement; unset while on the cursor or equipped. */
  place?: Placement;
  equipped?: EquipSlot;
}

export const GRIDS: Record<Container, GridSize> = {
  inventory: INVENTORY_GRID,
  stash: STASH_GRID,
};

interface AppState {
  status: "loading" | "ready" | "error";
  error?: string;
  meta?: BundleMeta;
  data?: EngineData;
  currency: CurrencyItem[];

  crafts: Craft[];
  nextKey: number;
  /** The craft whose card/odds/history the centre column shows. */
  activeKey?: number;
  /** Item "picked up on the cursor" (exclusive with selectedCurrency). */
  heldKey?: number;
  /** Where the held item came from, so Escape can put it back. */
  heldFrom?: { place?: Placement; equipped?: EquipSlot };
  /** Base picker overlay (also shown whenever nothing has been crafted). */
  pickerOpen: boolean;
  /** Currency id "held on the cursor", ready to apply to an item. */
  selectedCurrency?: string;
  /** Omens armed for the next currency use (game: activation slots). */
  armedOmens: string[];
  /**
   * Tutorial step-through of the ACTIVE craft: number of steps currently
   * shown (0 = initial item, steps.length = finished). undefined = live.
   */
  replayIndex?: number;
  /**
   * Desecration in progress: the Well of Souls offer awaiting the player's
   * pick. Crafting/undo are paused until a choice is made.
   */
  pendingReveal?: { key: number; currencyId: string; reveal: DesecrationReveal };

  init(): Promise<void>;
  /** Start a session on an already-built item (the picker's live preview). */
  startCraft(item: Item): void;
  openPicker(): void;
  closePicker(): void;
  selectCurrency(id: string | undefined): void;
  toggleOmen(id: string): void;
  /** Apply the held currency to a craft; runes may target a clicked socket. */
  applyTo(key: number, socketIndex?: number): void;
  /** Pick an item up onto the cursor (or set it active if one is held). */
  pickUp(key: number): void;
  /** Put the held item down at a grid cell (swaps with a blocking item). */
  putDown(container: Container, x: number, y: number): void;
  /** Equip the held item into a doll slot (swaps with the occupant). */
  equipHeld(slot: EquipSlot): void;
  /** Return the held item to where it was picked up (Escape). */
  returnHeld(): void;
  /** Destroy the held item outright. */
  discardHeld(): void;
  /** Ctrl+click: move an item inventory ⇄ stash to the first free spot. */
  quickMove(key: number): void;
  setActive(key: number): void;
  chooseReveal(choice: number): void;
  rerollPendingReveal(): void;
  undo(): void;
  reset(): void;
  enterReplay(): void;
  exitReplay(): void;
  setReplay(index: number): void;
}

const DATA_BASE = `${import.meta.env.BASE_URL}data/0.5`;

async function fetchJson<T>(file: string): Promise<T> {
  const res = await fetch(`${DATA_BASE}/${file}`);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export const currentItem = (session: Session): Item =>
  session.steps.length > 0 ? session.steps[session.steps.length - 1].after : session.initial;

/** Item state after the first `index` steps (0 = the initial item). */
export const itemAt = (session: Session, index: number): Item =>
  index <= 0 ? session.initial : session.steps[Math.min(index, session.steps.length) - 1].after;

export const craftByKey = (crafts: readonly Craft[], key: number | undefined): Craft | undefined =>
  key === undefined ? undefined : crafts.find((c) => c.key === key);

/** Occupied cells of a container, optionally ignoring one craft (the held/swapped one). */
export function takenRects(
  data: EngineData,
  crafts: readonly Craft[],
  container: Container,
  excludeKey?: number,
): Rect[] {
  return crafts
    .filter((c) => c.place?.container === container && c.key !== excludeKey)
    .map((c) => itemRect(data, currentItem(c.session), c.place!.x, c.place!.y));
}

/** First free spot for an item, trying the inventory before the stash. */
function autoPlace(data: EngineData, crafts: readonly Craft[], item: Item): Placement | undefined {
  for (const container of ["inventory", "stash"] as const) {
    const { w, h } = itemRect(data, item, 0, 0);
    const spot = findSpot(w, h, takenRects(data, crafts, container), GRIDS[container]);
    if (spot) return { container, ...spot };
  }
  return undefined;
}

const equippedMap = (crafts: readonly Craft[], excludeKey?: number): Map<EquipSlot, Item> =>
  new Map(
    crafts
      .filter((c) => c.equipped && c.key !== excludeKey)
      .map((c) => [c.equipped!, currentItem(c.session)]),
  );

export const useApp = create<AppState>((set, get) => ({
  status: "loading",
  currency: [],
  crafts: [],
  nextKey: 1,
  pickerOpen: false,
  armedOmens: [],

  async init() {
    try {
      const [meta, mods, bases, currency, essences, emotions, runes] = await Promise.all([
        fetchJson<BundleMeta>("meta.json"),
        fetchJson<never[]>("mods.json"),
        fetchJson<never[]>("bases.json"),
        fetchJson<CurrencyItem[]>("currency.json"),
        fetchJson<Essence[]>("essences.json"),
        fetchJson<DistilledEmotion[]>("emotions.json"),
        fetchJson<Rune[]>("runes.json"),
      ]);
      const data = new EngineData(mods, bases, essences, emotions, runes);
      // A share link opens straight into tutorial mode.
      const encoded = encodedFromHash(window.location.hash);
      const shared = encoded ? decodeSession(data, encoded) : undefined;
      set({ status: "ready", meta, currency, data });
      if (shared) {
        const place = autoPlace(data, [], currentItem(shared));
        set({
          crafts: [{ key: 1, session: shared, place }],
          nextKey: 2,
          activeKey: 1,
          replayIndex: 0,
        });
      }
    } catch (err) {
      set({ status: "error", error: err instanceof Error ? err.message : String(err) });
    }
  },

  startCraft(item) {
    const { data, crafts, nextKey } = get();
    if (!data) return;
    const place = autoPlace(data, crafts, item);
    const craft: Craft = { key: nextKey, session: { initial: item, steps: [] }, place };
    set({
      crafts: [...crafts, craft],
      nextKey: nextKey + 1,
      activeKey: craft.key,
      pickerOpen: false,
      // No room anywhere → the new item starts on the cursor.
      ...(place ? {} : { heldKey: craft.key, heldFrom: undefined, selectedCurrency: undefined }),
    });
  },

  openPicker: () => set({ pickerOpen: true }),
  closePicker: () => set({ pickerOpen: false }),

  selectCurrency(id) {
    if (get().heldKey !== undefined) get().returnHeld();
    set({ selectedCurrency: id });
  },

  toggleOmen(id) {
    const { armedOmens } = get();
    set({
      armedOmens: armedOmens.includes(id)
        ? armedOmens.filter((o) => o !== id)
        : [...armedOmens, id],
    });
  },

  applyTo(key, socketIndex) {
    const { data, crafts, selectedCurrency, armedOmens, replayIndex, pendingReveal } = get();
    const craft = craftByKey(crafts, key);
    if (!data || !craft || !selectedCurrency || replayIndex !== undefined) return;
    if (pendingReveal) return; // a Well of Souls choice is open
    const action = actionFor(data, selectedCurrency);
    if (!action) return;
    const item = currentItem(craft.session);
    const omens = new Set(armedOmens);
    // Runes may target the exact socket the player clicked.
    const rune = data.runeById.get(selectedCurrency);
    if (rune && socketIndex !== undefined) {
      if (canSocketRune(data, item, rune, socketIndex) !== null) return;
    } else if (action.canApply(data, item, omens) !== null) {
      return;
    }
    // Bones open the Well of Souls choice instead of resolving immediately
    // (Putrefaction skips the reveal — everything is replaced at once).
    if (action.kind === "desecrate" && !omens.has(OMEN.putrefaction)) {
      const reveal = desecrationReveal(data, item, liveRng, BONES.get(selectedCurrency)!, omens);
      set({
        activeKey: key,
        pendingReveal: { key, currencyId: selectedCurrency, reveal },
        armedOmens: armedOmens.filter((o) => !reveal.consumed.includes(o)),
      });
      return;
    }
    const result =
      rune && socketIndex !== undefined
        ? applyRune(data, item, rune, socketIndex)
        : action.apply(data, item, liveRng, omens);
    const consumed = result.consumedOmens ?? [];
    const step: CraftStep = {
      currencyId: selectedCurrency,
      omens: consumed,
      events: result.events,
      after: result.item,
    };
    set({
      activeKey: key,
      crafts: crafts.map((c) =>
        c.key === key ? { ...c, session: { ...c.session, steps: [...c.session.steps, step] } } : c,
      ),
      armedOmens: armedOmens.filter((o) => !consumed.includes(o)),
    });
  },

  pickUp(key) {
    const { crafts, heldKey, replayIndex } = get();
    const craft = craftByKey(crafts, key);
    if (!craft || replayIndex !== undefined) return;
    if (heldKey !== undefined) return; // put the held item down first
    set({
      heldKey: key,
      heldFrom: { place: craft.place, equipped: craft.equipped },
      activeKey: key,
      selectedCurrency: undefined,
      crafts: crafts.map((c) =>
        c.key === key ? { ...c, place: undefined, equipped: undefined } : c,
      ),
    });
  },

  putDown(container, x, y) {
    const { data, crafts, heldKey } = get();
    const held = craftByKey(crafts, heldKey);
    if (!data || !held) return;
    const item = currentItem(held.session);
    const rect = itemRect(data, item, x, y);
    const grid = GRIDS[container];
    if (canPlace(rect, takenRects(data, crafts, container), grid)) {
      set({
        heldKey: undefined,
        heldFrom: undefined,
        crafts: crafts.map((c) =>
          c.key === held.key ? { ...c, place: { container, x, y }, equipped: undefined } : c,
        ),
      });
      return;
    }
    // Blocked: if exactly one item is in the way and removing it frees the
    // spot, swap — the blocker moves onto the cursor (game behaviour).
    const inWay = crafts.filter(
      (c) =>
        c.key !== held.key &&
        c.place?.container === container &&
        overlaps(rect, itemRect(data, currentItem(c.session), c.place.x, c.place.y)),
    );
    if (inWay.length !== 1) return;
    const blocker = inWay[0];
    if (!canPlace(rect, takenRects(data, crafts, container, blocker.key), grid)) return;
    set({
      heldKey: blocker.key,
      heldFrom: { place: blocker.place },
      activeKey: blocker.key,
      crafts: crafts.map((c) =>
        c.key === held.key
          ? { ...c, place: { container, x, y }, equipped: undefined }
          : c.key === blocker.key
            ? { ...c, place: undefined, equipped: undefined }
            : c,
      ),
    });
  },

  equipHeld(slot) {
    const { data, crafts, heldKey } = get();
    const held = craftByKey(crafts, heldKey);
    if (!data || !held) return;
    const item = currentItem(held.session);
    if (canEquip(data, item, slot, equippedMap(crafts, held.key)) !== null) return;
    const occupant = crafts.find((c) => c.key !== held.key && c.equipped === slot);
    set({
      heldKey: occupant?.key,
      heldFrom: occupant ? { equipped: slot } : undefined,
      ...(occupant ? { activeKey: occupant.key } : {}),
      crafts: crafts.map((c) =>
        c.key === held.key
          ? { ...c, place: undefined, equipped: slot }
          : c.key === occupant?.key
            ? { ...c, place: undefined, equipped: undefined }
            : c,
      ),
    });
  },

  returnHeld() {
    const { data, crafts, heldKey, heldFrom } = get();
    const held = craftByKey(crafts, heldKey);
    if (!data || !held) return;
    const item = currentItem(held.session);
    // Original spot if still free, else first free spot anywhere.
    let place: Placement | undefined;
    let equipped: EquipSlot | undefined;
    if (heldFrom?.equipped && canEquip(data, item, heldFrom.equipped, equippedMap(crafts, held.key)) === null) {
      equipped = heldFrom.equipped;
    } else if (heldFrom?.place) {
      const rect = itemRect(data, item, heldFrom.place.x, heldFrom.place.y);
      const container = heldFrom.place.container;
      if (canPlace(rect, takenRects(data, crafts, container, held.key), GRIDS[container])) {
        place = heldFrom.place;
      }
    }
    if (!place && !equipped) place = autoPlace(data, crafts, item);
    if (!place && !equipped) return; // nowhere to go — stays on the cursor
    set({
      heldKey: undefined,
      heldFrom: undefined,
      crafts: crafts.map((c) => (c.key === held.key ? { ...c, place, equipped } : c)),
    });
  },

  discardHeld() {
    const { crafts, heldKey, activeKey } = get();
    if (heldKey === undefined) return;
    const remaining = crafts.filter((c) => c.key !== heldKey);
    set({
      crafts: remaining,
      heldKey: undefined,
      heldFrom: undefined,
      activeKey: activeKey === heldKey ? remaining[remaining.length - 1]?.key : activeKey,
    });
  },

  quickMove(key) {
    const { data, crafts, heldKey, replayIndex } = get();
    const craft = craftByKey(crafts, key);
    if (!data || !craft || heldKey !== undefined || replayIndex !== undefined) return;
    const item = currentItem(craft.session);
    const target: Container = craft.place?.container === "inventory" ? "stash" : "inventory";
    const { w, h } = itemRect(data, item, 0, 0);
    const spot = findSpot(w, h, takenRects(data, crafts, target, key), GRIDS[target]);
    if (!spot) return;
    set({
      activeKey: key,
      crafts: crafts.map((c) =>
        c.key === key ? { ...c, place: { container: target, ...spot }, equipped: undefined } : c,
      ),
    });
  },

  setActive(key) {
    if (craftByKey(get().crafts, key)) set({ activeKey: key });
  },

  chooseReveal(choice) {
    const { data, crafts, pendingReveal } = get();
    const craft = craftByKey(crafts, pendingReveal?.key);
    if (!data || !craft || !pendingReveal) return;
    if (choice < 0 || choice >= pendingReveal.reveal.options.length) return;
    const item = currentItem(craft.session);
    const result = commitDesecration(data, item, pendingReveal.reveal, choice, liveRng);
    const step: CraftStep = {
      currencyId: pendingReveal.currencyId,
      omens: result.consumedOmens,
      events: result.events,
      after: result.item,
    };
    set({
      crafts: crafts.map((c) =>
        c.key === craft.key
          ? { ...c, session: { ...c.session, steps: [...c.session.steps, step] } }
          : c,
      ),
      pendingReveal: undefined,
    });
  },

  rerollPendingReveal() {
    const { data, crafts, pendingReveal, armedOmens } = get();
    const craft = craftByKey(crafts, pendingReveal?.key);
    if (!data || !craft || !pendingReveal) return;
    if (!armedOmens.includes(OMEN.abyssalEchoes)) return;
    const reveal = rerollReveal(
      data,
      currentItem(craft.session),
      liveRng,
      BONES.get(pendingReveal.currencyId)!,
      new Set(armedOmens),
      pendingReveal.reveal,
    );
    set({
      pendingReveal: { ...pendingReveal, reveal },
      armedOmens: armedOmens.filter((o) => o !== OMEN.abyssalEchoes),
    });
  },

  undo() {
    const { crafts, activeKey, replayIndex, pendingReveal } = get();
    const craft = craftByKey(crafts, activeKey);
    if (!craft || craft.session.steps.length === 0 || replayIndex !== undefined) return;
    if (pendingReveal) return;
    set({
      crafts: crafts.map((c) =>
        c.key === craft.key
          ? { ...c, session: { ...c.session, steps: c.session.steps.slice(0, -1) } }
          : c,
      ),
    });
  },

  reset() {
    set({
      crafts: [],
      activeKey: undefined,
      heldKey: undefined,
      heldFrom: undefined,
      pickerOpen: false,
      selectedCurrency: undefined,
      armedOmens: [],
      replayIndex: undefined,
      pendingReveal: undefined,
    });
    // drop any share-link hash so a reload doesn't resurrect the session
    if (window.location.hash) history.replaceState(null, "", window.location.pathname);
  },

  enterReplay() {
    const craft = craftByKey(get().crafts, get().activeKey);
    if (!craft || craft.session.steps.length === 0) return;
    if (get().heldKey !== undefined) get().returnHeld();
    set({ replayIndex: 0, selectedCurrency: undefined });
  },

  exitReplay() {
    set({ replayIndex: undefined });
  },

  setReplay(index) {
    const { crafts, activeKey, replayIndex } = get();
    const craft = craftByKey(crafts, activeKey);
    if (!craft || replayIndex === undefined) return;
    set({ replayIndex: Math.max(0, Math.min(index, craft.session.steps.length)) });
  },
}));
