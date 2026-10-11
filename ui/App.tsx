import { useState } from "react";
import { seededRng } from "../src/random";
import { DEFAULT_CLUBS, generateWorld } from "../src/seed";
import { clubStrength } from "../src/strength";
import type { Tactics } from "../src/tactics";
import { MatchScreen } from "./MatchScreen";
import { TacticsPicker } from "./TacticsPicker";
import type { MatchSetup } from "./useMatch";

const newSeed = () => Math.floor(Math.random() * 1_000_000);

export function App() {
  const [setup, setSetup] = useState<MatchSetup | null>(null);
  // Changing the key gives each match a fresh engine state
  const [matchNo, setMatchNo] = useState(0);

  if (setup) {
    return (
      <MatchScreen
        key={matchNo}
        setup={setup}
        onExit={() => {
          setSetup(null);
          setMatchNo((n) => n + 1);
        }}
      />
    );
  }
  return <Setup onStart={setSetup} />;
}

function Setup({ onStart }: { onStart: (setup: MatchSetup) => void }) {
  const [world] = useState(() => generateWorld(DEFAULT_CLUBS, seededRng(newSeed())));
  const clubs = Object.values(world.clubs);
  const [homeId, setHomeId] = useState(clubs[0]!.id);
  const [awayId, setAwayId] = useState(clubs[1]!.id);
  const [tactics, setTactics] = useState<Tactics>({ formation: "4-4-2", mentality: 0 });

  const club = (label: string, value: string, onChange: (id: string) => void, exclude: string, whose: string) => {
    const s = clubStrength(world, world.clubs[value]!);
    return (
      <label className={`club-pick ${whose}`}>
        <span className="role">{label}</span>
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {clubs
            .filter((c) => c.id !== exclude)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
        <span className="rating">
          Attack {s.attack.toFixed(1)}, defence {s.defence.toFixed(1)}
        </span>
      </label>
    );
  };

  return (
    <main className="setup">
      <h1>Pick your match</h1>
      <div className="fixture">
        {club("You manage, at home", homeId, setHomeId, awayId, "us")}
        <span className="vs">v</span>
        {club("Visitors", awayId, setAwayId, homeId, "them")}
      </div>
      <section>
        <h2>Starting tactics</h2>
        <TacticsPicker tactics={tactics} onChange={setTactics} />
      </section>
      <button
        className="go"
        onClick={() =>
          onStart({
            world,
            home: world.clubs[homeId]!,
            away: world.clubs[awayId]!,
            side: "home",
            tactics,
            seed: newSeed(),
          })
        }
      >
        Go to the dugout
      </button>
    </main>
  );
}
