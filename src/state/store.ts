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
import { createItem, type Item } from "../engine/item.ts";
import { liveRng } from "../engine/rng.ts";

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

  init(): Promise<void>;
  startCraft(baseId: string, ilvl: number): void;
  selectCurrency(id: string | undefined): void;
  toggleOmen(id: string): void;
  applySelected(): void;
  undo(): void;
  reset(): void;
}

const DATA_BASE = `${import.meta.env.BASE_URL}data/0.5`;

async function fetchJson<T>(file: string): Promise<T> {
  const res = await fetch(`${DATA_BASE}/${file}`);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export const currentItem = (session: Session): Item =>
  session.steps.length > 0 ? session.steps[session.steps.length - 1].after : session.initial;

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
      set({
        status: "ready",
        meta,
        currency,
        data: new EngineData(mods, bases, essences, emotions),
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
    const { data, session, selectedCurrency, armedOmens } = get();
    if (!data || !session || !selectedCurrency) return;
    const action = actionFor(data, selectedCurrency);
    if (!action) return;
    const item = currentItem(session);
    const omens = new Set(armedOmens);
    if (action.canApply(data, item, omens) !== null) return;
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

  undo() {
    const { session } = get();
    if (!session || session.steps.length === 0) return;
    set({ session: { ...session, steps: session.steps.slice(0, -1) } });
  },

  reset() {
    set({ session: undefined, selectedCurrency: undefined, armedOmens: [] });
  },
}));
