# PoeSolver

A Path of Exile 2 crafting simulator for league 0.5.x ("Return of the Ancients").
Craft items exactly as you would in game — same currencies, mod pools, and
mechanics — then share the craft as a step-by-step tutorial. Ships as a fully
static site on GitHub Pages.

## Architecture

Three strictly separated layers:

| Layer | Where | What |
|---|---|---|
| Data pipeline | `scripts/pipeline/` | Build-time scripts that fetch upstream game data and compile the bundle |
| Data bundle | `public/data/<league>/` | Committed, compiled JSON — the league pin; the site never touches upstreams at runtime |
| App | `src/` | React UI + (coming) pure-TS crafting engine in `src/engine/`, no React imports |

The data contract between pipeline and app lives in [src/data/schema.ts](src/data/schema.ts).

### Data sources

- **[repoe-fork PoE2 exports](https://repoe-fork.github.io/poe2/)** — mod pool with spawn weights, ilvl gates, mod groups and catalyst tags; item bases with implicits.
- **[Path of Building PoE2 fork](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2)** — essence → guaranteed-mod mappings, distilled emotions (parsed from Lua at build time).
- **[Official trade API](https://www.pathofexile.com/api/trade2/data/static)** — canonical item ids, display names, and icon URLs.

Craft of Exile's data is used only as a validation oracle in tests, never shipped.

## Commands

```sh
npm run dev            # dev server
npm test               # vitest
npm run lint           # oxlint
npm run build          # type-check + production build
npm run data           # full pipeline: fetch -> compile -> validate
npm run data:fetch     # download upstream sources into .pipeline-cache/
npm run data:compile   # .pipeline-cache/ -> public/data/<league>/
npm run data:validate  # invariant checks on the compiled bundle
```

## Deployment

Pushes to `main` deploy to GitHub Pages via `.github/workflows/ci.yml`
(enable Pages with source "GitHub Actions" in repo settings). A weekly
`data-refresh.yml` workflow regenerates the bundle and opens a PR when
upstream data changes.

---

PoeSolver is not affiliated with or endorsed by Grinding Gear Games. All game
data and imagery are the property of Grinding Gear Games.
