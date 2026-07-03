import { useEffect } from "react";
import { currentItem, useApp } from "./state/store.ts";
import { BasePicker } from "./ui/BasePicker.tsx";
import { CurrencyPanel } from "./ui/CurrencyPanel.tsx";
import { ItemCard } from "./ui/ItemCard.tsx";
import { StepLog } from "./ui/StepLog.tsx";
import "./App.css";

export default function App() {
  const app = useApp();

  useEffect(() => {
    void useApp.getState().init();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") useApp.getState().selectCurrency(undefined);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (app.status === "loading") return <main className="shell">Loading game data…</main>;
  if (app.status === "error" || !app.data) {
    return <main className="shell error">Failed to load data bundle: {app.error}</main>;
  }

  const item = app.session ? currentItem(app.session) : undefined;

  return (
    <div className={`bench ${app.selectedCurrency ? "holding-currency" : ""}`}>
      <header className="topbar">
        <h1>PoeSolver</h1>
        <span className="tagline">PoE2 crafting simulator — league {app.meta?.league}</span>
        <div className="topbar-actions">
          {app.session && (
            <>
              <button type="button" onClick={app.undo} disabled={app.session.steps.length === 0}>
                Undo
              </button>
              <button type="button" onClick={app.reset}>
                New item
              </button>
            </>
          )}
        </div>
      </header>

      <main className="bench-main">
        <CurrencyPanel
          data={app.data}
          currency={app.currency}
          item={item}
          selected={app.selectedCurrency}
          onSelect={app.selectCurrency}
        />

        <section className="item-area">
          {!app.session && <BasePicker data={app.data} onStart={app.startCraft} />}
          {app.session && item && (
            <ItemCard
              data={app.data}
              item={item}
              active={Boolean(app.selectedCurrency)}
              onClick={app.applySelected}
            />
          )}
        </section>

        {app.session && (
          <StepLog data={app.data} currency={app.currency} steps={app.session.steps} />
        )}
      </main>

      <footer className="disclaimer">
        Not affiliated with or endorsed by Grinding Gear Games.
      </footer>
    </div>
  );
}
