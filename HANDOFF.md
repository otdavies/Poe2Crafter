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
| 5 | Odds panel (hover currency → hit chances), share links (lz-string URL hash), tutorial step-through mode | ✅ done |
| 6 | Keyboard shortcuts, computed defences (local mods folded into base stats), data-refresh automation PR flow (existed since phase 1) | ✅ done |
| 7 | Runes + Runeforging (0.5 league mechanic, 213 runes; bundle already has Runes category + Runemastered bases) | **⬅ NEXT** |

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

## How phase 5 is built (odds / share / tutorial)

- **Odds**: `src/engine/odds.ts` `oddsFor(data, item, currencyId, omens)`.
  Every `CraftAction` now carries a `kind` tag (+ `minModLevel` for tiered
  orbs) and actions.ts exports its plan/pool plumbing (`planRemoval`,
  `planAddition`, `additionPool`, `removalCandidates`,
  `requiredRemovalSide`, `alloyModId`, `validEmotionChoices`, `withoutMod`)
  so odds and apply() literally share code. Additions are grouped into mod
  families (key = generation + groups); chaos mixes the replacement pool
  exactly over each possible removal; Vaal folds impossible outcomes into
  "no change" the way apply() does. `odds.test.ts` asserts odds == empirical
  apply() distributions over 8k–20k seeded rolls (keep that invariant for
  any new mechanic). UI: `src/ui/OddsPanel.tsx`, shown for the hovered or
  held currency; family labels merge tier ranges via `familyText` in
  modtext.ts.
- **Share links**: `src/state/share.ts` — lz-string
  compressToEncodedURIComponent of `{v: 1, session}` in `#c=…`. Decode
  validates every base/mod id against the loaded bundle and rejects
  anything malformed. `init()` restores a valid hash straight into tutorial
  mode; the Share button writes the URL to the address bar + clipboard;
  reset() clears the hash.
- **Tutorial mode**: `replayIndex` in the store (0..steps.length = steps
  shown; undefined = live). `itemAt(session, i)` picks the displayed item;
  crafting/undo are guarded off while replaying. `TutorialBar` drives
  prev/next/exit; StashPanel gets `highlight` (pulses the next step's
  currency + omens, auto-switches to its tab) and `readOnly`; StepLog dims
  future steps and hides their outcomes (no spoilers), click jumps.

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

- ~~Stat-scaling display bug~~ fixed: `renderModText` linearly remaps rolled
  values from the stat range onto the text's display range (handles
  per-minute, permyriad, ×100 crit, negated "reduced" stats without unit
  tables). Odds/tooltip code in phase 5 should reuse it.
- ~~Base-only defence display~~ fixed: `src/engine/defences.ts`
  `computedProperties()` folds `local_*` flat + %-increased stats into the
  base numbers with the game's (base + flat) × (1 + Σ%/100) formula;
  augmented values render blue on the card. Known gaps (documented in the
  module header): hand-wraps per-character-level defences, spirit/accuracy
  (not in compiled base properties), weapon range. Keyboard shortcuts:
  Esc drop currency, Ctrl/Cmd+Z undo, ←/→ step in tutorial mode.
- `TODO(0.5-verify)` markers in mechanics.ts: Greater/Perfect min mod level
  (50/70), Vaal weights + beyond-limits multiplier (1.1–1.3 guess), catalyst
  quality-per-use formula, catalysing-exaltation weight boost, jewel rare
  affix limit (2/2), essence/emotion ilvl gates, a few alloy slot mappings
  marked "uncorroborated" (Expansive gloves/boots, Celestial sceptre).
- Essence of the Abyss has no datamined class→mod map (PoB models it
  separately) — it's correctly unusable in the sim until mapped.
- Omens whose mechanics we don't simulate (map/ritual omens) render dimmed in
  the Omens tab.
- Odds for multi-roll actions (Alchemy ×4, Greater Exaltation ×2) are
  per-roll: the exact joint distribution over shrinking pools isn't
  computed. The panel says so in a note; the odds tests only assert
  single-roll actions exactly.

## Verification bar (keep it)

Every phase so far shipped with: unit/property/golden tests on the engine
(94 passing — omen interaction order, essence family, catalysts, jewels,
display-unit remapping, odds-vs-empirical, share-link roundtrip, computed
defences),
statistical distribution tests where randomness matters, and for pool
correctness the Craft of Exile oracle (16 item classes, zero unexplained
differences). Phase 7 (Runeforging) should keep the pattern: mechanics
constants with cited sources, golden crafts, and odds-vs-empirical tests
for anything random. Run the full gate before committing:
`npm run build && npm run lint && npm test && npm run data:validate`.
