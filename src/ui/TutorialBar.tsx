/**
 * Tutorial step-through: walks a session one currency use at a time. The
 * bar shows the instruction for the next step; the stash highlights the
 * currency (and omens) it uses, and "Apply" reveals the outcome.
 */
import type { CurrencyItem } from "../data/schema.ts";
import type { Session } from "../state/store.ts";

export function TutorialBar({ currency, session, index, onStep, onExit }: {
  currency: CurrencyItem[];
  session: Session;
  index: number;
  onStep: (index: number) => void;
  onExit: () => void;
}) {
  const byId = new Map(currency.map((c) => [c.id, c]));
  const total = session.steps.length;
  const next = index < total ? session.steps[index] : undefined;
  return (
    <div className="tutorial-bar">
      <button type="button" onClick={() => onStep(index - 1)} disabled={index === 0}>
        ◀ Back
      </button>
      <div className="tutorial-status">
        <span className="tutorial-step">
          Step {Math.min(index + 1, total)} of {total}
        </span>
        {next ? (
          <span className="tutorial-instruction">
            Use <strong>{byId.get(next.currencyId)?.name ?? next.currencyId}</strong>
            {next.omens.length > 0 && (
              <> under {next.omens.map((id) => byId.get(id)?.name ?? id).join(" + ")}</>
            )}
          </span>
        ) : (
          <span className="tutorial-instruction">Craft complete</span>
        )}
      </div>
      <button
        type="button"
        className="primary"
        onClick={() => onStep(index + 1)}
        disabled={!next}
      >
        Apply ▶
      </button>
      <button type="button" onClick={onExit}>
        Exit tutorial
      </button>
    </div>
  );
}
