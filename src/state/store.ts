/**
 * App state: loaded game data + everything that lives in the game-shaped
 * containers — crafted items AND currency stacks (currencies are ordinary
 * 1×1 stackable items in the game). Containers: character inventory 12×5,
 * stash items tab 12×12, the currency tab's central crafting slot and its
 * 14 wildcard slots, and the equipment doll. Interaction mimics the game:
 * left-click picks things up onto the cursor, click a cell puts them down
 * (stacks merge onto same-currency stacks), right-click a currency to use
 * it, then click the item to craft. The engine stays pure — this store is
 * the only place that mutates.
 */
import { create } from "zustand";
import type {
  BundleMeta,
  CurrencyItem,
  DistilledEmotion,
  Essence,
  Rune,
} from "../data/schema.ts";
import { actionFor, applyMasterwork, applyRune, type CraftEvent } from "../engine/actions.ts";
import { canMasterwork, canSocketRune } from "../engine/runes.ts";
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

/**
 * "curtab" is the currency tab's central crafting slot (one item of any
 * size); "curwild" its 14 wildcard slots (stackables only, 7×2).
 */
export type Container = "inventory" | "stash" | "curtab" | "curwild";

export interface Placement {
  container: Container;
  x: number;
  y: number;
}

interface Placed {
  key: number;
  /** Grid placement; unset while on the cursor or equipped. */
  place?: Placement;
  equipped?: EquipSlot;
}

/** One crafted item and where it currently sits. */
export interface Craft extends Placed {
  session: Session;
}

/** A stack of currency — an ordinary 1×1 stackable item, like the game. */
export interface Stack extends Placed {
  currencyId: string;
  count: number;
}

export type StashObject = Craft | Stack;

export const isCraft = (o: StashObject): o is Craft => "session" in o;

export const GRIDS: Record<Container, GridSize> = {
  inventory: INVENTORY_GRID,
  stash: STASH_GRID,
  curtab: { cols: 2, rows: 4 },
  curwild: { cols: 7, rows: 2 },
};

interface AppState {
  status: "loading" | "ready" | "error";
  error?: string;
  meta?: BundleMeta;
  data?: EngineData;
  currency: CurrencyItem[];

