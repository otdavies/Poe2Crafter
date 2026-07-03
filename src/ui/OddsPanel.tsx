/**
 * Odds panel: what the hovered/held currency would do to the current item —
 * removal chances per existing modifier, addition chances per mod family,
 * Vaal outcome split, guaranteed mods. All numbers come from engine/odds.ts,
 * which shares its plumbing with apply().
 */
import { useMemo } from "react";
import type { CurrencyItem } from "../data/schema.ts";
import type { EngineData } from "../engine/data.ts";
import type { Item } from "../engine/item.ts";
import { oddsFor, type AdditionOdds, type Odds } from "../engine/odds.ts";
import { familyText, renderModText } from "./modtext.ts";

const MAX_FAMILIES = 12;

function pct(chance: number): string {
  const p = chance * 100;
  if (p > 0 && p < 0.05) return "<0.1%";
  return `${p >= 99.95 && p < 100 ? "~100" : p.toFixed(1)}%`;
}

function GenBadge({ generation }: { generation: string }) {
  const letter = { prefix: "P", suffix: "S", corrupted: "C" }[generation];
  if (!letter) return null;
  return <span className={`gen-badge gen-${generation}`}>{letter}</span>;
}

function AdditionList({ addition, heading }: { addition: AdditionOdds; heading: string }) {
  const shown = addition.families.slice(0, MAX_FAMILIES);
  const restChance = addition.families
    .slice(MAX_FAMILIES)
    .reduce((sum, f) => sum + f.chance, 0);
  return (
    <>
      <h4>
        {heading}
        {addition.rolls > 1 && <span className="odds-rolls"> ×{addition.rolls}</span>}
      </h4>
      {addition.prefixChance > 0 && addition.suffixChance > 0 && (
        <p className="odds-split">
          Prefix {pct(addition.prefixChance)} · Suffix {pct(addition.suffixChance)}
        </p>
      )}
      <ul className="odds-list">
        {shown.map((family) => (
          <li key={family.mods[0].id}>
            <span className="odds-chance">{pct(family.chance)}</span>
            <GenBadge generation={family.generation} />
            <span className="odds-text">{familyText(family.mods.map((m) => m.text))}</span>
          </li>
        ))}
        {restChance > 0 && (
          <li className="odds-rest">
            <span className="odds-chance">{pct(restChance)}</span>
            <span className="odds-text">
              …{addition.families.length - MAX_FAMILIES} more families
            </span>
          </li>
        )}
      </ul>
    </>
  );
}

export function OddsPanel({ data, item, currencyId, omens, currency }: {
  data: EngineData;
  item: Item;
  currencyId: string;
  omens: readonly string[];
  currency: CurrencyItem[];
}) {
  const odds: Odds | undefined = useMemo(
    () => oddsFor(data, item, currencyId, new Set(omens)),
    [data, item, currencyId, omens],
  );
  if (!odds) return null;
  const info = currency.find((c) => c.id === currencyId);

  return (
    <aside className="odds-panel">
      <h3>
        {info && <img src={info.icon} alt="" />}
        <span>{info?.name ?? currencyId}</span>
      </h3>

      {odds.kind === "blocked" && <p className="odds-blocked">{odds.reason}</p>}

      {odds.kind === "outcomes" && (
        <>
          <h4>Outcomes</h4>
          <ul className="odds-list">
            {odds.outcomes.map((outcome) => (
              <li key={outcome.label}>
                <span className="odds-chance">{pct(outcome.chance)}</span>
                <span className="odds-text">{outcome.label}</span>
              </li>
            ))}
          </ul>
          {odds.enchants && <AdditionList addition={odds.enchants} heading="Possible implicits" />}
        </>
      )}

      {odds.kind === "craft" && (
        <>
          {odds.removal && (
            <>
              <h4>{odds.removal.verb === "fracture" ? "Fractures one of" : "Removes one of"}</h4>
              <ul className="odds-list">
                {odds.removal.candidates.map((candidate, i) => {
                  const mod = data.mod(candidate.mod.modId);
                  return (
                    <li key={i} className={candidate.chance === 0 ? "odds-protected" : ""}>
                      <span className="odds-chance">{pct(candidate.chance)}</span>
                      <GenBadge generation={mod.generation} />
                      <span className="odds-text">
                        {renderModText(mod.text, candidate.mod.values, mod.stats)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {odds.guaranteed && (
            <>
              <h4>Guaranteed modifier</h4>
              <ul className="odds-list">
                {odds.guaranteed.options.map((option) => {
                  const mod = data.mod(option.modId);
                  return (
                    <li key={option.modId}>
                      {option.chance < 1 && (
                        <span className="odds-chance">{pct(option.chance)}</span>
                      )}
                      <GenBadge generation={mod.generation} />
                      <span className="odds-text">{mod.text}</span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {odds.addition && <AdditionList addition={odds.addition} heading="Adds one of" />}
        </>
      )}

      {odds.kind !== "blocked" &&
        odds.notes.map((note) => (
          <p key={note} className="odds-note">
            {note}
          </p>
        ))}
    </aside>
  );
}
