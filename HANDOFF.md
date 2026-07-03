# Handoff — PoeSolver (PoE2 0.5.x Crafting Simulator)

Context document for continuing development in a fresh session. Read this,
then README.md, then skim `src/engine/` — that's enough to pick up.

## What this is

A Path of Exile 2 crafting simulator for league 0.5.x ("Return of the
Ancients" / Runes of Aldur): craft items exactly as in game, record every
step, share crafts as step-by-step tutorials. Static site on GitHub Pages
(https://github.com/otdavies/Poe2Crafter). Meta-goal: tight, clean,
well-organized codebase; boring reliable tech (Vite + React 19 + TS strict +
Zustand + Vitest, oxlint).

## Roadmap and status

| Phase | Scope | Status |
|---|---|---|
| 1 | Scaffold, data pipeline, CI + Pages deploy | ✅ done |
| 2 | Engine core + basic orbs (transmute/aug/regal/exalt/chaos +Greater/Perfect, alch, annul, divine, vaal) | ✅ done |
| 3 | Playable UI: base picker, game-style tooltip, currency panel, step log, undo | ✅ done |
| 4 | Essences (+corrupted, +Verisium Alloys), omens (arming + interaction order), Fracturing Orb, catalysts (quality), liquid emotions on jewels; stash-tab UI + base item stats | ✅ done |
| 5 | Odds panel (hover currency → hit chances), share links (lz-string URL hash), tutorial step-through mode | **⬅ NEXT** |
| 6 | Polish, keyboard shortcuts, computed defences (mods applied to base stats), data-refresh automation PR flow | pending |
| 7 | Runes + Runeforging (0.5 league mechanic, 213 runes; bundle already has Runes category + Runemastered bases) | pending |

Recombination is deliberately out of scope (disabled in 0.5 anyway).

## Architecture (three strict layers)

1. **Pipeline** `scripts/pipeline/` — fetch.ts (downloads to gitignored
   `.pipeline-cache/`; `--best-effort` skips unreachable hosts), lua.ts
   (luaparse-based PoB Lua→JSON; `parseLuaAssignments` for `Bases/*.lua`),
   compile.ts, validate.ts (invariants), oracle.ts (cross-check vs Craft of
   Exile). compile.ts is **offline-incremental**: a source missing from the
   cache carries the previous committed bundle output forward and flags it
   `carriedForward` in meta.json — sandboxes that can only reach
   raw.githubusercontent.com (PoB) can still recompile the PoB-derived parts.
2. **Bundle** `public/data/0.5/` — committed compiled JSON = the league pin.
   Contract types in `src/data/schema.ts` (app owns it, pipeline imports it).
   BaseItem now carries `properties` (defence/weapon numbers) + `req`, both
   merged from PoB by base name; the 8 jewel bases (regular + Time-Lost) are
   synthesized from PoB `jewel.lua` with stable `Jewel/<name>` ids.
3. **App** `src/engine/` (pure TS, NO React imports) + `src/state/store.ts`
   (Zustand) + `src/ui/` (React components).

Engine essentials:
- `modpool.ts` `rollablePool()` is the correctness heart: ordered tag-weight
  match (first matching tag wins, lists end in "default"), ilvl gate, mod
  group exclusion, prefix/suffix limits (magic 1/1, rare 3/3 — **jewels are
  rare 2/2**, see `AFFIX_LIMIT`), essence-only excluded. The odds panel
  (phase 5) MUST reuse this same function, plus `homogenisedPool`/
  `catalysedPool` for omen-shaped pools.
- `actions.ts`: every mechanic is a `CraftAction` keyed by trade-API currency
  id. **Static orbs live in `ACTIONS`; data-driven currencies (essences,
  emotions, catalysts, alloys) resolve through `actionFor(data, id)`** —
  always dispatch through `actionFor`. `canApply(data, item, omens?)` returns
  a human-readable blocker or null; `apply(data, item, rng, omens?)` returns
  `{item, events, consumedOmens?}`. Omens are armed in the store
  (`armedOmens`), passed as a Set, and un-armed when an action reports them
  consumed. Omen interaction order is filter-then-select: Sinistral/Dextral
  side restrictions narrow candidates first, then Whittling's
  lowest-required-level pick runs inside that subset.
- `mechanics.ts`: THE ONLY place hand-encoded game rules live, every constant
  cites its source. Notable 0.5 facts encoded there (all web-verified July
  2026, sources in comments): **Omen of Whittling modifies the CHAOS ORB**
  (not annulment); Erasure omens = chaos, Annulment omens = annul,
  Crystallisation omens = Perfect/corrupted essences AND alloys;
  Sanctification = divine on rare, values ×0.78–1.22 rounded up, item locked
  forever (`sanctified` flag). Essences: Lesser/base/Greater upgrade
  Magic→Rare + guaranteed mod; Perfect + the six corrupted essences swap
  (remove random, add guaranteed) on rares, are blocked when the item already
  has the mod's group, and must remove from the guaranteed mod's side when it
  is full. Corrupted essences do NOT corrupt the item. Catalysts fit rings/
  amulets only (Refined set = jewels), quality-per-use scales with ilvl
  (approximated in `catalystQualityPerUse`), a different type replaces from
  zero, cap 20 raised by Essence of the Breach's mod. Vaal outcomes updated
  to the 0.5 community table (no change / chaos×1-3 / enchant /
  beyond-limits value multiply). `ALLOYS` maps alloy → itemClass →
  datamined `Alloy*` mod ids (weight 0 everywhere; integrity-tested).
- Items are immutable; RNG is injected (`seededRng` in tests, `liveRng` app).
  Item gained `sanctified?` and `quality?: {catalystId, percent}`;
  `effectiveValues()` applies catalyst quality at display time (stored rolls
  stay raw).

## Where to pick up: phase 5 notes

- **Odds panel**: hover a currency → distribution of outcomes. Reuse
  `rollablePool` + the omen pool shapers so displayed odds can never drift
  from `apply()`. Remember essence/alloy/emotion actions are deterministic
  adds (odds only on the removal side / value rolls).
- **Share links**: serialize `Session` (initial item + steps incl. `omens`)
  with lz-string into the URL hash. Events already carry everything the
  tutorial view needs. RNG replay is NOT required — steps store outcomes.
- **Tutorial mode**: step-through of `session.steps` with the stash
  highlighting the used currency (and armed omens) per step.

## Conventions & gotchas

- All relative imports in `src/` use explicit `.ts`/`.tsx` extensions
  (tsconfig.node is nodenext; pipeline scripts import engine code).
- Three tsconfig projects: app (browser, no node types), node (scripts),
  test (src tests + testutil get node types). `npm run build` type-checks all.
- Engine files must never import React or browser APIs.
- Commit style: conventional-ish prefixes (feat/fix/data/ci/test/chore),
  logical units per commit, Claude co-author trailer.
- `npm run data` = fetch → compile → validate. In restricted sandboxes use
  `npm run data:fetch -- --best-effort` (repoe + pathofexile.com + poecdn are
  often proxy-blocked; raw.githubusercontent.com/PoB usually reachable —
  compile carries the rest forward). `npm run data:oracle` needs
  `npm run data:fetch -- --oracle` first (CoE blob is oracle-only, never
  shipped). Re-running compile changes only meta.json's generatedAt unless
  upstream moved.
- Tests load the real committed bundle from `public/data/0.5/` (no mocks).
  `testutil.ts` has `rareWith()` (hand-built rare) and `pickPoolMods()`
  (deterministic pool picks) for golden tests.
- GitHub Pages must be enabled manually once: repo Settings → Pages →
  Source "GitHub Actions". BASE_PATH is set from the repo name in ci.yml.
- If the dev server acts up after `npm install <pkg>` (e.g. "Invalid hook
  call"), restart it — stale Vite dep pre-bundle.
- League data updates arrive via the weekly data-refresh workflow PR, or
  manually: `npm run data:fetch -- --force && npm run data`.

## Known issues / open verifications

- **Stat-scaling display bug (pre-phase-4)**: some datamined stats are stored
  in different units than their text implies — e.g. life regen is per-minute
  but the text says "per second", so a roll renders as "1992 Life
  Regeneration per second" (should be ~33). Needs a hand-encoded stat-scale
  table (÷60 for `*_per_minute`, ÷100 for permyriad-style stats) applied in
  `renderModText`/stat rendering. Do this early in phase 5/6.
- ItemCard shows **base** defence numbers only — mods (e.g. "42% increased
  Armour") are not folded in yet (phase 6 "computed defences").
- `TODO(0.5-verify)` markers in mechanics.ts: Greater/Perfect min mod level
  (50/70), Vaal weights + beyond-limits multiplier (1.1–1.3 guess), catalyst
  quality-per-use formula, catalysing-exaltation weight boost, jewel rare
  affix limit (2/2), essence/emotion ilvl gates, a few alloy slot mappings
  marked "uncorroborated" (Expansive gloves/boots, Celestial sceptre).
- Essence of the Abyss has no datamined class→mod map (PoB models it
  separately) — it's correctly unusable in the sim until mapped.
- Omens whose mechanics we don't simulate (map/ritual omens) render dimmed in
  the Omens tab.

## Verification bar (keep it)

Every phase so far shipped with: unit/property/golden tests on the engine
(71 passing — omen interaction order, essence family, catalysts, jewels),
statistical distribution tests where randomness matters, and for pool
correctness the Craft of Exile oracle (16 item classes, zero unexplained
differences). Phase 5's odds panel should get property tests asserting
displayed odds == empirical apply() distributions under seeded RNG. Run the
full gate before committing:
`npm run build && npm run lint && npm test && npm run data:validate`.