  objects: StashObject[];
  nextKey: number;
  /** The craft whose odds/history the centre column shows. */
  activeKey?: number;
  /** Object "picked up on the cursor" (exclusive with selectedCurrency). */
  heldKey?: number;
  /** Where the held object came from, so Escape can put it back. */
  heldFrom?: { place?: Placement; equipped?: EquipSlot };
  /** Base picker overlay (also shown whenever nothing has been crafted). */
  pickerOpen: boolean;
  /** Currency id armed for use on the next item click (game: right-click). */
  selectedCurrency?: string;
  /** When the armed currency came from a placed stack, uses consume it. */
  selectedStack?: number;
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
  /** Arm a currency for use; stackKey marks the stack it's drawn from. */
  selectCurrency(id: string | undefined, stackKey?: number): void;
  /** Take a fresh stack of a currency from the stash onto the cursor. */
  takeStack(currencyId: string): void;
  toggleOmen(id: string): void;
  /** Apply the armed currency to a craft; runes may target a clicked socket. */
  applyTo(key: number, socketIndex?: number): void;
  /** Pick an object up onto the cursor. */
  pickUp(key: number): void;
  /** Put the held object down at a grid cell (swap or merge with blockers). */
  putDown(container: Container, x: number, y: number): void;
  /** Equip the held item into a doll slot (swaps with the occupant). */
  equipHeld(slot: EquipSlot): void;
  /** Return the held object to where it was picked up (Escape). */
  returnHeld(): void;
  /** Destroy the held object outright. */
  discardHeld(): void;
  /** Ctrl+click: move an object inventory ⇄ stash to the first free spot. */
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

export const objectByKey = (
  objects: readonly StashObject[],
  key: number | undefined,
): StashObject | undefined => (key === undefined ? undefined : objects.find((o) => o.key === key));

export const craftByKey = (
  objects: readonly StashObject[],
  key: number | undefined,
): Craft | undefined => {
  const o = objectByKey(objects, key);
  return o && isCraft(o) ? o : undefined;
};

export const objectRect = (data: EngineData, o: StashObject, x: number, y: number): Rect =>
  isCraft(o) ? itemRect(data, currentItem(o.session), x, y) : { x, y, w: 1, h: 1 };

/** Occupied cells of a container, optionally ignoring one object. */
export function takenRects(
  data: EngineData,
  objects: readonly StashObject[],
  container: Container,
  excludeKey?: number,
): Rect[] {
  return objects
    .filter((o) => o.place?.container === container && o.key !== excludeKey)
    .map((o) => objectRect(data, o, o.place!.x, o.place!.y));
}

/** What a container may hold (currency tab slots are specialised). */
export function containerAccepts(container: Container, o: StashObject): boolean {
  if (container === "curtab") return isCraft(o);
  if (container === "curwild") return !isCraft(o);
  return true;
}

/** First free spot for an object, trying the inventory before the stash. */
function autoPlace(
  data: EngineData,
  objects: readonly StashObject[],
  o: StashObject,
): Placement | undefined {
  const { w, h } = objectRect(data, o, 0, 0);
  for (const container of ["inventory", "stash"] as const) {
    const spot = findSpot(w, h, takenRects(data, objects, container, o.key), GRIDS[container]);
    if (spot) return { container, ...spot };
  }
  return undefined;
}

const equippedMap = (objects: readonly StashObject[], excludeKey?: number): Map<EquipSlot, Item> =>
  new Map(
    objects
      .filter((o): o is Craft => isCraft(o) && o.equipped !== undefined && o.key !== excludeKey)
      .map((c) => [c.equipped!, currentItem(c.session)]),
  );

/** Game inventory stack size for a currency (datamined; sane default). */
export const stackSize = (currency: readonly CurrencyItem[], id: string): number =>
  currency.find((c) => c.id === id)?.stack ?? 10;

export const useApp = create<AppState>((set, get) => ({
  status: "loading",
  currency: [],
  objects: [],
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
        const craft: Craft = { key: 1, session: shared };
        craft.place = autoPlace(data, [], craft);
        set({ objects: [craft], nextKey: 2, activeKey: 1, replayIndex: 0 });
      }
    } catch (err) {
      set({ status: "error", error: err instanceof Error ? err.message : String(err) });
    }
  },

  startCraft(item) {
    const { data, objects, nextKey } = get();
    if (!data) return;
    const craft: Craft = { key: nextKey, session: { initial: item, steps: [] } };
    craft.place = autoPlace(data, objects, craft);
    set({
      objects: [...objects, craft],
      nextKey: nextKey + 1,
      activeKey: craft.key,
      pickerOpen: false,
      // No room anywhere → the new item starts on the cursor.
      ...(craft.place
        ? {}
        : { heldKey: craft.key, heldFrom: undefined, selectedCurrency: undefined, selectedStack: undefined }),
    });
  },

  openPicker: () => set({ pickerOpen: true }),
  closePicker: () => set({ pickerOpen: false }),

  selectCurrency(id, stackKey) {
    if (get().heldKey !== undefined) get().returnHeld();
    set({ selectedCurrency: id, selectedStack: id === undefined ? undefined : stackKey });
  },

