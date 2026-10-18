# oigaffer

A football match simulation. The simulation is fully 3D (metres, z-up, ballistic
ball flight under gravity) and is drawn as a 2D top-down game with WebGL.

Currently: a match between two teams, Red and Blue, each with two outfielders and a
goalkeeper, on a small-sided 50 m × 32 m pitch with full-size goals. Red attacks the
goal at +x, Blue the one at -x. How teammates move off the ball, pass and defend
together is designed in [docs/off-ball-play.md](docs/off-ball-play.md) and is
being built in stages.

- **Teammates and shape** — each team has a formation that lives in a block
  moving with the ball. With the ball, the block stretches: one outfielder
  stays deep and the other plays on the opposition's last line, on a diagonal.
  Without it, the block is compact and sits back from the ball. The player on
  the ball is the *carrier*. The defender quickest to the ball *presses* it.
  The other defender covers behind the presser, sliding across to mark the
  free attacker once that attacker gets nearer goal than the ball. The
  presser hands over to the cover once beaten. A loose ball goes to
  whichever player gets there first, teammates included.
- **Moving like footballers** — players without the ball decide a few times a
  second, at staggered moments. Each decision picks a target area, not an exact
  spot, and a player inside it stands still. They walk or jog unless they're
  far off or have to recover, keep their body facing the play on short moves,
  and keep clear of each other.
- **Passing (1–20)** — on the ball, a few times a second, the carrier weighs
  keeping it against each pass they could play. A pass goes to feet, or into
  space ahead of a teammate, weighted so the runner meets it in stride. Each
  option is rated by expected threat: what it's worth if it gets through, less
  the other team's threat from where it would be lost. The space model judges
  how likely it is to get through. **Vision** decides which teammates outside
  the carrier's field of view they spot, and **decisions** how far their
  judgement of each option is off. **Passing** sets how true it goes in line
  and weight, worse under pressure, over distance and across the body. The
  receiver goes to meet the ball, then sets it with a directional first touch:
  towards goal and away from pressure. **First touch** sets how fast a ball
  they can take dead and how true the touch goes. A faster ball bounces off
  them. Anyone can cut a pass out.
- **Show space** — a debug overlay that paints the space model players read
  the pitch with: how dangerous each spot is (threat), and which team would get
  to a ball there first (control).

- **Possession** — the carrier attacks (dribbles, takes the presser on, shoots).
  Win the ball back with a tackle or an
  interception and the roles swap on the spot: the new attacker turns and goes the
  other way, while the player who lost it needs a moment before challenging again.

- **Shooting grade (1–20)** — the striker aims at a corner, and the ball lands
  uniformly inside a circle around that aim point on the goal plane. Better
  shooters have a tighter circle (2.4 m radius at 1, 0.35 m at 20).
- **Reaction grade (1–20)** — after the strike the keeper stands frozen for a
  delay (400 ms at 1, 80 ms at 20), then dives towards where the ball will cross.
- **Handling grade (1–20)** — a shot the keeper gets to is either caught or
  parried. Shots at the body stick most often (30% at 1, 90% at 20), ones at
  full stretch less, and anything above head height is punched. A parry pushes
  the ball away from goal and wide, still in play. A catch, or a loose ball the
  keeper gathers, gives their team the ball: the keeper holds it while their
  outfielder runs wide to get open and the opponent drops off to mark, then
  rolls it out to them. A keeper can't pick up a ball their own outfielder
  played to them; they kick it straight back out instead.

- **Movement** — players have a facing and physical grades (pace, acceleration,
  agility, strength). They accelerate hardest the way they face, sidestep and
  backpedal slowly, and turn more slowly the faster they run.

- **Dribbling (1–20)** — the ball is free; the striker plays it with touches.
  *Small* touches keep it within about 2 m, can send it up to ~100° off the
  facing and are quick to repeat, but cap running speed. *Large* touches knock
  it 4–6 m ahead to run onto at full pace, only roughly forwards. Dribbling
  grade sets how true each touch goes. A loose ball that rolls to the keeper is
  claimed.

- **Defending** — the defender *jockeys* when close and goal-side: side-on to
  the ball, shuffling at sidestep speed with a short read lag. Once beaten or
  far away it *runs*: full pace, but reading late and turning wide. **Marking
  (1–20)** sets how far its read of the ball trails reality. The striker
  carries the ball at the defender's shoulder, cuts across (sometimes after a
  dummy, checking back if mirrored) and knocks it past once clear. Players
  can't overlap, shots can be blocked, and a ball that gets away from the
  striker can be intercepted; a ball still under control needs a tackle.
- **Challenges** — the defender can make a *standing tackle* (short reach,
  quick recovery, stumbles if it misses), a *sliding tackle* (long reach, ends
  up on the ground) or a *barge* (shoulder to shoulder, strength decides who
  keeps their feet). Tackles don't always win the ball: they may poke it loose
  instead. **Tackling (1–20)** against the carrier's dribbling sets the odds,
  and a ball between touches is easier to nick than one at the feet. The
  striker *shields*: with the defender tight it turns its back, rolls the ball
  under its sole on the far side, and tackles through its body rarely work.
  **Strength (1–20)** decides barges.

- **Out of play and restarts** — once the whole ball is over a touchline or a
  goal line, play stops and the restart goes against whoever touched it last:
  a throw-in, a corner, or a goal kick. After a goal the other team kicks off.
  Restarts are taken by an outfielder starting with the ball at their feet,
  with the nearest opponent standing off goal-side and everyone else in shape. A ball that rolls into a net is a
  goal, own goals included. The carrier only knocks the ball long
  when there's room on the pitch for it, and takes defenders on the infield
  side near a touchline.

The scoreboard shows goals, passes completed out of passes played, shots,
shots saved, and times each team won the ball back. The main view fits the whole pitch: lengthways across a landscape screen, up a
portrait one. The inset goal view is a second camera on the same 3D scene, looking face-on at
the goal under attack so you can see the spread circle and where shots go.

## Stack

Bun, Vite, React + TypeScript, Tailwind, bitECS, raw WebGL2.

## Running

```bash
bun install
bun run dev
```

Space makes whoever has the ball shoot early, R starts a new match. Each team's
grades are set from its tab in the control panel. `bun test` runs the simulation tests;
`bun run build` typechecks and builds.

## Layout

- `src/sim` — the ECS world: components, teams, systems (roles, the carrier's and presser's decisions, off-ball movement, touches, locomotion, challenges, keeper, collisions, ball, contests, outcome), formations and team shape, the space model (`space/`), shooting model and grade curves. No DOM.
- `src/render` — WebGL renderer, cameras (top-down and goal-face orthographic) and the scene built from the world.
- `src/game` — fixed-step loop tying the simulation to the renderer, plus a store for the UI.
- `src/ui` — React HUD and controls.
