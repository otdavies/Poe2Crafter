/**
 * Hand-encoded game rules that exist nowhere in datamined form — only in
 * item description strings, patch notes, and community testing. This file
 * is deliberately the single place where PoE2 0.5.x rules live by hand;
 * every constant cites its source. Verify on each patch.
 */
import type { AbyssalLord } from "../data/schema.ts";

/**
 * Greater/Perfect currency variants only roll mods whose required level is
 * at least this. Source: 0.4.0 patch notes; carried into 0.5.
 * TODO(0.5-verify): spot-check in game — community consensus is 50/70.
 */
export const MIN_MOD_LEVEL = { normal: 0, greater: 50, perfect: 70 } as const;
export type CurrencyTier = keyof typeof MIN_MOD_LEVEL;

/** Orb of Alchemy: "Upgrades a Normal item to a Rare item with 4 modifiers". */
export const ALCHEMY_MOD_COUNT = 4;

/**
 * Max explicit mods of one generation type (prefix or suffix).
 * Equipment: magic 1/1, rare 3/3 (item text / universally documented).
 * Jewels: magic 1/1, rare 2/2 (4 mods total, PoE1-carryover consensus).
 * TODO(0.5-verify): rare-jewel affix limit — poe2wiki unreachable when encoded.
 */
export const AFFIX_LIMIT = {
  equipment: { normal: 0, magic: 1, rare: 3 },
  jewel: { normal: 0, magic: 1, rare: 2 },
} as const;

/**
 * Vaal Orb outcome table for rare equipment, 0.5. Community-documented
 * (maxroll.gg/poe2/resources/corruption-outcomes, timesaver.gg 0.5 Vaal
 * guide): four buckets at ~25% each — no change / chaos-like effect applied
 * 1-3 times / add a corruption enchantment (slot pool) / "push beyond normal
 * limits". APPROXIMATION: weights are server-side and never datamined.
 */
export const VAAL_OUTCOMES = [
  { kind: "no_change", weight: 1 },
  { kind: "chaos", weight: 1 },
  { kind: "enchant", weight: 1 },
  { kind: "beyond_limits", weight: 1 },
] as const;
export type VaalOutcomeKind = (typeof VAAL_OUTCOMES)[number]["kind"];

/** Vaal "chaos-like effect applied 1-3 times" repetition bounds (see above). */
export const VAAL_CHAOS_TIMES = { min: 1, max: 3 } as const;

/**
 * Vaal "beyond limits": 0.5.0 patch notes — "now multiplies each modifier
 * based on the current value, instead of randomising the value".
 * APPROXIMATION: the multiplier range is not documented anywhere; values may
 * exceed the mod's normal roll range. TODO(0.5-verify).
 */
export const VAAL_BEYOND_LIMITS_MULTIPLIER = { min: 1.1, max: 1.3 } as const;

/**
 * Omen of Sanctification: "your next Divine Orb used on a Rare item will
 * Sanctify it" — each modifier value is multiplied by a random 0.78x-1.22x
 * (rounded up) and the item becomes Sanctified (unmodifiable, like
 * corruption). Source: poe2wiki Omen_of_Sanctification, timesaver.gg 0.5
 * sanctification guide.
 */
export const SANCTIFY_MULTIPLIER = { min: 0.78, max: 1.22 } as const;

/**
 * Crafting omens by trade id — description texts from poe2wiki per-omen
 * pages (0.5-current). Sinistral = prefixes, Dextral = suffixes. Omens are
 * armed before a currency use and consumed by it; related omens stack
 * (e.g. Greater + Sinistral Exaltation = two prefixes), and effects that
 * modify the added modifier apply to every added modifier.
 *
 * NOTE 0.5: Omen of Whittling modifies the CHAOS ORB ("your next Chaos Orb
 * will remove the lowest level modifier" — lowest required item level, ties
 * random). Omen of Corruption was removed in 0.5.0.
 */
