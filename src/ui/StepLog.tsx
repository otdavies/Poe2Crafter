/** Chronological log of the craft — the raw material for shareable tutorials. */
import type { CurrencyItem } from "../data/schema.ts";
import type { EngineData } from "../engine/data.ts";
import type { CraftStep } from "../state/store.ts";
import { describeEvent } from "./events.ts";

export function StepLog({ data, currency, steps }: {
  data: EngineData;
  currency: CurrencyItem[];
  steps: CraftStep[];
}) {
  const byId = new Map(currency.map((c) => [c.id, c]));
  return (
    <section className="step-log">
      <h3>Steps</h3>
      {steps.length === 0 && <p className="item-hint">Apply a currency to begin.</p>}
      <ol>
        {steps.map((step, i) => {
          const info = byId.get(step.currencyId);
          return (
            <li key={i}>
              <div className="step-header">
                {info && <img src={info.icon} alt="" />}
                <span>{info?.name ?? step.currencyId}</span>
              </div>
              <ul>
                {step.events.map((event, j) => (
                  <li key={j} className={`event event-${event.kind}`}>
                    {describeEvent(data, event)}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
