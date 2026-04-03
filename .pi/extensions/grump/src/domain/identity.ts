import type { GrumpIdentity, LegendaryId, Rarity, StatName, Stats } from "./types.js";

const RARITY_WEIGHTS: Array<{ rarity: Rarity; weight: number }> = [
  { rarity: "Common", weight: 70 },
  { rarity: "Rare", weight: 20 },
  { rarity: "Epic", weight: 8 },
  { rarity: "Legendary", weight: 2 },
];

export const NON_LEGENDARY_NAMES = {
  Common: ["Grumpy", "Crank", "Mutter", "Grouch", "Dusty"],
  Rare: ["Thorn", "Grizzle", "Rivet", "Ledger", "Hrmph"],
  Epic: ["Claw", "Bergerstein", "Bad Mood", "Old Man", "Side-Eye"],
};

export const SPRITE_VARIANTS_BY_RARITY: Record<Exclude<Rarity, "Legendary">, string[]> = {
  Common: ["common", "common-bald", "common-scruff", "common-moustache", "common-flat"],
  Rare: ["rare", "rare-scruffy", "rare-fuzz"],
  Epic: ["epic", "epic-wizard"],
};

export const LEGENDARY_SELECTIONS = ["Gramps", "π"] as const;
export const RARITY_COLORS: Record<Rarity, string> = {
  Common: "\x1b[38;5;250m",
  Rare: "\x1b[38;5;39m",
  Epic: "\x1b[38;5;141m",
  Legendary: "\x1b[38;5;214m",
};
export const RESET = "\x1b[0m";

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function chooseWeighted<T>(items: Array<{ value: T; weight: number }>): T {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let roll = Math.random() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) return item.value;
  }
  return items[items.length - 1].value;
}

function defaultStats(rarity: Rarity): Stats {
  const floor = rarity === "Common" ? 35 : rarity === "Rare" ? 45 : rarity === "Epic" ? 55 : 70;
  return {
    GRUMP: randomInt(floor, 98),
    WIT: randomInt(floor, 98),
    YAGNI: randomInt(floor, 98),
    OBSERVABILITY: randomInt(floor, 98),
    DISCIPLINE: randomInt(floor, 98),
    CRAFT: randomInt(floor, 98),
    PARANOIA: randomInt(floor, 98),
  };
}

function chooseSpriteVariant(rarity: Exclude<Rarity, "Legendary">): string {
  const variants = SPRITE_VARIANTS_BY_RARITY[rarity];
  return variants[randomInt(0, variants.length - 1)] ?? rarity.toLowerCase();
}

function findRarityForName(name: string): Exclude<Rarity, "Legendary"> | null {
  for (const rarity of ["Common", "Rare", "Epic"] as const) {
    if (NON_LEGENDARY_NAMES[rarity].some((candidate) => candidate.toLowerCase() === name.toLowerCase())) return rarity;
  }
  return null;
}

function findNameWithOriginalCase(name: string, rarity: Exclude<Rarity, "Legendary">): string | null {
  return NON_LEGENDARY_NAMES[rarity].find((candidate) => candidate.toLowerCase() === name.toLowerCase()) ?? null;
}

function findRarityForSpriteVariant(spriteVariant: string): Exclude<Rarity, "Legendary"> | null {
  for (const rarity of ["Common", "Rare", "Epic"] as const) {
    if (SPRITE_VARIANTS_BY_RARITY[rarity].includes(spriteVariant)) return rarity;
  }
  return null;
}

function createLegendaryIdentity(selection: LegendaryId): GrumpIdentity {
  if (selection === "gramps") {
    return {
      rarity: "Legendary",
      legendaryId: "gramps",
      name: "Gramps",
      spriteVariant: "gramps",
      stats: { GRUMP: 95, WIT: 92, YAGNI: 99, OBSERVABILITY: 97, DISCIPLINE: 95, CRAFT: 89, PARANOIA: 82 },
    };
  }
  return {
    rarity: "Legendary",
    legendaryId: "pi",
    name: "π",
    spriteVariant: "pi",
    stats: { GRUMP: 78, WIT: 71, YAGNI: 100, OBSERVABILITY: 100, DISCIPLINE: 94, CRAFT: 90, PARANOIA: 93 },
  };
}

