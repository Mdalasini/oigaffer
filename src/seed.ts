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

// Offsets from the club's quality, per attribute
const PROFILE: Record<Position, Attributes> = {
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

const pick = <T>(items: T[], rng: Rng): T => items[Math.floor(rng() * items.length)]!;
const clampAttr = (v: number) => Math.min(20, Math.max(1, Math.round(v)));
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

// Builds a world with one squad per club. Club quality is spread
// between 8 and 16 so there are clear favourites and strugglers.
export function generateWorld(clubNames: string[], rng: Rng): GameWorld {
  const world: GameWorld = { clubs: {}, players: {} };

  for (const name of clubNames) {
    const clubId = slug(name);
    const quality = 8 + rng() * 8;
    const club: Club = { id: clubId, name, playerIds: [] };

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
        },
      };
      world.players[player.id] = player;
      club.playerIds.push(player.id);
    });

    world.clubs[clubId] = club;
  }
  return world;
}