  takeStack(currencyId) {
    const { objects, nextKey, heldKey, replayIndex, currency } = get();
    if (heldKey !== undefined || replayIndex !== undefined) return;
    const stack: Stack = { key: nextKey, currencyId, count: stackSize(currency, currencyId) };
    set({
      objects: [...objects, stack],
      nextKey: nextKey + 1,
      heldKey: stack.key,
      heldFrom: undefined,
      selectedCurrency: undefined,
      selectedStack: undefined,
    });
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
    const { data, objects, selectedCurrency, selectedStack, armedOmens, replayIndex, pendingReveal } =
      get();
    const craft = craftByKey(objects, key);
    if (!data || !craft || !selectedCurrency || replayIndex !== undefined) return;
    if (pendingReveal) return; // a Well of Souls choice is open
    const action = actionFor(data, selectedCurrency);
    if (!action) return;
    const item = currentItem(craft.session);
    const omens = new Set(armedOmens);
    // Runes may target the exact socket the player clicked. The Masterwork
    // Rune upgrades whichever socketed rune the player clicks rather than
    // being socketed itself, so it takes the same socket-targeting path.
    const masterwork = action.kind === "rune_upgrade";
    const rune = masterwork ? undefined : data.runeById.get(selectedCurrency);
    if (masterwork && socketIndex !== undefined) {
      if (canMasterwork(data, item, socketIndex) !== null) return;
    } else if (rune && socketIndex !== undefined) {
      if (canSocketRune(data, item, rune, socketIndex) !== null) return;
    } else if (action.canApply(data, item, omens) !== null) {
      return;
    }
    // Uses drawn from a placed stack consume it, one per application.
    const source = objectByKey(objects, selectedStack);
    const consumeStack = (from: StashObject[]): [StashObject[], Partial<AppState>] => {
      if (!source || isCraft(source)) return [from, {}];
      if (source.count > 1) {
        return [
          from.map((o) => (o.key === source.key ? { ...o, count: source.count - 1 } : o)),
          {},
        ];
      }
      return [
        from.filter((o) => o.key !== source.key),
        { selectedCurrency: undefined, selectedStack: undefined },
      ];
    };
    // Bones open the Well of Souls choice instead of resolving immediately
    // (Putrefaction skips the reveal — everything is replaced at once).
    if (action.kind === "desecrate" && !omens.has(OMEN.putrefaction)) {
      const reveal = desecrationReveal(data, item, liveRng, BONES.get(selectedCurrency)!, omens);
      const [next, selection] = consumeStack(objects);
      set({
        activeKey: key,
        objects: next,
        pendingReveal: { key, currencyId: selectedCurrency, reveal },
        armedOmens: armedOmens.filter((o) => !reveal.consumed.includes(o)),
        ...selection,
      });
      return;
    }
    const result =
      masterwork && socketIndex !== undefined
        ? applyMasterwork(data, item, socketIndex)
        : rune && socketIndex !== undefined
          ? applyRune(data, item, rune, socketIndex)
          : action.apply(data, item, liveRng, omens);
    const consumed = result.consumedOmens ?? [];
    const step: CraftStep = {
      currencyId: selectedCurrency,
      omens: consumed,
      events: result.events,
      after: result.item,
    };
    const withStep = objects.map((o) =>
      o.key === key && isCraft(o)
        ? { ...o, session: { ...o.session, steps: [...o.session.steps, step] } }
        : o,
    );
    const [next, selection] = consumeStack(withStep);
    set({
      activeKey: key,
      objects: next,
      armedOmens: armedOmens.filter((o) => !consumed.includes(o)),
      ...selection,
    });
  },

  pickUp(key) {
    const { objects, heldKey, replayIndex } = get();
    const obj = objectByKey(objects, key);
    if (!obj || replayIndex !== undefined) return;
    if (heldKey !== undefined) return; // put the held object down first
    set({
      heldKey: key,
      heldFrom: { place: obj.place, equipped: obj.equipped },
      ...(isCraft(obj) ? { activeKey: key } : {}),
      selectedCurrency: undefined,
      selectedStack: undefined,
      objects: objects.map((o) =>
        o.key === key ? { ...o, place: undefined, equipped: undefined } : o,
      ),
    });
  },

