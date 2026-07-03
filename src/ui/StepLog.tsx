/** Chronological log of the craft — the raw material for shareable tutorials. */
import type { CurrencyItem } from "../data/schema.ts";
import type { EngineData } from "../engine/data.ts";
import type { CraftStep } from "../state/store.ts";
import { describeEvent } from "./events.ts";

export function StepLog({ data, currency, steps, replayIndex, onJump }: {
  data: EngineData;
  currency: CurrencyItem[];
  steps: CraftStep[];
  /** Tutorial mode: steps >= this index are upcoming (outcomes hidden). */
  replayIndex?: number;
  /** Tutorial mode: click a step to rewind/skip to just before it. */
  onJump?: (index: number) => void;
}) {
  const byId = new Map(currency.map((c) => [c.id, c]));
  const replaying = replayIndex !== undefined;
  return (
    <section className="step-log">
      <h3>Steps</h3>
      {steps.length === 0 && <p className="item-hint">Apply a currency to begin.</p>}
      <ol>
        {steps.map((step, i) => {
          const info = byId.get(step.currencyId);
          const state = !replaying ? "" : i === replayIndex ? "step-current" : i > replayIndex ? "step-future" : "";
          return (
            <li key={i} className={state}>
              <div
                className="step-header"
                onClick={replaying && onJump ? () => onJump(i) : undefined}
                role={replaying ? "button" : undefined}
              >
                {info && <img src={info.icon} alt="" />}
                <span>{info?.name ?? step.currencyId}</span>
              </div>
              {step.omens.length > 0 && (
                <div className="step-omens">
                  under {step.omens.map((id) => byId.get(id)?.name ?? id).join(" + ")}
                </div>
              )}
              {(!replaying || i < replayIndex) && (
                <ul>
                  {step.events.map((event, j) => (
                    <li key={j} className={`event event-${event.kind}`}>
                      {describeEvent(data, event)}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
