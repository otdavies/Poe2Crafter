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
| 6.5 | Desecration: abyssal bones + Well of Souls reveal (user request) | ✅ done |
| 7 | Runes + sockets (Artificer's Orb, 213 datamined runes, Runes tab) | ✅ done |
| 8 | Game-mimicry UI: character inventory (equipment doll + 12×5 backpack), stash Items tab (12×12), pick-up/put-down/swap/equip, multi-item crafting (standing user goal: "fully mimic the in-game UI") | ✅ done |
| 8.5 | Game-mimicry follow-ups (user feedback): hover-only item tooltip, item art from poe2wiki, currency tab laid out like the premium tab (family grid + crafting slot + wildcards), currencies as draggable 1×1 stacks (left-click takes, right-click uses, merge/consume) | ✅ done |
| 8.6 | Currency effects in the hover tooltip (user feedback): hovering any currency slot/stack shows its effect on the active item (odds body) in the tooltip; the standalone centre odds window removed — the game explains usage exclusively through tooltips | ✅ done |
| 9 | Game-mimicry polish: weapon-set I/II slots, hold-drag in addition to click-carry, shift-click stack splitting, Verisium Anvil once formula is known | **⬅ NEXT** |

Recombination is deliberately out of scope (disabled in 0.5 anyway). The
Verisium Anvil (spend Verisium for Runic Ward / base upgrades) is deferred:
no source publishes its cost/ward formula — needs in-game numbers.

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
  any new mechanic). UI: `src/ui/CurrencyCard.tsx` — the odds body renders
  inside the currency hover tooltip (stash slots and placed stacks), like
  the game, which explains usage exclusively through tooltips. There is no
  standalone odds window. Family labels merge tier ranges via `familyText`
  in modtext.ts.
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

## Desecration (abyssal bones, post-phase-6)

