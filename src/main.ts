import { seededRng } from "./random";
import { playSeason } from "./season";
import { generateWorld } from "./seed";
import { clubStrength } from "./strength";

const CLUBS = [
  "Ashford Rovers", "Bramley Town", "Castleford City", "Dunmore United",
  "Eastgate Athletic", "Fernhill Wanderers", "Greyhaven FC", "Holloway Albion",
  "Ironbridge County", "Kingsmere Rangers",
];

const seed = Number(process.argv[2] ?? Date.now());
const rng = seededRng(seed);
const world = generateWorld(CLUBS, rng);
const season = playSeason(world, rng);

console.log(`Seed ${seed}\n`);
console.log("Pos  Club                  P   W   D   L   GF  GA   GD  Pts   Att   Def");
season.table.forEach((row, i) => {
  const club = world.clubs[row.clubId]!;
  const { attack, defence } = clubStrength(world, club);
  const gd = row.goalDifference > 0 ? `+${row.goalDifference}` : `${row.goalDifference}`;
  console.log(
    [
      String(i + 1).padStart(3),
      " ",
      club.name.padEnd(20),
      ...[row.played, row.won, row.drawn, row.lost, row.goalsFor, row.goalsAgainst].map((n) => String(n).padStart(3)),
      gd.padStart(4),
      String(row.points).padStart(4),
      attack.toFixed(1).padStart(5),
      defence.toFixed(1).padStart(5),
    ].join(" "),
  );
});
