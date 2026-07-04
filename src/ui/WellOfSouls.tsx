/**
 * The Well of Souls reveal: the desecration offer of three modifiers, of
 * which the player keeps exactly one. Rendered as a modal over the bench —
 * like in game, the choice is mandatory and permanent (the bone is spent).
 */
import type { CurrencyItem, Mod } from "../data/schema.ts";
import type { EngineData } from "../engine/data.ts";
import type { DesecrationReveal } from "../engine/desecrate.ts";
import { renderModText } from "./modtext.ts";

const LORD_NAMES: Record<string, string> = {
  ulaman: "Ulaman, the Sovereign",
  amanamu: "Amanamu, the Liege",
  kurgal: "Kurgal, the Blackblooded",
};

function OptionCard({ mod, onPick }: { mod: Mod; onPick: () => void }) {
  return (
    <button type="button" className="well-option" onClick={onPick}>
      <span className={`gen-badge gen-${mod.generation}`}>
        {mod.generation === "prefix" ? "P" : "S"}
      </span>
      <span className="well-option-text">
        <span className="well-mod-text">{mod.text}</span>
        {mod.lord && <span className="well-lord">{LORD_NAMES[mod.lord] ?? mod.lord}</span>}
      </span>
    </button>
  );
}

export function WellOfSouls({ data, currency, currencyId, reveal, canReroll, onChoose, onReroll }: {
  data: EngineData;
  currency: CurrencyItem[];
  currencyId: string;
  reveal: DesecrationReveal;
  /** Omen of Abyssal Echoes is armed — one reroll of the offer. */
  canReroll: boolean;
  onChoose: (choice: number) => void;
  onReroll: () => void;
}) {
  const bone = currency.find((c) => c.id === currencyId);
  const removedMod = reveal.removed ? data.mod(reveal.removed.modId) : undefined;
  return (
    <div className="well-overlay">
      <section className="well-panel">
        <header>
          <h3>Well of Souls</h3>
          <p className="well-sub">
            {bone?.name ?? currencyId} — choose one Desecrated modifier. The choice is
            permanent.
          </p>
        </header>
        {removedMod && reveal.removed && (
          <p className="well-removed">
            Removed to make room:{" "}
            <span>{renderModText(removedMod.text, reveal.removed.values, removedMod.stats)}</span>
          </p>
        )}
        <div className="well-options">
          {reveal.options.map((mod, i) => (
            <OptionCard key={mod.id} mod={mod} onPick={() => onChoose(i)} />
          ))}
          {reveal.options.length === 0 && (
            <p className="well-removed">No modifiers can be offered — this should not happen.</p>
          )}
        </div>
        {canReroll && (
          <button type="button" className="well-reroll" onClick={onReroll}>
            Reroll offer (consumes Omen of Abyssal Echoes)
          </button>
        )}
      </section>
    </div>
  );
}