export const OMEN = {
  /** Chaos Orb removes the lowest-required-level modifier. */
  whittling: "omen-of-whittling",
  /** Chaos Orb removes only prefixes / only suffixes. */
  sinistralErasure: "omen-of-sinistral-erasure",
  dextralErasure: "omen-of-dextral-erasure",
  /** Orb of Annulment removes only prefixes / only suffixes. */
  sinistralAnnulment: "omen-of-sinistral-annulment",
  dextralAnnulment: "omen-of-dextral-annulment",
  /** Exalted Orb adds only prefixes / only suffixes. */
  sinistralExaltation: "omen-of-sinistral-exaltation",
  dextralExaltation: "omen-of-dextral-exaltation",
  /** Exalted Orb adds two random modifiers. */
  greaterExaltation: "omen-of-greater-exaltation",
  /**
   * Exalted Orb adds a modifier "of the same type as an existing Modifier"
   * (shared catalyst tag). Drop-disabled since 0.4.0 but still functional.
   */
  homogenisingExaltation: "omen-of-homogenising-exaltation",
  /** Regal Orb variant of the above. */
  homogenisingCoronation: "omen-of-homogenising-coronation",
  /** Divine Orb on a rare item Sanctifies it (see SANCTIFY_MULTIPLIER). */
  sanctification: "omen-of-sanctification",
  /** Perfect/Corrupted Essences (and Alloys) remove only prefixes/suffixes. */
  sinistralCrystallisation: "omen-of-sinistral-crystallisation",
  dextralCrystallisation: "omen-of-dextral-crystallisation",
  /**
   * Exalted Orb consumes all catalyst quality "to increase the chance of the
   * corresponding type of Modifier". APPROXIMATION: the magnitude is not
   * documented; we multiply matching mods' weights by (1 + quality%).
   * TODO(0.5-verify).
   */
  catalysingExaltation: "omen-of-catalysing-exaltation",

  // --- Desecration omens (abyss, 0.3+; 0.5-current) -------------------------
  // Effects verified July 2026 via mmoso "Well of Souls and Desecrated
  // Modifiers Explained", conquestcapped abyss guide, poe2wiki
  // Desecrated_modifier (search-verified — pages themselves bot-walled).
  /** Desecration reveals only Ulaman modifiers. */
  sovereign: "omen-of-the-sovereign",
  /** Desecration reveals only Amanamu modifiers. */
  liege: "omen-of-the-liege",
  /** Desecration reveals only Kurgal modifiers. */
  blackblooded: "omen-of-the-blackblooded",
  /** Desecration adds only a prefix / only a suffix. */
  sinistralNecromancy: "omen-of-sinistral-necromancy",
  dextralNecromancy: "omen-of-dextral-necromancy",
  /**
   * "Replaces all modifiers with six Desecrated modifiers and corrupts the
   * item" (equipment: 3 prefixes + 3 suffixes; jewels use their own affix
   * limit). TODO(0.5-verify): exact interaction with fractured mods.
   */
  putrefaction: "omen-of-putrefaction",
  /** The Well of Souls reveal can be rerolled (one extra set of choices). */
  abyssalEchoes: "omen-of-abyssal-echoes",
  /** Orb of Annulment removes only Desecrated modifiers. */
  light: "omen-of-light",
} as const;
export type OmenId = (typeof OMEN)[keyof typeof OMEN];

/**
 * The six corrupted essences: Perfect-essence mechanic (remove a random
 * modifier, add the guaranteed one, on a rare item). They do NOT corrupt the
 * target. Source: poe2wiki per-essence pages; timesaver.gg 0.5 crafting
 * guide ("perfect and corrupted essences will remove a random modifier and
 * augment a rare item with a new one").
 */
export const CORRUPTED_ESSENCES = new Set([
  "Essence of Delirium",
  "Essence of Horror",
  "Essence of Hysteria",
  "Essence of Insanity",
  "Essence of the Abyss",
  "Essence of the Breach",
]);

export type EssenceTier = "upgrade" | "swap";

/**
 * Essence application by name. Lesser/base/Greater essences "upgrade a Magic
 * item to a Rare item, adding a guaranteed modifier"; Perfect and corrupted
 * essences "remove a random modifier and augment a Rare item with a new
 * guaranteed modifier". A swap essence "cannot be used on an item that has
 * the same type of modifier the Essence provides", and when the guaranteed
 * mod's affix side is full, the removed mod is guaranteed to come from that
 * side. Sources: poe2wiki Essence, mobalytics essence guide (0.3-0.5).
 */
export function essenceTier(name: string): EssenceTier {
  return name.startsWith("Perfect ") || CORRUPTED_ESSENCES.has(name) ? "swap" : "upgrade";
}

