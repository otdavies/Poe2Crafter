import { useEffect, useState } from "react";
import type { BundleMeta } from "./data/schema.ts";
import "./App.css";

const DATA_URL = `${import.meta.env.BASE_URL}data/0.5/meta.json`;

export default function App() {
  const [meta, setMeta] = useState<BundleMeta | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(DATA_URL)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(setMeta)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <main className="shell">
      <h1>PoeSolver</h1>
      <p className="tagline">Path of Exile 2 crafting simulator — league {meta?.league ?? "…"}</p>
      {error && <p className="error">Failed to load data bundle: {error}</p>}
      {meta && (
        <dl className="counts">
          {Object.entries(meta.counts).map(([key, count]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{count.toLocaleString()}</dd>
            </div>
          ))}
        </dl>
      )}
      <footer>
        Not affiliated with or endorsed by Grinding Gear Games.
        {meta && <> Data generated {new Date(meta.generatedAt).toLocaleDateString()}.</>}
      </footer>
    </main>
  );
}