  putDown(container, x, y) {
    const { data, objects, heldKey, currency } = get();
    const held = objectByKey(objects, heldKey);
    if (!data || !held) return;
    if (!containerAccepts(container, held)) return;
    // The central crafting slot holds exactly one item, always docked at 0,0.
    if (container === "curtab") {
      x = 0;
      y = 0;
    }
    const rect = objectRect(data, held, x, y);
    const grid = GRIDS[container];
    if (canPlace(rect, takenRects(data, objects, container, held.key), grid)) {
      set({
        heldKey: undefined,
        heldFrom: undefined,
        objects: objects.map((o) =>
          o.key === held.key ? { ...o, place: { container, x, y }, equipped: undefined } : o,
        ),
      });
      return;
    }
    // Blocked: a single blocking object either merges (same-currency stack)
    // or swaps onto the cursor, like the game.
    const inWay = objects.filter(
      (o) =>
        o.key !== held.key &&
        o.place?.container === container &&
        overlaps(rect, objectRect(data, o, o.place.x, o.place.y)),
    );
    if (inWay.length !== 1) return;
    const blocker = inWay[0];
    if (
      !isCraft(held) &&
      !isCraft(blocker) &&
      held.currencyId === blocker.currencyId
    ) {
      const max = stackSize(currency, held.currencyId);
      const moved = Math.min(max - blocker.count, held.count);
      if (moved <= 0) return;
      const emptied = moved === held.count;
      set({
        ...(emptied ? { heldKey: undefined, heldFrom: undefined } : {}),
        objects: objects
          .map((o) =>
            o.key === blocker.key
              ? { ...o, count: blocker.count + moved }
              : o.key === held.key
                ? { ...o, count: held.count - moved }
                : o,
          )
          .filter((o) => !(o.key === held.key && emptied)),
      });
      return;
    }
    if (!containerAccepts(container, blocker)) return;
    if (!canPlace(rect, takenRects(data, objects, container, blocker.key), grid)) return;
    set({
      heldKey: blocker.key,
      heldFrom: { place: blocker.place },
      ...(isCraft(blocker) ? { activeKey: blocker.key } : {}),
      objects: objects.map((o) =>
        o.key === held.key
          ? { ...o, place: { container, x, y }, equipped: undefined }
          : o.key === blocker.key
            ? { ...o, place: undefined, equipped: undefined }
            : o,
      ),
    });
  },

  equipHeld(slot) {
    const { data, objects, heldKey } = get();
    const held = craftByKey(objects, heldKey);
    if (!data || !held) return;
    const item = currentItem(held.session);
    if (canEquip(data, item, slot, equippedMap(objects, held.key)) !== null) return;
    const occupant = objects.find(
      (o): o is Craft => isCraft(o) && o.key !== held.key && o.equipped === slot,
    );
    set({
      heldKey: occupant?.key,
      heldFrom: occupant ? { equipped: slot } : undefined,
      ...(occupant ? { activeKey: occupant.key } : {}),
      objects: objects.map((o) =>
        o.key === held.key
          ? { ...o, place: undefined, equipped: slot }
          : o.key === occupant?.key
            ? { ...o, place: undefined, equipped: undefined }
            : o,
      ),
    });
  },

  returnHeld() {
    const { data, objects, heldKey, heldFrom } = get();
    const held = objectByKey(objects, heldKey);
    if (!data || !held) return;
    // A fresh stack straight off the stash tab dissolves back into it.
    if (!isCraft(held) && !heldFrom?.place && !heldFrom?.equipped) {
      set({
        heldKey: undefined,
        heldFrom: undefined,
        objects: objects.filter((o) => o.key !== held.key),
      });
      return;
    }
    // Original spot if still free, else first free spot anywhere.
    let place: Placement | undefined;
    let equipped: EquipSlot | undefined;
    if (
      heldFrom?.equipped &&
      isCraft(held) &&
      canEquip(data, currentItem(held.session), heldFrom.equipped, equippedMap(objects, held.key)) === null
    ) {
      equipped = heldFrom.equipped;
    } else if (heldFrom?.place) {
      const rect = objectRect(data, held, heldFrom.place.x, heldFrom.place.y);
      const container = heldFrom.place.container;
      if (canPlace(rect, takenRects(data, objects, container, held.key), GRIDS[container])) {
        place = heldFrom.place;
      }
    }
    if (!place && !equipped) place = autoPlace(data, objects, held);
    if (!place && !equipped) return; // nowhere to go — stays on the cursor
    set({
      heldKey: undefined,
      heldFrom: undefined,
      objects: objects.map((o) => (o.key === held.key ? { ...o, place, equipped } : o)),
    });
  },