Bones desecrate a RARE item; the Well of Souls offers THREE desecrated
modifiers and the player keeps one (`src/engine/desecrate.ts`; rules +
sources in mechanics.ts `BONES`). Key facts: one desecrated mod per item;
full items lose a random mod first; Gnawed = ilvl ≤ 64 targets, Ancient =
min modifier level 40; desecrated mods IGNORE the item-level gate (proof
in mechanics.ts). Omens: Sovereign/Liege/Blackblooded restrict the offer
to one abyssal lord; Sinistral/Dextral Necromancy force the side;
Putrefaction replaces ALL mods with desecrated ones + corrupts (no
reveal); Abyssal Echoes lets the UI reroll the offer once; Omen of Light
makes ANNULMENT remove only desecrated mods (in planRemoval).
Data: compile.ts imports the repoe `desecrated` domain (equipment + jewel
targets; waystone/kulemak/watcher/breach variants excluded) with
`desecrated: true` + `lord` on the Mod; **EngineData.affixPool excludes
them** (desecratedPool is separate — never let them leak into
rollablePool). Bones are curated currency entries (category "Abyss",
ids/icons from Exiled Exchange 2's dataset) because the carried-forward
trade snapshot predates them. repoe sources now have a
raw.githubusercontent mirror fallback (sources.ts) so sandboxes can
refetch. The interactive flow is store-level: `pendingReveal` +
`chooseReveal`/`rerollPendingReveal`; the bone CraftAction auto-picks
uniformly (odds/tests only). Steps record the outcome, so share links and
tutorial replay work unchanged. Out of scope: Preserved Vertebrae
(waystones, shown dimmed) and Altered Collarbone (breach-ring
desecration).

## Runes + sockets (phase 7)

0.5 "Runes of Aldur" socketables. Data: `public/data/0.5/runes.json` (213
runes) compiled from the repoe `augments.json` export joined with
base_items for names and the trade snapshot for ids/icons (join asserted
in validate.ts; `tradeSlug` now keeps unicode letters —
"legacy-of-mjölner"). Each rune has per-host-class effect variants with
FIXED values embedded in the text (no rolls; bonded_stat_text = Shaman
ascendancy passives, not compiled). Rules in mechanics.ts `SOCKET_MAX`:
body armours + two-handers hold 2 sockets, other socketable classes 1,
jewellery/quivers/jewels none; Artificer's Orb (`ARTIFICER`) adds one.
Engine: `src/engine/runes.ts` (canAddSocket / canSocketRune / socketRune /
runeEffectFor); `Item.sockets: (string|null)[]`; socketing into an
occupied socket DESTROYS the old rune; limit groups from the datamine
(`limit: "self" | "ancient" | "aldurs-legacy"` = one per item, ignoring
the socket being overwritten). Rune local stats fold into
computedProperties by zipping the numbers in the effect text with its stat
ids (display units — no datamine scale). UI: Runes stash tab (15-kind ×
4-tier grid + Runecrafted/Warding/Ancient/Fabled/Legacy sections), socket
circles on the item card (click a circle to socket the held rune into
exactly that socket; empty circles are pointer-events:none so card clicks
pass through), rune lines render blue with a "(rune)" tag. The store's
`applySelected(socketIndex?)` carries the clicked socket. Everything is
deterministic — odds show the granted effect text as notes.

**Masterwork Rune** (`mechanics.MASTERWORK_RUNE`) is NOT socketed — it
"Upgrades a socketed Rune" one tier along the Lesser → base → Greater →
Perfect ladder (`RUNE_TIERS`). It lives in the rune bundle but `actionFor`
intercepts it to a dedicated `rune_upgrade` action (`applyMasterwork`;
`runes.ts` `upgradedRuneId`/`canMasterwork`/`masterworkUpgrade`); the store
routes it through the same socket-click path as ordinary runes, upgrading
whichever socketed rune the player clicks. A Perfect or tier-less special
rune (Ancient/Aldur's) has no higher tier and is blocked. **Non-simulated
special runes** — the Aldur elemental-conversion breaths, Cadigan's Epiphany
(jewel socket), Aldur's Legacy (consume unique) — carry a
`dummy_display_stat_rune_*` placeholder instead of a rollable stat.
`runes.ts` `runeSpecialEffect` detects them and `canSocketRune` blocks them
with `Not simulated: <effect prose>` rather than socketing an inert no-op
that would misrepresent the item (e.g. a Betrayal of Aldur leaving fire mods
untouched).

## Game-accurate tooltip (user feedback, post-phase-6)

Ongoing mission: the UI should match the in-game look as closely as
possible — check reference screenshots when styling. The item card now
mirrors the game tooltip: per-rarity name plate (rares show a flavour name
above the base name — deterministic from base+ilvl, word pools in
`src/ui/itemname.ts` are hand-picked flavour, NOT datamined; magic items
weave the datamined affix names around the base name), centred stat lines,
golden separators, enchant (corruption) / implicit / explicit sections.
Holding **Alt** (or the topbar "Alt info" toggle) shows advanced mod
descriptions like the game: an `Item Level:` line, per-mod grey headers
`Prefix Modifier "Hale" (Tier: 7) — Life`, and roll ranges after each
value (`renderModTextRanges`; ranges always display low→high). Tiers come
from `src/engine/tiers.ts`: **Tier 1 is the STRONGEST** (0.5, verified in
game by the project owner — an earlier count-up encoding was reversed on
their feedback) — the ladder is every same-generation/same-group mod
spawnable on the base ignoring ilvl; essence-only mods are inserted into
the same ladder (approximation). Tag lists shown are the mod's
catalystTags minus compound `a_b` duplicates. The base picker shows a
live ItemCard preview that IS the starting item (startCraft takes the
built Item, implicit rolls included).

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
- Essence of Delirium's Body Armour mod (`EssenceGrantedPassive`) allocates a
  random Notable Passive Skill. The datamine ships it text-less, so
  `compile.ts` `SPECIAL_MOD_TEXT` substitutes a faithful summary ("Allocates a
  random Notable Passive Skill") — the specific notable is not modelled.
  `validate.ts` now fails on any blank guaranteed essence/emotion mod so this
  can't regress. Quality currencies (Blacksmith's Whetstone, Armourer's Scrap,
  Arcanist's Etcher, Glassblower's Bauble, Gemcutter's Prism) are not yet
  modelled — flagged in `currency-coverage.test.ts` OUT_OF_SCOPE.
- Omens whose mechanics we don't simulate (map/ritual omens) render dimmed in
  the Omens tab.
- Odds for multi-roll actions (Alchemy ×4, Greater Exaltation ×2) are
  per-roll: the exact joint distribution over shrinking pools isn't
  computed. The panel says so in a note; the odds tests only assert
  single-roll actions exactly.
- Desecration `TODO(0.5-verify)` markers: whether quivers/talismans belong
  to the jawbone or collarbone matrix; removal side when a necromancy omen
  is armed on a full item; Putrefaction vs fractured mods; Ancient's
  min-modifier-level 40 is vacuous against the current datamine (every
  equipment desecrated mod requires level 65). Bone odds show single-draw
  weights with a "choice of 3" note — the pick itself is the player's.
- Rune `TODO(0.5-verify)` markers (mechanics.ts SOCKET_MAX): caster-weapon
  and talisman socket capacity (staff treated as two-handed = 2); the
  Ancient-augment limit is per CHARACTER in guides, encoded per item;
  whether socketing bypasses the corrupted-items-can't-change rule
  (currently blocked). Soul Cores / Idols / Abyssal Eyes are datamined in
  augments.json but not compiled (character-build socketables, absent from
  the trade snapshot). Emergent/Tempered runes are compiled but invisible
  in the stash until a trade snapshot lists them.

## Game-mimicry inventory (phase 8)

The app is laid out like the game's stash screen: stash panel left, item
tooltip column centre, character inventory right.

- Geometry (`engine/grid.ts`): backpack 12×5, stash tab 12×12 (game8
  491346, poe2wiki Stash). Item footprints come from the datamine's
  `inventory_width/height` already in bases.json (body 2×3, two-handers /
  bows / crossbows 2×4, spears & staves 1×4, daggers & wands 1×3, …).
  `canPlace`/`findSpot` (row-major first fit) are pure and tested.
- Equipment doll (`engine/grid.ts` + `ui/InventoryPanel.tsx`): main hand /
  off-hand / helmet / body / gloves / boots / belt / amulet / 2 rings,
  positioned like the game screen; flask + charm slots are rendered but
  not simulated. Slot acceptance from base tags: `two_hand_weapon` locks
  the off-hand (bow + quiver excepted), one-handers dual-wield, talismans
  are two-handed caster weapons. Weapon-set I/II swap not modelled yet.
- State (`state/store.ts`): multiple crafts, each `{ key, session, place |
  equipped }`. Game-style cursor: click picks an item up (`pickUp`), click
  a cell puts it down (`putDown`, swaps with a single blocker), doll slots
  equip (`equipHeld`), ctrl+click quick-moves inventory ⇄ stash, Escape
  returns (`returnHeld`), Delete destroys (`discardHeld`). Crafting
  targets the item you click (`applyTo(key)`), so several items can be
  worked on side by side; undo/tutorial/share act on the ACTIVE craft.
- Item art: PoE2's own CDN serves only signed image URLs
  (`/gen/image/<payload>/<sig>/…`), so tiles load base art from poe2wiki's
  `Special:FilePath/<Base Name> inventory icon.png` (stable, unsigned;
  verified the naming convention exists per item class). On any load
  failure the tile falls back to a rarity-framed name plate — the sandbox
  can't reach the wiki, so art was NOT visually verified here; check in a
  real browser. The canonical `art` path is also compiled into bases.json
  for a future resolver.
- The item tooltip shows only while hovering an item (grid tile or doll
  slot), floating next to it like the game; the persistent centre card
  remains only in tutorial replay. Rune sockets render as dots on the tile
  itself and become click targets while a rune is armed.
- Hovering any currency — a stash slot or a placed stack — shows a currency
  tooltip (`ui/CurrencyCard.tsx`): name/icon (+ count/cap for stacks), its
  concrete effect on the active item (the oddsFor body: adds/removes/
  outcomes, or the red blocked reason), and a click-usage hint. The old
  standalone centre odds window is gone; the game explains usage
  exclusively through tooltips and so do we. The centre column now holds
  only the step log (plus tutorial bar/card in replay).
- Currencies are ordinary 1×1 stackable items (phase 8.5): left-click a
  stash slot takes a full stack onto the cursor (datamined stack sizes in
  currency.json: exalts 20, essences/runes/omens 10), stacks place into
  any grid, merge onto same-currency stacks up to the cap, quick-move, and
  swap. RIGHT-click readies a currency for use, exactly like the game —
  from the stash tab (infinite) or from a placed stack, which is consumed
  one per application and disarms when it runs out. Omens keep click-to-arm.
- The Currency tab mirrors the premium tab: orb families as rows ×
  Orb/Greater/Perfect columns, the single orbs beside them, a central
  crafting slot (container "curtab", holds one item — crafting works while
  it sits there) and 14 wildcard slots ("curwild", stackables only).
- The base picker is now an overlay (auto-opens when nothing is crafted;
  "New base" in the inventory footer).

## Verification bar (keep it)

Every phase so far shipped with: unit/property/golden tests on the engine
and store (173 passing — omen interaction order, essence family, catalysts, jewels,
display-unit remapping, odds-vs-empirical, share-link roundtrip, computed
defences, tier numbering, item naming, advanced-range rendering,
desecration reveal/omens/putrefaction, rune sockets/limits/folding,
Masterwork tier-upgrade, non-simulated special-rune blocking,
passive-granting essence text, an exhaustive currency-coverage ledger that
dispatches every craftable currency through the real odds/canApply plumbing,
grid placement/equip rules, store pickup/swap/quick-move, currency
stacks take/merge/consume),
statistical distribution tests where randomness matters, and for pool
correctness the Craft of Exile oracle (16 item classes, zero unexplained
differences). New phases should keep the pattern: mechanics
constants with cited sources, golden crafts, and odds-vs-empirical tests
for anything random. Run the full gate before committing:
`npm run build && npm run lint && npm test && npm run data:validate`.
