import type { Attributes, Club, GameWorld, Player, Position } from "./model";
import type { Rng } from "./random";

// A first-team squad: an eleven plus cover in every position
const SQUAD: Position[] = [
  "GK", "GK",
  "DEF", "DEF", "DEF", "DEF", "DEF", "DEF",
  "MID", "MID", "MID", "MID", "MID", "MID",
  "FWD", "FWD", "FWD", "FWD",
];

const STARTERS: Record<Position, number> = { GK: 1, DEF: 4, MID: 4, FWD: 2 };
const RESERVE_PENALTY = 2;

// The skill attributes, which follow club quality with a positional offset
type Skills = Omit<Attributes, "pace" | "acceleration" | "jumping" | "strength">;

// Offsets from the club's quality, per attribute
const PROFILE: Record<Position, Skills> = {
  GK: { passing: -5, shooting: -12, dribbling: -10, tackling: -10, goalkeeping: 0, stamina: -3 },
  DEF: { passing: -3, shooting: -7, dribbling: -4, tackling: 0, goalkeeping: -15, stamina: 0 },
  MID: { passing: 0, shooting: -3, dribbling: -1, tackling: -2, goalkeeping: -15, stamina: 0 },
  FWD: { passing: -2, shooting: 0, dribbling: 0, tackling: -7, goalkeeping: -15, stamina: 0 },
};

export const DEFAULT_CLUBS = [
  "Ashford Rovers", "Bramley Town", "Castleford City", "Dunmore United",
  "Eastgate Athletic", "Fernhill Wanderers", "Greyhaven FC", "Holloway Albion",
  "Ironbridge County", "Kingsmere Rangers",
];

const FIRST_NAMES = ["Alex", "Ben", "Carlos", "Dani", "Eli", "Femi", "Gio", "Hugo", "Ivan", "Jon", "Kai", "Luca", "Marco", "Nico", "Omar", "Pau", "Rui", "Sami", "Theo", "Yusuf"];
const LAST_NAMES = ["Adeyemi", "Berg", "Costa", "Diallo", "Evans", "Fischer", "Garcia", "Hansen", "Ito", "Jansen", "Kovac", "Lopez", "Moreau", "Novak", "Okafor", "Petrov", "Rossi", "Silva", "Torres", "Walsh"];

// Physicals are drawn in a second pass, from a base plus a positional profile.
// They only loosely follow club quality, so they add variety without widening
// the gap between strong and weak sides.
const PHYSICAL_BASE = 10;
const PHYSICAL_QUALITY = 0.3;
const PHYSICAL_PROFILE: Record<Position, { pace: number; acceleration: number; jumping: number; strength: number }> = {
  GK: { pace: -2, acceleration: -1, jumping: 2, strength: 1 },
  DEF: { pace: -1, acceleration: -1, jumping: 2, strength: 2 },
  MID: { pace: 0, acceleration: 1, jumping: -1, strength: -1 },
  FWD: { pace: 2, acceleration: 2, jumping: 0, strength: 0 },
};

const pick = <T>(items: T[], rng: Rng): T => items[Math.floor(rng() * items.length)]!;
const clampAttr = (v: number) => Math.min(20, Math.max(1, Math.round(v)));
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

// Builds a world with one squad per club. Club quality is spread
// between 8 and 16 so there are clear favourites and strugglers.
export function generateWorld(clubNames: string[], rng: Rng): GameWorld {
  const world: GameWorld = { clubs: {}, players: {} };
  const qualities = new Map<Club, number>();

  for (const name of clubNames) {
    const clubId = slug(name);
    const quality = 8 + rng() * 8;
    const club: Club = { id: clubId, name, playerIds: [] };
    qualities.set(club, quality);

    const seen: Partial<Record<Position, number>> = {};
    SQUAD.forEach((position, i) => {
      const profile = PROFILE[position];
      // Squad players beyond the usual starters are a notch below them
      seen[position] = (seen[position] ?? 0) + 1;
      const depth = seen[position]! > STARTERS[position] ? RESERVE_PENALTY : 0;
      const attr = (offset: number) => clampAttr(quality + offset - depth + (rng() - 0.5) * 4);
      const player: Player = {
        id: `${clubId}-${i + 1}`,
        name: `${pick(FIRST_NAMES, rng)} ${pick(LAST_NAMES, rng)}`,
        position,
        attributes: {
          passing: attr(profile.passing),
          shooting: attr(profile.shooting),
          dribbling: attr(profile.dribbling),
          tackling: attr(profile.tackling),
          goalkeeping: attr(profile.goalkeeping),
          stamina: attr(profile.stamina),
          pace: PHYSICAL_BASE,
          acceleration: PHYSICAL_BASE,
          jumping: PHYSICAL_BASE,
          strength: PHYSICAL_BASE,
        },
      };
      world.players[player.id] = player;
      club.playerIds.push(player.id);
    });

    world.clubs[clubId] = club;
  }

  // Second pass, so the skill draws above keep the same values for a given seed
  for (const club of Object.values(world.clubs)) {
    const quality = qualities.get(club)!;
    for (const id of club.playerIds) {
      const player = world.players[id]!;
      const profile = PHYSICAL_PROFILE[player.position];
      const physical = (offset: number) =>
        clampAttr(PHYSICAL_BASE + offset + PHYSICAL_QUALITY * (quality - 12) + (rng() - 0.5) * 6);
      const a = player.attributes;
      a.pace = physical(profile.pace);
      a.acceleration = physical(profile.acceleration);
      a.jumping = physical(profile.jumping);
      a.strength = physical(profile.strength);
    }
  }
  return world;
}