/**
 * Catalysts add quality to RINGS and AMULETS only in PoE2 ("Adds quality
 * that enhances X Modifiers on a Ring or Amulet" — belts are a PoE1
 * carryover error on some wikis). The 0.5.0 "Refined" set applies the same
 * quality types to JEWELS. Quality multiplies the values of matching-tag
 * modifiers (implicit and explicit): +60 life at 20% Flesh quality = +72.
 * Applying a different catalyst type replaces the old quality, starting
 * again from zero. Sources: poe2wiki Catalyst/Quality, 0.5.0 + 0.5.2 patch
 * notes (Necrotic Catalyst, Refined set), timesaver.gg 0.5 catalyst guide.
 */
export interface CatalystSpec {
  /** Mod tag (bundle `catalystTags`) whose modifiers this quality boosts. */
  tag: string;
  /** Item classes the catalyst can be applied to. */
  itemClasses: readonly string[];
}

const JEWELLERY = ["Ring", "Amulet"] as const;
const JEWEL = ["Jewel"] as const;

const CATALYST_TAGS: Record<string, string> = {
  flesh: "life",
  neural: "mana",
  carapace: "defences",
  "uul-netols": "physical",
  xophs: "fire",
  tuls: "cold",
  eshs: "lightning",
  chayulas: "chaos",
  reaver: "attack",
  sibilant: "caster",
  skittering: "speed",
  adaptive: "attribute",
  necrotic: "minion",
};

export const CATALYSTS: ReadonlyMap<string, CatalystSpec> = new Map(
  Object.entries(CATALYST_TAGS).flatMap(([name, tag]): [string, CatalystSpec][] => [
    [`${name}-catalyst`, { tag, itemClasses: JEWELLERY }],
    [`refined-${name}-catalyst`, { tag, itemClasses: JEWEL }],
  ]),
);

/** Base maximum catalyst quality (Essence of the Breach's mod raises it). */
export const MAX_QUALITY = 20;

/** Bundle stat id of "+X% to Maximum Quality" (Essence of the Breach). */
export const MAX_QUALITY_STAT = "local_maximum_quality_+";

/**
 * Quality added per catalyst use scales with item level — "a larger bonus to
 * lower item levels, up to a maximum of 20%"; roughly 1-2% per use at
 * endgame levels (10-20 uses to cap a standard ring). APPROXIMATION: the
 * exact breakpoint table is not published anywhere; this formula matches the
 * documented anchors (poe2wiki Quality, timesaver.gg/ssegold 0.5 guides).
 * TODO(0.5-verify).
 */
export function catalystQualityPerUse(ilvl: number): number {
  return Math.min(20, Math.max(2, Math.ceil(20 - ilvl / 4)));
}

/**
 * Fracturing Orb: "Fractures a random Explicit Modifier on a Rare item with
 * at least 4 Explicit Modifiers, making that modifier impossible to change."
 * One fractured mod max. Source: poe2wiki Fracturing_Orb (unchanged in 0.5).
 */
export const FRACTURE_MIN_EXPLICITS = 4;

/**
 * Verisium Alloys (0.5 "Runes of Aldur"): applied to a RARE item; remove one
 * random modifier and add a guaranteed alloy-exclusive modifier decided by
 * alloy type + item class (Perfect-essence mechanic; crystallisation omens
 * apply). Mod ids are datamined (bundle `Alloy*`, spawn weight 0 — never in
 * the natural pool); the alloy->slot mapping below is hand-joined from
 * game8.co per-alloy pages (archives 603253-603265) + fextralife, matched to
 * bundle mod texts. TODO(0.5-verify): entries marked "uncorroborated" were
 * matched from a single source or by elimination.
 */
const MARTIAL_WEAPONS = [
  "Bow", "Claw", "Crossbow", "Dagger", "Flail", "Spear", "Warstaff",
  "One Hand Axe", "One Hand Mace", "One Hand Sword",
  "Two Hand Axe", "Two Hand Mace", "Two Hand Sword",
] as const;
const CASTER_WEAPONS = ["Wand", "Staff", "Sceptre"] as const;
const ALL_WEAPONS = [...MARTIAL_WEAPONS, ...CASTER_WEAPONS, "Talisman"] as const;
const BODY_ARMOUR_SLOTS = [
  "Body Armour", "Helmet", "Gloves", "Boots", "Shield", "Buckler", "Focus",
] as const;

/**
 * itemClass -> guaranteed mod id(s). When several tiers exist, ids are
 * ordered by mod required level; the highest one the item's ilvl allows is
 * granted.
 */
export type AlloySpec = Readonly<Record<string, readonly string[]>>;

function spec(entries: [classes: readonly string[], mods: string[]][]): AlloySpec {
  const record: Record<string, readonly string[]> = {};
  for (const [classes, mods] of entries) {
    for (const itemClass of classes) record[itemClass] = mods;
  }
  return record;
}