  discardHeld() {
    const { objects, heldKey, activeKey } = get();
    if (heldKey === undefined) return;
    const remaining = objects.filter((o) => o.key !== heldKey);
    const crafts = remaining.filter(isCraft);
    set({
      objects: remaining,
      heldKey: undefined,
      heldFrom: undefined,
      activeKey: activeKey === heldKey ? crafts[crafts.length - 1]?.key : activeKey,
    });
  },

  quickMove(key) {
    const { data, objects, heldKey, replayIndex } = get();
    const obj = objectByKey(objects, key);
    if (!data || !obj || heldKey !== undefined || replayIndex !== undefined) return;
    const target: Container = obj.place?.container === "inventory" ? "stash" : "inventory";
    const { w, h } = objectRect(data, obj, 0, 0);
    const spot = findSpot(w, h, takenRects(data, objects, target, key), GRIDS[target]);
    if (!spot) return;
    set({
      ...(isCraft(obj) ? { activeKey: key } : {}),
      objects: objects.map((o) =>
        o.key === key ? { ...o, place: { container: target, ...spot }, equipped: undefined } : o,
      ),
    });
  },

  setActive(key) {
    if (craftByKey(get().objects, key)) set({ activeKey: key });
  },

  chooseReveal(choice) {
    const { data, objects, pendingReveal } = get();
    const craft = craftByKey(objects, pendingReveal?.key);
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
      objects: objects.map((o) =>
        o.key === craft.key && isCraft(o)
          ? { ...o, session: { ...o.session, steps: [...o.session.steps, step] } }
          : o,
      ),
      pendingReveal: undefined,
    });
  },

  rerollPendingReveal() {
    const { data, objects, pendingReveal, armedOmens } = get();
    const craft = craftByKey(objects, pendingReveal?.key);
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
    const { objects, activeKey, replayIndex, pendingReveal } = get();
    const craft = craftByKey(objects, activeKey);
    if (!craft || craft.session.steps.length === 0 || replayIndex !== undefined) return;
    if (pendingReveal) return;
    set({
      objects: objects.map((o) =>
        o.key === craft.key && isCraft(o)
          ? { ...o, session: { ...o.session, steps: o.session.steps.slice(0, -1) } }
          : o,
      ),
    });
  },

  reset() {
    set({
      objects: [],
      activeKey: undefined,
      heldKey: undefined,
      heldFrom: undefined,
      pickerOpen: false,
      selectedCurrency: undefined,
      selectedStack: undefined,
      armedOmens: [],
      replayIndex: undefined,
      pendingReveal: undefined,
    });
    // drop any share-link hash so a reload doesn't resurrect the session
    if (window.location.hash) history.replaceState(null, "", window.location.pathname);
  },

  enterReplay() {
    const craft = craftByKey(get().objects, get().activeKey);
    if (!craft || craft.session.steps.length === 0) return;
    if (get().heldKey !== undefined) get().returnHeld();
    set({ replayIndex: 0, selectedCurrency: undefined, selectedStack: undefined });
  },

  exitReplay() {
    set({ replayIndex: undefined });
  },

  setReplay(index) {
    const { objects, activeKey, replayIndex } = get();
    const craft = craftByKey(objects, activeKey);
    if (!craft || replayIndex === undefined) return;
    set({ replayIndex: Math.max(0, Math.min(index, craft.session.steps.length)) });
  },
}));
