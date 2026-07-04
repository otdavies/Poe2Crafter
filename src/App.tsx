import { useEffect, useMemo, useRef, useState } from "react";
import { sessionHash } from "./state/share.ts";
import {
  craftByKey,
  currentItem,
  itemAt,
  useApp,
} from "./state/store.ts";
import { itemRect } from "./engine/grid.ts";
import { BasePicker } from "./ui/BasePicker.tsx";
import { ItemCard } from "./ui/ItemCard.tsx";
import { InventoryPanel } from "./ui/InventoryPanel.tsx";
import { tileProps } from "./ui/tile.ts";
import { OddsPanel } from "./ui/OddsPanel.tsx";
import { OMEN } from "./engine/mechanics.ts";
import { StashPanel } from "./ui/StashPanel.tsx";
import { StepLog } from "./ui/StepLog.tsx";
import { TutorialBar } from "./ui/TutorialBar.tsx";
import { WellOfSouls } from "./ui/WellOfSouls.tsx";
import "./App.css";

/** The held item (or currency) following the cursor, like the game. */
function CursorGhost({
  tile,
  icon,
}: {
  tile?: { label: string; classes: string[]; w: number; h: number };
  icon?: string;
}) {
  const [pos, setPos] = useState<{ x: number; y: number }>();
  useEffect(() => {
    const onMove = (e: MouseEvent) => setPos({ x: e.clientX, y: e.clientY });
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);
  if (!pos || (!tile && !icon)) return null;
  return (
    <div className="cursor-ghost" style={{ transform: `translate(${pos.x + 10}px, ${pos.y + 8}px)` }}>
      {tile ? (
        <span
          className={tile.classes.join(" ")}
          style={{
            width: `calc(var(--cell) * ${tile.w} * 0.75)`,
            height: `calc(var(--cell) * ${tile.h} * 0.75)`,
          }}
        >
          <span className="tile-name">{tile.label}</span>
        </span>
      ) : (
        <img src={icon} alt="" />
      )}
    </div>
  );
}

export default function App() {
  const app = useApp();
  const [hovered, setHovered] = useState<string | undefined>();
  const [hoveredCraft, setHoveredCraft] = useState<number | undefined>();
  const [copied, setCopied] = useState(false);
  // Advanced mod descriptions: held while Alt is down (like the game), or
  // pinned via the topbar toggle.
  const [altHeld, setAltHeld] = useState(false);
  const [advancedPinned, setAdvancedPinned] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const runeIcons = useMemo(
    () => new Map(app.currency.filter((c) => c.category === "Runes").map((c) => [c.id, c.icon])),
    [app.currency],
  );

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
        if (state.pickerOpen && state.crafts.length > 0) state.closePicker();
        else if (state.heldKey !== undefined) state.returnHeld();
        else state.selectCurrency(undefined);
      } else if (e.key === "Delete" && state.heldKey !== undefined) {
        state.discardHeld();
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
  const active = craftByKey(app.crafts, app.activeKey);
  const held = craftByKey(app.crafts, app.heldKey);
  // The centre column acts as the game's item tooltip: it previews whatever
  // the cursor is over (grid tiles, doll slots, the held item), falling back
  // to the item being crafted.
  const displayed = craftByKey(app.crafts, hoveredCraft) ?? held ?? active;
  const item = displayed
    ? replaying && displayed.key === app.activeKey
      ? itemAt(displayed.session, app.replayIndex!)
      : currentItem(displayed.session)
    : undefined;
  const nextStep = replaying && active ? active.session.steps[app.replayIndex!] : undefined;
  // Odds react to the hovered slot; otherwise the held currency (live) or
  // the tutorial's next step.
  const oddsCurrency = hovered ?? (replaying ? nextStep?.currencyId : app.selectedCurrency);
  const oddsOmens = hovered
    ? app.armedOmens
    : replaying
      ? (nextStep?.omens ?? [])
      : app.armedOmens;

  const heldItem = held ? currentItem(held.session) : undefined;
  const heldTile = heldItem
    ? {
        ...tileProps(heldItem, app.data),
        ...(() => {
          const r = itemRect(app.data, heldItem, 0, 0);
          return { w: r.w, h: r.h };
        })(),
      }
    : undefined;
  const heldCurrencyIcon = app.selectedCurrency
    ? app.currency.find((c) => c.id === app.selectedCurrency)?.icon
    : undefined;

  const share = () => {
    if (!active) return;
    const url = `${location.origin}${location.pathname}${sessionHash(active.session)}`;
    history.replaceState(null, "", url);
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopied(true);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1600);
  };

  const pickerShown = app.pickerOpen || app.crafts.length === 0;

  return (
    <div className={`bench ${app.selectedCurrency ? "holding-currency" : ""} ${app.heldKey !== undefined ? "holding-item" : ""}`}>
      <header className="topbar">
        <h1>PoeSolver</h1>
        <span className="tagline">PoE2 crafting simulator — league {app.meta?.league}</span>
        <div className="topbar-actions">
          {active && (
            <>
              <button
                type="button"
                className={advancedPinned ? "toggled" : ""}
                onClick={() => setAdvancedPinned((v) => !v)}
                title="Advanced mod descriptions — or hold Alt"
              >
                Alt info
              </button>
              <button type="button" onClick={share} disabled={active.session.steps.length === 0}>
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
                    disabled={active.session.steps.length === 0}
                  >
                    Tutorial
                  </button>
                  <button
                    type="button"
                    onClick={app.undo}
                    disabled={active.session.steps.length === 0}
                    title="Ctrl+Z"
                  >
                    Undo
                  </button>
                </>
              )}
              <button type="button" onClick={app.reset}>
                Clear all
              </button>
            </>
          )}
        </div>
      </header>

      <main className="bench-main game-layout">
        <StashPanel
          data={app.data}
          currency={app.currency}
          item={item}
          selected={app.selectedCurrency}
          armedOmens={replaying ? (nextStep?.omens ?? []) : app.armedOmens}
          onSelect={app.selectCurrency}
          onToggleOmen={app.toggleOmen}
          onHover={setHovered}
          onHoverCraft={setHoveredCraft}
          highlight={
            nextStep ? { currencyId: nextStep.currencyId, omens: nextStep.omens } : undefined
          }
          readOnly={replaying}
        />

        <section className="item-area">
          {replaying && active && (
            <TutorialBar
              currency={app.currency}
              session={active.session}
              index={app.replayIndex!}
              onStep={app.setReplay}
              onExit={app.exitReplay}
            />
          )}
          {item && displayed && (
            <>
              <ItemCard
                data={app.data}
                item={item}
                active={!replaying && Boolean(app.selectedCurrency)}
                onClick={() => app.applyTo(displayed.key)}
                advanced={altHeld || advancedPinned}
                runeIcons={runeIcons}
                onSocketClick={
                  !replaying && app.selectedCurrency && app.data.runeById.has(app.selectedCurrency)
                    ? (i) => app.applyTo(displayed.key, i)
                    : undefined
                }
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
          {active && (
            <StepLog
              data={app.data}
              currency={app.currency}
              steps={active.session.steps}
              replayIndex={app.replayIndex}
              onJump={app.setReplay}
            />
          )}
        </section>

        <InventoryPanel onHoverCraft={setHoveredCraft} />
      </main>

      {pickerShown && (
        <div className="picker-overlay">
          <BasePicker
            data={app.data}
            onStart={app.startCraft}
            onCancel={app.crafts.length > 0 ? app.closePicker : undefined}
          />
        </div>
      )}

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

      <CursorGhost tile={heldTile} icon={heldCurrencyIcon} />

      <footer className="disclaimer">
        Not affiliated with or endorsed by Grinding Gear Games.
      </footer>
    </div>
  );
}