export function makeIdentityFromSelection(rawSelection: string): GrumpIdentity | null {
  const selection = rawSelection.trim().toLowerCase();
  if (!selection) return null;
  if (selection === "π" || selection === "pi") return createLegendaryIdentity("pi");
  if (selection === "gramps") return createLegendaryIdentity("gramps");
  if (selection === "legendary") return createLegendaryIdentity(chooseWeighted<LegendaryId>([{ value: "gramps", weight: 1 }, { value: "pi", weight: 1 }]));
  if (selection === "common" || selection === "rare" || selection === "epic") {
    const rarity = `${selection[0]!.toUpperCase()}${selection.slice(1)}` as Exclude<Rarity, "Legendary">;
    const names = NON_LEGENDARY_NAMES[rarity];
    return { rarity, name: names[randomInt(0, names.length - 1)]!, spriteVariant: chooseSpriteVariant(rarity), stats: defaultStats(rarity) };
  }
  const rarityForName = findRarityForName(selection);
  if (rarityForName) {
    return {
      rarity: rarityForName,
      name: findNameWithOriginalCase(selection, rarityForName)!,
      spriteVariant: chooseSpriteVariant(rarityForName),
      stats: defaultStats(rarityForName),
    };
  }
  const rarityForVariant = findRarityForSpriteVariant(selection);
  if (rarityForVariant) {
    const names = NON_LEGENDARY_NAMES[rarityForVariant];
    return { rarity: rarityForVariant, name: names[randomInt(0, names.length - 1)]!, spriteVariant: selection, stats: defaultStats(rarityForVariant) };
  }
  return null;
}

export function getSelectionCompletionValues(): string[] {
  return [
    "legendary",
    "common",
    "rare",
    "epic",
    "gramps",
    "pi",
    ...NON_LEGENDARY_NAMES.Common.map((name) => name.toLowerCase()),
    ...NON_LEGENDARY_NAMES.Rare.map((name) => name.toLowerCase()),
    ...NON_LEGENDARY_NAMES.Epic.map((name) => name.toLowerCase()),
    ...SPRITE_VARIANTS_BY_RARITY.Common,
    ...SPRITE_VARIANTS_BY_RARITY.Rare,
    ...SPRITE_VARIANTS_BY_RARITY.Epic,
  ];
}

export function getSelectionHelpText(): string {
  return [
    "debug only: /grump set <name|rarity|sprite>",
    `legendary: ${LEGENDARY_SELECTIONS.join(", ")}`,
    `common names: ${NON_LEGENDARY_NAMES.Common.join(", ")}`,
    `rare names: ${NON_LEGENDARY_NAMES.Rare.join(", ")}`,
    `epic names: ${NON_LEGENDARY_NAMES.Epic.join(", ")}`,
    `sprites: ${[...SPRITE_VARIANTS_BY_RARITY.Common, ...SPRITE_VARIANTS_BY_RARITY.Rare, ...SPRITE_VARIANTS_BY_RARITY.Epic].join(", ")}`,
  ].join("\n");
}

export function makeIdentity(): GrumpIdentity {
  const rarity = chooseWeighted(RARITY_WEIGHTS.map((entry) => ({ value: entry.rarity, weight: entry.weight })));
  if (rarity === "Legendary") {
    return createLegendaryIdentity(chooseWeighted<LegendaryId>([{ value: "gramps", weight: 1 }, { value: "pi", weight: 1 }]));
  }
  const names = NON_LEGENDARY_NAMES[rarity as keyof typeof NON_LEGENDARY_NAMES];
  return { rarity, name: names[randomInt(0, names.length - 1)], spriteVariant: chooseSpriteVariant(rarity), stats: defaultStats(rarity) };
}

export function colorizeRarity(text: string, rarity: Rarity): string {
  return `${RARITY_COLORS[rarity]}${text}${RESET}`;
}

export function getDominantStats(stats: Stats): Array<[StatName, number]> {
  return (Object.entries(stats) as Array<[StatName, number]>).sort((a, b) => b[1] - a[1]).slice(0, 3);
}

export function statMeaning(name: StatName): string {
  switch (name) {
    case "GRUMP": return "how irritated you are by nonsense";
    case "WIT": return "how compressed, quotable, and banger-capable the line should be";
    case "YAGNI": return "sensitivity to unnecessary abstractions and overbuilding";
    case "OBSERVABILITY": return "sensitivity to hidden state and invisible behavior";
    case "DISCIPLINE": return "sensitivity to uncontrolled agent momentum and broad changes";
    case "CRAFT": return "appreciation of clean, boring, durable code";
    case "PARANOIA": return "sensitivity to secrets, risky commands, operational footguns, and suspicious carelessness";
  }
}
