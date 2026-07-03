# Handoff — PoeSolver (PoE2 0.5.x Crafting Simulator)

Context document for continuing development in a fresh session. Read this,
then README.md, then skim `src/engine/` — that's enough to pick up.

## What this is

A Path of Exile 2 crafting simulator for league 0.5.x ("Return of the
Ancients"): craft items exactly as in game, record every step, share crafts
as step-by-step tutorials. Static site on GitHub Pages
(https://github.com/otdavies/Poe2Crafter). Meta-goal: tight, clean,
well-organized codebase; boring reliable tech (Vite + React 19 + TS strict +
Zustand + Vitest, oxlint).

## Roadmap and status

| Phase | Scope | Status |
|---|---|---|
| 1 | Scaffold, data pipeline, CI + Pages deploy | ✅ done |
| 2 | Engine core + basic orbs (transmute/aug/regal/exalt/chaos +Greater/Perfect, alch, annul, divine, vaal) | ✅ done |
| 3 | Playable UI: base picker, game-style tooltip, currency panel, step log, undo | ✅ done |
| 4 | Essences (+0.5 Alloys), omens (activation slots + interaction order), Fracturing Orb, catalysts (quality), distilled emotions | **⬅ NEXT** |
| 5 | Odds panel (hover currency → hit chances), share links (lz-string URL hash), tutorial step-through mode | pending |
| 6 | Polish, keyboard shortcuts, data-refresh automation PR flow | pending |
| 7 | Runes + Runeforging (0.5 league mechanic, 213 runes; bundle already has Runes category + Runemastered bases) | pending |

Recombination is deliberately out of scope (disabled in 0.5 anyway).

## Architecture (three strict layers)

1. **Pipeline** `scripts/pipeline/` — fetch.ts (downloads to gitignored
   `.pipeline-cache/`), lua.ts (luaparse-based PoB Lua→JSON), compile.ts,
   validate.ts (invariants), oracle.ts (cross-check vs Craft of Exile).
2. **Bundle** `public/data/0.5/` — committed compiled JSON = the league pin.
   Contract types in `src/data/schema.ts` (app owns it, pipeline imports it).
3. **App** `src/engine/` (pure TS, NO React imports) + `src/state/store.ts`
   (Zustand) + `src/ui/` (React components).

Engine essentials:
- `modpool.ts` `rollablePool()` is the correctness heart: ordered tag-weight
  match (first matching tag wins, lists end in "default"), ilvl gate, mod
  group exclusion, prefix/suffix limits (magic 1/1, rare 3/3), essence-only
  excluded. The odds panel (phase 5) MUST reuse this same function.
- `actions.ts`: every mechanic is a `CraftAction` keyed by trade-API currency
  id, `canApply()` returns a human-readable blocker or null, `apply()` returns
  `{item, events}`. Events feed the step log / future share links.
- `mechanics.ts`: THE ONLY place hand-encoded game rules live. Two
  TODO(0.5-verify) approximations: Greater/Perfect min mod level (50/70),
  Vaal outcome weights (¼ each: no change / corrupt implicit / reroll values
  / reroll explicits).
- Items are immutable; RNG is injected (`seededRng` in tests, `liveRng` app).

## Where to pick up: phase 4 notes

- **Essences**: bundle `essences.json` (82) already maps essence →
  guaranteed mod id per item class (from PoB `Essence.lua`), joined with
  trade-API icons. Mechanics to implement: base essence = Magic→Rare +
  guaranteed mod; **Greater** = higher-tier guarantee; **Perfect** =
  Chaos-like (remove random mod, add the guaranteed mod). The 13 Verisium
  "Alloys" behave like Perfect Essences with weapon-archetype mods —
  they're in the bundle's currency.json under category "Verisium" but NOT
  yet in essences.json (PoB models them separately; investigate
  `ModItemExclusive.lua` if needed).
- **Omens** (currency.json category "Ritual", 75): implement as modifiers
  armed before an action and consumed by it (game: omen activation slots).
  Key ones: Whittling (annul removes LOWEST required_level mod),
  Sinistral/Dextral X (X affects only prefixes/suffixes — Erasure=annul,
  Coronation=regal, Alchemy, Exaltation), Homogenising Exaltation (new mod
  shares a catalystTag with an existing mod), Greater Exaltation (2 mods),
  Crystallisation (essence protection), Sanctification (divine variant).
  0.5 removed Omens of Recombination and Omen of Corruption. Engine shape
  suggestion: `apply(data, item, rng, omens: Set<string>)` or wrap actions
  in an omen-decorator — keep events accurate either way. Test the
  interaction ORDER carefully (e.g. Whittling + Sinistral Erasure).
- **Fracturing Orb** (id "fracturing-orb"): rare with ≥4 explicits, none
  already fractured → fracture one random explicit permanently
  (`RolledMod.fractured` already exists and is respected by chaos/annul/vaal).
- **Catalysts** (category "Breach", 35): quality type + magnitude on
  jewellery; boosts stat values of mods whose `catalystTags` match. The
  per-quality-point multiplier is NOT datamined — hand-encode in
  mechanics.ts from poe2wiki, cite source. Item needs a `quality`/
  `catalystType` field (doesn't exist yet).
- **Distilled emotions** (category "Delirium", 29; bundle emotions.json):
  0.5 lets them craft mods on jewels (mods table per jewel base is in the
  bundle). Amulet instilling (anoints) needs passive-tree data we do NOT
  ship — either scope to jewel-crafting only or add anoint data to the
  pipeline.
- Bundle gaps to check: desecrated-domain mods are excluded from mods.json
  (only matters for phase-4+ desecration, not required for the above);
  essence generation_type mods (117) ARE included via references.

## Conventions & gotchas

- All relative imports in `src/` use explicit `.ts`/`.tsx` extensions
  (tsconfig.node is nodenext; pipeline scripts import engine code).
- Three tsconfig projects: app (browser, no node types), node (scripts),
  test (src tests + testutil get node types). `npm run build` type-checks all.
- Engine files must never import React or browser APIs.
- Commit style: conventional-ish prefixes (feat/fix/data/ci/test/chore),
  logical units per commit, Claude co-author trailer.
- `npm run data` = fetch → compile → validate. `npm run data:oracle` needs
  `npm run data:fetch -- --oracle` first (CoE blob is oracle-only, never
  shipped). Re-running compile changes only meta.json's generatedAt unless
  upstream moved.
- Tests load the real committed bundle from `public/data/0.5/` (no mocks).
- GitHub Pages must be enabled manually once: repo Settings → Pages →
  Source "GitHub Actions" (CI build job is green; deploy job fails until
  then). BASE_PATH is set from the repo name automatically in ci.yml.
- If the dev server acts up after `npm install <pkg>` (e.g. "Invalid hook
  call"), restart it — stale Vite dep pre-bundle.
- League data updates arrive via the weekly data-refresh workflow PR, or
  manually: `npm run data:fetch -- --force && npm run data`.

## Verification bar (keep it)

Every phase so far shipped with: unit/property tests on the engine
(29 passing), statistical distribution tests where randomness matters,
and for pool correctness the Craft of Exile oracle (16 item classes,
zero unexplained differences). Phase 4 should extend the oracle run to
essence pools if feasible, and add omen-interaction golden tests with
seeded RNG. Run the full gate before committing:
`npm run build && npm run lint && npm test && npm run data:validate`.
