/**
 * atlas.ts — the static geography of the Requiem Order world.
 *
 * This defines WHERE territories exist and their fixed properties (which
 * region/continent they belong to, their base resource type, map
 * coordinates). It does NOT define who owns them, their current income,
 * or their danger level — those are live and come from the database
 * (see getTerritoryControl / claimTerritory in db/queries.ts).
 *
 * Geography is fixed; ownership is not. Keeping them in separate places
 * means the website map and the .rpg / .territory commands always agree
 * on where things are, while still reflecting real-time guild control.
 */

export interface TerritoryDef {
  id: string;          // stable slug, e.g. "silent-lake"
  name: string;
  region: string;       // region id
  resource: string;     // base resource this territory produces
  baseIncome: number;   // gold/day before any guild upgrades
  x: number;            // map position, 0-100 (percent)
  y: number;            // map position, 0-100 (percent)
}

export interface RegionDef {
  id: string;           // stable slug, e.g. "whisper-woods"
  name: string;
  continent: string;    // continent id
}

export interface ContinentDef {
  id: string;           // stable slug, e.g. "aetheris"
  name: string;
}

export const CONTINENTS: ContinentDef[] = [
  { id: "aetheris",     name: "Aetheris" },
  { id: "noctara",      name: "Noctara" },
  { id: "valdris",      name: "Valdris" },
  { id: "eclipse-reach", name: "Eclipse Reach" },
];

export const REGIONS: RegionDef[] = [
  { id: "iron-plains",    name: "Iron Plains",    continent: "aetheris" },
  { id: "royal-capital",  name: "Royal Capital",  continent: "aetheris" },
  { id: "whisper-woods",  name: "Whisper Woods",  continent: "aetheris" },
  { id: "ember-ridge",    name: "Ember Ridge",    continent: "aetheris" },
  { id: "crystal-coast",  name: "Crystal Coast",  continent: "aetheris" },
  { id: "shadow-fen",     name: "Shadow Fen",      continent: "noctara" },
  { id: "moon-hollow",    name: "Moon Hollow",     continent: "noctara" },
  { id: "frostveil",      name: "Frostveil",       continent: "valdris" },
  { id: "ashen-reach",    name: "Ashen Reach",     continent: "valdris" },
  { id: "rift-margin",    name: "Rift Margin",     continent: "eclipse-reach" },
];

export const TERRITORIES: TerritoryDef[] = [
  // Whisper Woods
  { id: "north-grove",     name: "North Grove",      region: "whisper-woods", resource: "Timber",       baseIncome: 200, x: 30, y: 40 },
  { id: "silent-lake",     name: "Silent Lake",       region: "whisper-woods", resource: "Mana Crystal", baseIncome: 500, x: 34, y: 46 },
  { id: "moon-shrine",     name: "Moon Shrine",       region: "whisper-woods", resource: "Faith",        baseIncome: 300, x: 28, y: 50 },
  { id: "black-root",      name: "Black Root Forest", region: "whisper-woods", resource: "Herbs",        baseIncome: 250, x: 36, y: 38 },

  // Iron Plains
  { id: "ironhold",        name: "Ironhold",          region: "iron-plains",   resource: "Iron Ore",     baseIncome: 450, x: 48, y: 30 },
  { id: "rustfield",       name: "Rustfield",         region: "iron-plains",   resource: "Iron Ore",     baseIncome: 320, x: 52, y: 26 },

  // Royal Capital
  { id: "capital-district", name: "Capital District", region: "royal-capital", resource: "Gold",         baseIncome: 700, x: 50, y: 20 },

  // Ember Ridge
  { id: "ember-pass",      name: "Ember Pass",        region: "ember-ridge",   resource: "Sulfur",       baseIncome: 280, x: 64, y: 34 },
  { id: "forge-hollow",    name: "Forge Hollow",      region: "ember-ridge",   resource: "Iron Ore",     baseIncome: 380, x: 68, y: 40 },

  // Crystal Coast
  { id: "tidewatch",       name: "Tidewatch",         region: "crystal-coast", resource: "Pearls",       baseIncome: 340, x: 18, y: 28 },
  { id: "sunken-reef",     name: "Sunken Reef",       region: "crystal-coast", resource: "Mana Crystal", baseIncome: 410, x: 14, y: 34 },

  // Shadow Fen
  { id: "mire-hollow",     name: "Mire Hollow",       region: "shadow-fen",    resource: "Venom",        baseIncome: 220, x: 70, y: 60 },
  { id: "wraith-bog",      name: "Wraith Bog",        region: "shadow-fen",    resource: "Soulstone",    baseIncome: 460, x: 76, y: 66 },

  // Moon Hollow
  { id: "lunar-vale",      name: "Lunar Vale",        region: "moon-hollow",   resource: "Faith",        baseIncome: 310, x: 80, y: 54 },

  // Frostveil
  { id: "frosthaven",      name: "Frosthaven",        region: "frostveil",     resource: "Frost Crystal", baseIncome: 390, x: 24, y: 72 },
  { id: "glacier-keep",    name: "Glacier Keep",      region: "frostveil",     resource: "Iron Ore",      baseIncome: 350, x: 18, y: 78 },

  // Ashen Reach
  { id: "ashfall",         name: "Ashfall",           region: "ashen-reach",   resource: "Sulfur",        baseIncome: 270, x: 40, y: 82 },
  { id: "cinder-vale",     name: "Cinder Vale",       region: "ashen-reach",   resource: "Obsidian",      baseIncome: 420, x: 46, y: 88 },

  // Rift Margin
  { id: "the-fracture",    name: "The Fracture",      region: "rift-margin",   resource: "Voidstone",     baseIncome: 600, x: 90, y: 20 },
  { id: "rift-camp",       name: "Rift Camp",         region: "rift-margin",   resource: "Voidstone",     baseIncome: 280, x: 86, y: 14 },
];

export function getTerritoryDef(id: string): TerritoryDef | undefined {
  return TERRITORIES.find((t) => t.id === id || t.name.toLowerCase() === id.toLowerCase());
}

export function getRegionDef(id: string): RegionDef | undefined {
  return REGIONS.find((r) => r.id === id);
}

export function getContinentDef(id: string): ContinentDef | undefined {
  return CONTINENTS.find((c) => c.id === id);
}

/** Full atlas tree, useful for the website map and for listing commands. */
export function getAtlasTree() {
  return CONTINENTS.map((continent) => ({
    ...continent,
    regions: REGIONS.filter((r) => r.continent === continent.id).map((region) => ({
      ...region,
      territories: TERRITORIES.filter((t) => t.region === region.id),
    })),
  }));
}