export const ALLOYS: ReadonlyMap<string, AlloySpec> = new Map([
  ["runic-alloy", spec([
    [["Ring"], ["AlloyMaximumRunicWard1"]],
    [["Amulet"], ["AlloyMaximumRunicWardPercent1"]],
    [["Belt"], ["AlloyRunicWardRechargeRate1"]],
  ])],
  ["adaptive-alloy", spec([
    [["Staff"], ["AlloyDamageAsExtraFireTwoHandWhileMissingRunicWard1"]],
    [["Wand"], ["AlloyDamageAsExtraFireWhileMissingRunicWard1"]],
    [["Sceptre"], ["AlloyPuppetMasterChance1"]],
    [["Gloves"], ["AlloyAttackSpeedIfMissingWardRecently1"]],
  ])],
  ["protective-alloy", spec([
    [["Belt"], ["AlloyRecoverRunicWardOnCharmUse1"]],
    [["Shield", "Buckler"], ["AlloyRunicWardOnBlock1"]],
    [ALL_WEAPONS, ["AlloyMaximumRunicWardWeapon1"]],
  ])],
  ["expansive-alloy", spec([
    [["Body Armour"], ["AlloyPresenceAreaOfEffect1"]],
    [["Helmet"], ["AlloyManaCostEfficiency1"]],
    [["Gloves"], ["AlloyRemnantPickupRange1"]], // uncorroborated (boostmatch)
    [["Boots"], ["AlloyTemporaryMinionSkillLimit1"]], // uncorroborated
  ])],
  ["swift-alloy", spec([
    [["Gloves"], ["AlloyCastSpeedGloves1"]],
    [["Ring"], ["AlloyAttackSpeedRing1"]],
    [["Belt"], ["AlloyFlaskChargesPerSecond1"]],
    [["Shield", "Buckler", "Focus"], ["AlloyTotemPlacementSpeed1"]],
  ])],
  ["cyclonic-alloy", spec([
    [["Body Armour"], ["AlloyReducedSlowPotency1"]],
    [["Boots"], ["AlloySkillEffectDuration1"]],
    [["Gloves"], ["AlloyDamagingAilmentDuration1"]],
    [["Helmet"], ["AlloyArchonDuration1"]],
  ])],
  ["prismatic-alloy", spec([
    [["Gloves"], ["AlloyElementalPenetration1"]],
    [MARTIAL_WEAPONS, ["AlloyAilmentMagnitude1"]],
    [["Focus", "Staff", "Wand"], ["AlloyExposureEffect1"]],
    [["Sceptre"], ["AlloyMinionDamagingAilmentMagnitude1"]],
  ])],
  ["mystic-alloy", spec([
    [["Helmet"], ["AlloySpellAreaOfEffect1"]],
    [["Gloves"], ["AlloyAttackAreaOfEffect1"]],
    [["Boots"], ["AlloySpiritOnBoots1"]],
    [["Quiver"], ["AlloyChanceToChain1"]],
    [["Wand", "Staff"], ["AlloyMaximumElementalInfusions1"]],
  ])],
  ["sovereign-alloy", spec([
    [ALL_WEAPONS, ["AlloyEffectOfSocketedAugments1"]],
    [BODY_ARMOUR_SLOTS, ["AlloyLocalWardIncreasePercent1", "AlloyLocalWardIncreasePercent2"]],
    [["Ring", "Amulet", "Belt"], ["AlloyEffectOfResistanceMods1"]],
  ])],
  ["celestial-alloy", spec([
    [["Wand", "Staff"], ["AlloySpellLevelManaHybrid1"]],
    [["Sceptre"], ["AlloyManaNearbyAllyAttackSpeedHybrid1"]], // uncorroborated (by elimination)
    [MARTIAL_WEAPONS, ["AlloyAccuracyAttackSpeedHybrid1"]],
  ])],
  ["transcendent-alloy", spec([
    [["Staff"], ["AlloyCastSpeedDamageAsExtraColdHybrid1"]],
    [["Wand"], ["AlloyCastSpeedDamageAsExtraColdHybridOneHand1"]],
    [MARTIAL_WEAPONS, ["AlloyAttributeIncreasedLocalPhysicalDamageHybrid1"]],
  ])],
  ["the-runebinders-alloy", spec([
    [["Staff"], ["AlloyNaturesArchon1"]],
    [["Wand"], ["AlloyElementalSkillLimit1"]],
    [["Sceptre"], ["AlloyPuppeteerStacks1"]],
    [["Crossbow"], ["AlloyBallistaLimit1"]],
    [["Bow"], ["AlloyMarkEffect"]],
  ])],
  ["the-runefathers-alloy", spec([
    [["One Hand Mace", "Two Hand Mace"], ["AlloyRetainGlory1"]],
    [["Warstaff"], ["AlloyBellLimit1"]],
    [["Spear"], ["AlloyMeleeStrikeRange1"]],
    [["Talisman"], ["AlloyLightningDamageIgnites1"]],
  ])],
]);

