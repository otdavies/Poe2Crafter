/**
 * App state: loaded game data + the active craft session. The engine stays
 * pure — this store is the only place that mutates over time.
 */
import { create } from "zustand";
import type {
  BundleMeta,
  CurrencyItem,
  DistilledEmotion,
  Essence,
} from "../data/schema.ts";
import { actionFor, type CraftEvent } from "../engine/actions.ts";
import { EngineData } from "../engine/data.ts";
import {
  commitDesecration,
  desecrationReveal,
  rerollReveal,
  type DesecrationReveal,
} from "../engine/desecrate.ts";
import { createItem, type Item } from "../engine/item.ts";
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

interface AppState {
  status: "loading" | "ready" | "error";
  error?: string;
  meta?: BundleMeta;
  data?: EngineData;
  currency: CurrencyItem[];

  session?: Session;
  /** Currency id "held on the cursor", ready to apply to the item. */
  selectedCurrency?: string;
  /** Omens armed for the next currency use (game: activation slots). */
  armedOmens: string[];
  /**
   * Tutorial step-through: number of steps currently shown (0 = initial
   * item, steps.length = finished). undefined = live crafting.
   */
  replayIndex?: number;
  /**
   * Desecration in progress: the Well of Souls offer awaiting the player's
   * pick. Crafting/undo are paused until a choice is made.
   */
  pendingReveal?: { currencyId: string; reveal: DesecrationReveal };

  init(): Promise<void>;
  startCraft(baseId: string, ilvl: number): void;
  selectCurrency(id: string | undefined): void;
  toggleOmen(id: string): void;
  applySelected(): void;
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

export const useApp = create<AppState>((set, get) => ({
  status: "loading",
  currency: [],
  armedOmens: [],

  async init() {
    try {
      const [meta, mods, bases, currency, essences, emotions] = await Promise.all([
        fetchJson<BundleMeta>("meta.json"),
        fetchJson<never[]>("mods.json"),
        fetchJson<never[]>("bases.json"),
        fetchJson<CurrencyItem[]>("currency.json"),
        fetchJson<Essence[]>("essences.json"),
        fetchJson<DistilledEmotion[]>("emotions.json"),
      ]);
      const data = new EngineData(mods, bases, essences, emotions);
      // A share link opens straight into tutorial mode.
      const encoded = encodedFromHash(window.location.hash);
      const shared = encoded ? decodeSession(data, encoded) : undefined;
      set({
        status: "ready",
        meta,
        currency,
        data,
        ...(shared && { session: shared, replayIndex: 0 }),
      });
    } catch (err) {
      set({ status: "error", error: err instanceof Error ? err.message : String(err) });
    }
  },

  startCraft(baseId, ilvl) {
    const { data } = get();
    if (!data) return;
    set({ session: { initial: createItem(data, baseId, ilvl, liveRng), steps: [] } });
  },

  selectCurrency(id) {
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

  applySelected() {
    const { data, session, selectedCurrency, armedOmens, replayIndex, pendingReveal } = get();
    if (!data || !session || !selectedCurrency || replayIndex !== undefined) return;
    if (pendingReveal) return; // a Well of Souls choice is open
    const action = actionFor(data, selectedCurrency);
    if (!action) return;
    const item = currentItem(session);
    const omens = new Set(armedOmens);
    if (action.canApply(data, item, omens) !== null) return;
    // Bones open the Well of Souls choice instead of resolving immediately
    // (Putrefaction skips the reveal — everything is replaced at once).
    if (action.kind === "desecrate" && !omens.has(OMEN.putrefaction)) {
      const reveal = desecrationReveal(data, item, liveRng, BONES.get(selectedCurrency)!, omens);
      set({
        pendingReveal: { currencyId: selectedCurrency, reveal },
        armedOmens: armedOmens.filter((o) => !reveal.consumed.includes(o)),
      });
      return;
    }
    const result = action.apply(data, item, liveRng, omens);
    const consumed = result.consumedOmens ?? [];
    set({
      session: {
        ...session,
        steps: [
          ...session.steps,
          {
            currencyId: selectedCurrency,
            omens: consumed,
            events: result.events,
            after: result.item,
          },
        ],
      },
      armedOmens: armedOmens.filter((o) => !consumed.includes(o)),
    });
  },

  chooseReveal(choice) {
    const { data, session, pendingReveal } = get();
    if (!data || !session || !pendingReveal) return;
    if (choice < 0 || choice >= pendingReveal.reveal.options.length) return;
    const item = currentItem(session);
    const result = commitDesecration(data, item, pendingReveal.reveal, choice, liveRng);
    set({
      session: {
        ...session,
        steps: [
          ...session.steps,
          {
            currencyId: pendingReveal.currencyId,
            omens: result.consumedOmens,
            events: result.events,
            after: result.item,
          },
        ],
      },
      pendingReveal: undefined,
    });
  },

  rerollPendingReveal() {
    const { data, session, pendingReveal, armedOmens } = get();
    if (!data || !session || !pendingReveal) return;
    if (!armedOmens.includes(OMEN.abyssalEchoes)) return;
    const reveal = rerollReveal(
      data,
      currentItem(session),
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
    const { session, replayIndex, pendingReveal } = get();
    if (!session || session.steps.length === 0 || replayIndex !== undefined) return;
    if (pendingReveal) return;
    set({ session: { ...session, steps: session.steps.slice(0, -1) } });
  },

  reset() {
    set({
      session: undefined,
      selectedCurrency: undefined,
      armedOmens: [],
      replayIndex: undefined,
      pendingReveal: undefined,
    });
    // drop any share-link hash so a reload doesn't resurrect the session
    if (window.location.hash) history.replaceState(null, "", window.location.pathname);
  },

  enterReplay() {
    const { session } = get();
    if (!session || session.steps.length === 0) return;
    set({ replayIndex: 0, selectedCurrency: undefined });
  },

  exitReplay() {
    set({ replayIndex: undefined });
  },

  setReplay(index) {
    const { session, replayIndex } = get();
    if (!session || replayIndex === undefined) return;
    set({ replayIndex: Math.max(0, Math.min(index, session.steps.length)) });
  },
}));
