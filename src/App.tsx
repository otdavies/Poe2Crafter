import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { sessionHash } from "./state/share.ts";
import {
  craftByKey,
  currentItem,
  isCraft,
  itemAt,
  objectByKey,
  useApp,
} from "./state/store.ts";
import { itemRect } from "./engine/grid.ts";
import { BasePicker } from "./ui/BasePicker.tsx";
import { ItemCard } from "./ui/ItemCard.tsx";
import { InventoryPanel } from "./ui/InventoryPanel.tsx";
import { ItemTile } from "./ui/Tile.tsx";
import { CurrencyCard } from "./ui/CurrencyCard.tsx";
import { OMEN } from "./engine/mechanics.ts";
import { StashPanel } from "./ui/StashPanel.tsx";
import { StepLog } from "./ui/StepLog.tsx";
import { TutorialBar } from "./ui/TutorialBar.tsx";
import { WellOfSouls } from "./ui/WellOfSouls.tsx";
import "./App.css";

/** Whatever is "on the cursor" follows the mouse, like the game. */
function CursorGhost({ children }: { children: ReactNode }) {
  const [pos, setPos] = useState<{ x: number; y: number }>();
  useEffect(() => {
    const onMove = (e: MouseEvent) => setPos({ x: e.clientX, y: e.clientY });
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);
  if (!pos || !children) return null;
  return (
    <div className="cursor-ghost" style={{ transform: `translate(${pos.x + 10}px, ${pos.y + 8}px)` }}>
      {children}
    </div>
  );
}

export default function App() {
  const app = useApp();
  const [hoveredObj, setHoveredObj] = useState<{ key: number; x: number; y: number } | undefined>();
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
        if (state.pickerOpen && state.objects.some(isCraft)) state.closePicker();
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
  const active = craftByKey(app.objects, app.activeKey);
  const held = objectByKey(app.objects, app.heldKey);
  // Odds/steps always follow the item being crafted (the active craft);
  // during replay they follow the tutorial position.
  const activeItem = active
    ? replaying
      ? itemAt(active.session, app.replayIndex!)
      : currentItem(active.session)
    : undefined;
  const nextStep = replaying && active ? active.session.steps[app.replayIndex!] : undefined;

  // Tooltips show only while hovering, like the game: the item card over
  // crafts, the currency effect card over placed stacks.
  const hoveredCraft = craftByKey(app.objects, hoveredObj?.key);
  const tooltipItem =
    hoveredCraft && app.heldKey !== hoveredCraft.key ? currentItem(hoveredCraft.session) : undefined;
  const hoveredObject = objectByKey(app.objects, hoveredObj?.key);
  const hoveredStack =
    hoveredObject && !isCraft(hoveredObject) && app.heldKey !== hoveredObject.key
      ? hoveredObject
      : undefined;
  const hoveredStackInfo = hoveredStack
    ? app.currency.find((c) => c.id === hoveredStack.currencyId)
    : undefined;
  const tooltipStyle = hoveredObj
    ? {
        left: Math.max(8, Math.min(hoveredObj.x + 14, window.innerWidth - 480)),
        top: Math.max(8, Math.min(hoveredObj.y - 24, window.innerHeight - 420)),
      }
    : undefined;

  const heldStackInfo =
    held && !isCraft(held) ? app.currency.find((c) => c.id === held.currencyId) : undefined;
  const heldRect = held && isCraft(held) ? itemRect(app.data, currentItem(held.session), 0, 0) : undefined;
  const armedCurrencyIcon = app.selectedCurrency
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

  const pickerShown = app.pickerOpen || !app.objects.some(isCraft);

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
          item={activeItem}
          selected={app.selectedCurrency}
          armedOmens={replaying ? (nextStep?.omens ?? []) : app.armedOmens}
          onSelect={app.selectCurrency}
          onToggleOmen={app.toggleOmen}
          onHoverObject={(key, at) =>
            setHoveredObj(key !== undefined && at ? { key, ...at } : undefined)
          }
          runeIcons={runeIcons}
          highlight={
            nextStep ? { currencyId: nextStep.currencyId, omens: nextStep.omens } : undefined
          }
          readOnly={replaying}
        />

        <section className="item-area">
          {replaying && active && activeItem && (
            <>
              <TutorialBar
                currency={app.currency}
                session={active.session}
                index={app.replayIndex!}
                onStep={app.setReplay}
                onExit={app.exitReplay}
              />
              <ItemCard
                data={app.data}
                item={activeItem}
                advanced={altHeld || advancedPinned}
                runeIcons={runeIcons}
              />
            </>
          )}
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

        <InventoryPanel
          runeIcons={runeIcons}
          onHoverObject={(key, at) =>
            setHoveredObj(key !== undefined && at ? { key, ...at } : undefined)
          }
        />
      </main>

      {tooltipItem && tooltipStyle && !replaying && (
        <div className="item-tooltip" style={tooltipStyle}>
          <ItemCard
            data={app.data}
            item={tooltipItem}
            advanced={altHeld || advancedPinned}
            runeIcons={runeIcons}
          />
        </div>
      )}

      {hoveredStack && hoveredStackInfo && tooltipStyle && !replaying && (
        <div className="stash-tooltip" style={tooltipStyle}>
          <CurrencyCard
            data={app.data}
            info={hoveredStackInfo}
            item={activeItem}
            omens={app.armedOmens}
            count={hoveredStack.count}
            note={
              app.selectedStack === hoveredStack.key
                ? "Armed — click the item to apply, Escape to disarm"
                : "Right-click to use from this stack • click to pick up"
            }
            noteKind={app.selectedStack === hoveredStack.key ? "ok" : "info"}
          />
        </div>
      )}

      {pickerShown && (
        <div className="picker-overlay">
          <BasePicker
            data={app.data}
            onStart={app.startCraft}
            onCancel={app.objects.some(isCraft) ? app.closePicker : undefined}
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

      <CursorGhost>
        {held && isCraft(held) && heldRect ? (
          <span
            className="ghost-item"
            style={{
              width: `calc(var(--cell) * ${heldRect.w} * 0.85)`,
              height: `calc(var(--cell) * ${heldRect.h} * 0.85)`,
            }}
          >
            <ItemTile data={app.data} item={currentItem(held.session)} runeIcons={runeIcons} />
          </span>
        ) : held && heldStackInfo ? (
          <span className="ghost-stack">
            <img src={heldStackInfo.icon} alt="" />
            <span className="stack-count">{!isCraft(held) ? held.count : ""}</span>
          </span>
        ) : armedCurrencyIcon ? (
          <img src={armedCurrencyIcon} alt="" />
        ) : null}
      </CursorGhost>

      <footer className="disclaimer">
        Not affiliated with or endorsed by Grinding Gear Games.
      </footer>
    </div>
  );
}