/**
 * Desecration (abyssal bones + Well of Souls, 0.3 "The Third Edict",
 * current in 0.5). Using a bone on a matching RARE item desecrates it; the
 * Well of Souls reveal offers a choice of THREE desecrated modifiers and
 * you keep exactly one. If all affix slots are full, a random modifier is
 * removed first to make room. An item can hold only ONE desecrated
 * modifier ("items with Desecrated Modifiers cannot be Desecrated again").
 * Corrupted/Sanctified items can't be desecrated. The simulator collapses
 * bone + Well visit into a single action.
 *
 * Bone matrix (sources, July 2026: poe.ninja 0.5 bone list, timesaver.gg
 * desecrated-currency guide, game8 550255, u4n cranium/vertebrae pages,
 * playerauctions + mmoso mechanics guides):
 * - Jawbone -> weapons, Rib -> armour, Collarbone -> jewellery,
 *   Preserved Cranium -> jewels, Preserved Vertebrae -> waystones (not
 *   simulated — no waystones here).
 * - Gnawed: only desecrates items of item level 64 or lower.
 * - Preserved: no restriction.
 * - Ancient: revealed modifiers have a minimum modifier level of 40.
 *   NOTE: vacuous against the current datamine (every equipment desecrated
 *   mod requires level 65) but encoded for faithfulness. The same datamine
 *   proves reveals ignore the usual item-level gate: Gnawed bones (ilvl
 *   <= 64 items) grant mods whose required level is 65.
 * TODO(0.5-verify): whether quivers/talismans sit in the jawbone or
 * collarbone matrix — datamined spawn tags cover both classes.
 */
export interface BoneSpec {
  /** Item classes this bone can desecrate. */
  itemClasses: readonly string[];
  /** Gnawed: only items of this level or lower can be desecrated. */
  maxItemLevel?: number;
  /** Ancient: revealed mods must require at least this level. */
  minModLevel?: number;
}

export const GNAWED_MAX_ITEM_LEVEL = 64;
export const ANCIENT_MIN_MOD_LEVEL = 40;
/** The Well of Souls reveals this many modifiers; you choose one. */
export const DESECRATION_CHOICES = 3;

const JAWBONE = [...ALL_WEAPONS, "Quiver"] as const;
const RIB = BODY_ARMOUR_SLOTS;
const COLLARBONE = ["Ring", "Amulet", "Belt"] as const;

export const BONES: ReadonlyMap<string, BoneSpec> = new Map([
  ["gnawed-jawbone", { itemClasses: JAWBONE, maxItemLevel: GNAWED_MAX_ITEM_LEVEL }],
  ["gnawed-rib", { itemClasses: RIB, maxItemLevel: GNAWED_MAX_ITEM_LEVEL }],
  ["gnawed-collarbone", { itemClasses: COLLARBONE, maxItemLevel: GNAWED_MAX_ITEM_LEVEL }],
  ["preserved-jawbone", { itemClasses: JAWBONE }],
  ["preserved-rib", { itemClasses: RIB }],
  ["preserved-collarbone", { itemClasses: COLLARBONE }],
  ["preserved-cranium", { itemClasses: ["Jewel"] }],
  ["ancient-jawbone", { itemClasses: JAWBONE, minModLevel: ANCIENT_MIN_MOD_LEVEL }],
  ["ancient-rib", { itemClasses: RIB, minModLevel: ANCIENT_MIN_MOD_LEVEL }],
  ["ancient-collarbone", { itemClasses: COLLARBONE, minModLevel: ANCIENT_MIN_MOD_LEVEL }],
]);

/** Omen -> the abyssal lord whose modifiers the reveal is restricted to. */
export const LORD_OMENS: ReadonlyMap<string, AbyssalLord> = new Map([
  [OMEN.sovereign, "ulaman"],
  [OMEN.liege, "amanamu"],
  [OMEN.blackblooded, "kurgal"],
]);

