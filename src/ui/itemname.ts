/**
 * Item header naming, matching the game's tooltip:
 * - normal: base name only
 * - magic: "<PrefixName> <BaseName> <of SuffixName>" built from the rolled
 *   affixes' datamined names
 * - rare: a flavour name on its own line above the base name. The game
 *   assigns a persistent random two-word name when the item becomes rare;
 *   we derive one deterministically from the craft's base + ilvl so it
 *   stays put through the whole session (and in shared replays). The word
 *   pools are hand-picked flavour in the game's style, not datamined.
 */
import type { EngineData } from "../engine/data.ts";
import type { Item } from "../engine/item.ts";

export interface ItemHeader {
  name: string;
  /** Second header line — rare items show the base name below the name. */
  base?: string;
}

const FIRST = [
  "Agony", "Apocalypse", "Armageddon", "Beast", "Behemoth", "Blight",
  "Blood", "Bramble", "Brimstone", "Brood", "Carrion", "Cataclysm",
  "Corpse", "Corruption", "Damnation", "Death", "Demon", "Dire", "Dragon",
  "Dread", "Doom", "Dusk", "Eagle", "Empyrean", "Fate", "Foe", "Gale",
  "Ghoul", "Gloom", "Glyph", "Golem", "Grim", "Hate", "Havoc", "Honour",
  "Horror", "Hypnotic", "Kraken", "Loath", "Maelstrom", "Mind", "Miracle",
  "Morbid", "Oblivion", "Onslaught", "Pain", "Pandemonium", "Phoenix",
  "Plague", "Rage", "Rapture", "Rune", "Skull", "Sol", "Soul", "Sorrow",
  "Spirit", "Storm", "Tempest", "Torment", "Vengeance", "Victory", "Viper",
  "Vortex", "Woe", "Wrath",
];

const SECOND: Record<string, string[]> = {
  "Body Armour": ["Carapace", "Cloak", "Coat", "Curtain", "Hide", "Keep",
    "Mantle", "Pelt", "Sanctuary", "Shell", "Shelter", "Shroud", "Skin",
    "Suit", "Veil", "Ward", "Wrap"],
  Helmet: ["Brow", "Corona", "Cowl", "Crest", "Crown", "Dome", "Gaze",
    "Halo", "Horn", "Peak", "Salvation", "Star", "Veil", "Visage", "Visor"],
  Gloves: ["Caress", "Claw", "Clutches", "Fingers", "Fist", "Grasp", "Grip",
    "Hand", "Hold", "Knuckle", "Mitts", "Palm", "Paw", "Talons", "Touch"],
  Boots: ["Dash", "Goad", "Hoof", "League", "March", "Pace", "Road", "Sole",
    "Span", "Spur", "Stride", "Track", "Trail", "Tread", "Urge"],
  Shield: ["Aegis", "Badge", "Barrier", "Bastion", "Bulwark", "Duty",
    "Emblem", "Fend", "Guard", "Mark", "Refuge", "Rock", "Tower", "Watch"],
  Ring: ["Band", "Circle", "Coil", "Eye", "Finger", "Grasp", "Grip", "Gyre",
    "Hold", "Knot", "Loop", "Nail", "Spiral", "Turn", "Whorl"],
  Amulet: ["Beads", "Braid", "Charm", "Choker", "Clasp", "Collar", "Gorget",
    "Heart", "Locket", "Medallion", "Noose", "Pendant", "Rosary", "Torc"],
  Belt: ["Bind", "Bond", "Buckle", "Clasp", "Cord", "Girdle", "Harness",
    "Lash", "Leash", "Lock", "Shackle", "Snare", "Strap", "Tether", "Thread"],
  Quiver: ["Arrow", "Barb", "Bite", "Bolt", "Dart", "Flight", "Fletch",
    "Needle", "Quill", "Rod", "Shot", "Skewer", "Spike", "Stinger"],
  Jewel: ["Bliss", "Dream", "Fancy", "Glimmer", "Hope", "Image", "Joy",
    "Reverie", "Solace", "Song", "Spark", "Splendour", "Thought", "Vision"],
  ranged: ["Arch", "Bane", "Blast", "Branch", "Breeze", "Fletch", "Guide",
    "Horn", "Mark", "Nock", "Rain", "Reach", "Siege", "Song", "Stinger",
    "Strike", "Thunder", "Twine", "Volley", "Wind", "Wing"],
  caster: ["Bane", "Barb", "Bite", "Branch", "Call", "Chant", "Charm",
    "Cry", "Gnarl", "Goad", "Roar", "Song", "Spell", "Spire", "Weaver",
    "Whisper"],
  melee: ["Bane", "Beak", "Bite", "Blow", "Brand", "Breaker", "Butcher",
    "Cry", "Edge", "Etcher", "Fang", "Gnash", "Grinder", "Mangler", "Rend",
    "Roar", "Ruin", "Sever", "Skewer", "Slayer", "Smasher", "Song", "Sting",
    "Thirst", "Thresher"],
};

const CLASS_POOL: Record<string, string> = {
  Buckler: "Shield", Focus: "Shield", Talisman: "Amulet",
  Bow: "ranged", Crossbow: "ranged",
  Wand: "caster", Sceptre: "caster", Staff: "caster", Warstaff: "caster",
};

/** FNV-1a — tiny stable string hash, good enough for name picking. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function rareName(seed: string, itemClass: string): string {
  const pool = SECOND[itemClass] ?? SECOND[CLASS_POOL[itemClass] ?? "melee"];
  const h = hash(seed);
  return `${FIRST[h % FIRST.length]} ${pool[Math.floor(h / FIRST.length) % pool.length]}`;
}

export function itemHeader(data: EngineData, item: Item): ItemHeader {
  const base = data.base(item.baseId);
  if (item.rarity === "rare") {
    return {
      name: rareName(`${item.baseId}:${item.ilvl}`, base.itemClass),
      base: base.name,
    };
  }
  if (item.rarity === "magic") {
    const names = { prefix: "", suffix: "" };
    for (const rolled of item.explicits) {
      const mod = data.mod(rolled.modId);
      if (mod.generation === "prefix" || mod.generation === "suffix") {
        names[mod.generation] ||= mod.name;
      }
    }
    const name = [names.prefix, base.name, names.suffix].filter(Boolean).join(" ");
    return { name };
  }
  return { name: base.name };
}
