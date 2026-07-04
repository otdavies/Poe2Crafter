import { useEffect, useRef, useState } from "react";
import { sessionHash } from "./state/share.ts";
import { currentItem, itemAt, useApp } from "./state/store.ts";
import { BasePicker } from "./ui/BasePicker.tsx";
import { ItemCard } from "./ui/ItemCard.tsx";
import { OddsPanel } from "./ui/OddsPanel.tsx";
import { OMEN } from "./engine/mechanics.ts";
import { StashPanel } from "./ui/StashPanel.tsx";
import { StepLog } from "./ui/StepLog.tsx";
import { TutorialBar } from "./ui/TutorialBar.tsx";
import { WellOfSouls } from "./ui/WellOfSouls.tsx";
import "./App.css";

export default function App() {
  const app = useApp();
  const [hovered, setHovered] = useState<string | undefined>();
  const [copied, setCopied] = useState(false);
  // Advanced mod descriptions: held while Alt is down (like the game), or
  // pinned via the topbar toggle.
  const [altHeld, setAltHeld] = useState(false);
  const [advancedPinned, setAdvancedPinned] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    void useApp.getState().init();
    return () => clearTimeout(copyTimer.current);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        e.preventDefault(); // keep the browser from focusing its menu bar
        setAltHeld(true);
        return;
      }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const state = useApp.getState();
      if (e.key === "Escape") {
        state.selectCurrency(undefined);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        state.undo();
      } else if (e.key === "ArrowLeft" && state.replayIndex !== undefined) {
        state.setReplay(state.replayIndex - 1);
      } else if (e.key === "ArrowRight" && state.replayIndex !== undefined) {
        state.setReplay(state.replayIndex + 1);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        e.preventDefault();
        setAltHeld(false);
      }
    };
    const onBlur = () => setAltHeld(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  if (app.status === "loading") return <main className="shell">Loading game data…</main>;
  if (app.status === "error" || !app.data) {
    return <main className="shell error">Failed to load data bundle: {app.error}</main>;
  }

  const replaying = app.replayIndex !== undefined;
  const item = app.session
    ? replaying
      ? itemAt(app.session, app.replayIndex!)
      : currentItem(app.session)
    : undefined;
  const nextStep =
    replaying && app.session ? app.session.steps[app.replayIndex!] : undefined;
  // Odds react to the hovered slot; otherwise the held currency (live) or
  // the tutorial's next step.
  const oddsCurrency = hovered ?? (replaying ? nextStep?.currencyId : app.selectedCurrency);
  const oddsOmens = hovered
    ? app.armedOmens
    : replaying
      ? (nextStep?.omens ?? [])
      : app.armedOmens;

  const share = () => {
    if (!app.session) return;
    const url = `${location.origin}${location.pathname}${sessionHash(app.session)}`;
    history.replaceState(null, "", url);
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopied(true);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className={`bench ${app.selectedCurrency ? "holding-currency" : ""}`}>
      <header className="topbar">
        <h1>PoeSolver</h1>
        <span className="tagline">PoE2 crafting simulator — league {app.meta?.league}</span>
        <div className="topbar-actions">
          {app.session && (
            <>
              <button
                type="button"
                className={advancedPinned ? "toggled" : ""}
                onClick={() => setAdvancedPinned((v) => !v)}
                title="Advanced mod descriptions — or hold Alt"
              >
                Alt info
              </button>
              <button type="button" onClick={share} disabled={app.session.steps.length === 0}>
                {copied ? "Link copied!" : "Share"}
              </button>
              {replaying ? (
                <button type="button" onClick={app.exitReplay}>
                  Exit tutorial
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={app.enterReplay}
                    disabled={app.session.steps.length === 0}
                  >
                    Tutorial
                  </button>
                  <button
                    type="button"
                    onClick={app.undo}
                    disabled={app.session.steps.length === 0}
                    title="Ctrl+Z"
                  >
                    Undo
                  </button>
                </>
              )}
              <button type="button" onClick={app.reset}>
                New item
              </button>
            </>
          )}
        </div>
      </header>

      <main className="bench-main">
        <StashPanel
          data={app.data}
          currency={app.currency}
          item={item}
          selected={app.selectedCurrency}
          armedOmens={replaying ? (nextStep?.omens ?? []) : app.armedOmens}
          onSelect={app.selectCurrency}
          onToggleOmen={app.toggleOmen}
          onHover={setHovered}
          highlight={
            nextStep ? { currencyId: nextStep.currencyId, omens: nextStep.omens } : undefined
          }
          readOnly={replaying}
        />

        <section className="item-area">
          {!app.session && <BasePicker data={app.data} onStart={app.startCraft} />}
          {app.session && item && (
            <>
              {replaying && (
                <TutorialBar
                  currency={app.currency}
                  session={app.session}
                  index={app.replayIndex!}
                  onStep={app.setReplay}
                  onExit={app.exitReplay}
                />
              )}
              <ItemCard
                data={app.data}
                item={item}
                active={!replaying && Boolean(app.selectedCurrency)}
                onClick={app.applySelected}
                advanced={altHeld || advancedPinned}
              />
              {!replaying && app.armedOmens.length > 0 && (
                <div className="armed-omens">
                  <span className="armed-label">Active omens</span>
                  {app.armedOmens.map((id) => {
                    const info = app.currency.find((c) => c.id === id);
                    return (
                      <button
                        key={id}
                        type="button"
                        className="armed-omen"
                        title={`${info?.name ?? id} — click to disarm`}
                        onClick={() => app.toggleOmen(id)}
                      >
                        {info ? <img src={info.icon} alt={info.name} /> : id}
                      </button>
                    );
                  })}
                </div>
              )}
              {oddsCurrency && (
                <OddsPanel
                  data={app.data}
                  item={item}
                  currencyId={oddsCurrency}
                  omens={oddsOmens}
                  currency={app.currency}
                />
              )}
            </>
          )}
        </section>

        {app.session && (
          <StepLog
            data={app.data}
            currency={app.currency}
            steps={app.session.steps}
            replayIndex={app.replayIndex}
            onJump={app.setReplay}
          />
        )}
      </main>

      {app.pendingReveal && (
        <WellOfSouls
          data={app.data}
          currency={app.currency}
          currencyId={app.pendingReveal.currencyId}
          reveal={app.pendingReveal.reveal}
          canReroll={app.armedOmens.includes(OMEN.abyssalEchoes)}
          onChoose={app.chooseReveal}
          onReroll={app.rerollPendingReveal}
        />
      )}

      <footer className="disclaimer">
        Not affiliated with or endorsed by Grinding Gear Games.
      </footer>
    </div>
  );
}