/**
 * Liquid Emotions on jewels (0.5.0): "Liquid Emotions can now be used to
 * craft additional mods on Jewels. These work similarly to greater essences,
 * each having a set of specific mods that will replace a random existing mod
 * on the item." One emotion per use, on a RARE jewel; regular emotions
 * target regular jewels, Ancient emotions target Time-Lost jewels. The
 * added mod's affix side is fixed per emotion + jewel base (bundle data);
 * Potent emotions list both sides — one valid side is picked at random.
 * Amulet instilling (anoints) is out of scope (needs passive-tree data).
 * Sources: 0.5.0 patch notes (via maxroll mirror), poe2wiki Liquid_Emotion.
 */
export const TIME_LOST_PREFIX = "Time-Lost ";

/**
 * Rune sockets (0.5 "Runes of Aldur").
 *
 * Socket capacity: body armours and two-handed weapons hold up to TWO
 * sockets, every other socketable class holds ONE (mobalytics
 * "runes-sockets", game8 archive 489096, maxroll "runes-and-soul-cores").
 * Quivers, jewellery, charms and jewels cannot have sockets. Sockets are
 * added with an Artificer's Orb (10 Artificer's Shards = 1 orb; shards are
 * salvage output, not a craft action). Caster weapons and talismans are
 * socketable — the datamined augment pool carries dedicated Wand/Staff/
 * Sceptre/Talisman effects and the wiki's Artificer's Orb text names wands
 * and staves. TODO(0.5-verify): caster-weapon and talisman socket CAPACITY
 * (staff treated as two-handed here) — early-access sources disagree and
 * 0.5 changed several socket rules.
 *
 * Socketing: a rune in an empty socket is permanent; socketing into an
 * occupied socket DESTROYS the old rune and replaces it (0.1.1+ patch
 * behaviour, still current — game8 archive 604673 "How to Remove Runes").
 * Rune effects are fixed values (no rolls). Limits from the datamine:
 * `limit: 1` runes allow one copy per item; Ancient runes and Aldur's
 * Legacy runes allow one of their group per item. TODO(0.5-verify): guides
 * describe the Ancient-augment limit as one per CHARACTER; per item is the
 * closest a single-item simulator can encode. Corrupted items cannot be
 * modified — TODO(0.5-verify) whether socketing bypasses that rule.
 */
const TWO_SOCKET_CLASSES = [
  "Body Armour",
  "Two Hand Axe", "Two Hand Mace", "Two Hand Sword",
  "Warstaff", "Bow", "Crossbow", "Staff",
] as const;
const ONE_SOCKET_CLASSES = [
  "Helmet", "Gloves", "Boots", "Shield", "Buckler", "Focus",
  "Claw", "Dagger", "Flail", "Spear",
  "One Hand Axe", "One Hand Mace", "One Hand Sword",
  "Wand", "Sceptre", "Talisman",
] as const;

/** itemClass -> maximum rune sockets; absent = cannot have sockets. */
export const SOCKET_MAX: ReadonlyMap<string, number> = new Map([
  ...TWO_SOCKET_CLASSES.map((c) => [c, 2] as [string, number]),
  ...ONE_SOCKET_CLASSES.map((c) => [c, 1] as [string, number]),
]);

/** Trade id of the Artificer's Orb (adds one rune socket). */
export const ARTIFICER = "artificers";

/**
 * Masterwork Rune (0.5 "Runes of Aldur"): unlike an ordinary rune it is not
 * itself socketed — "Upgrades a socketed Rune", promoting it one tier along
 * the Lesser -> (base) -> Greater -> Perfect ladder, keeping the same rune
 * family and host-class variant. The improved values come from the higher
 * tier's own datamined effect. Sources: poe2wiki / fextralife Masterwork_Rune
 * ("upgrade the socketed rune to the next tier: Lesser to Normal, Normal to
 * Greater, Greater to Perfect"), game8 archive 603383. A rune with no higher
 * tier (Perfect, or a tier-less special rune such as an Ancient or Aldur's
 * rune) cannot be upgraded.
 */
export const MASTERWORK_RUNE = "masterwork-rune";

/**
 * Rune tier name prefixes, weakest to strongest. The base tier carries no
 * prefix (""), so its index is the anchor Masterwork upgrades step up from.
 */
export const RUNE_TIERS = ["Lesser ", "", "Greater ", "Perfect "] as const;
