# oigaffer

A football match simulation. The simulation is fully 3D (metres, z-up, ballistic
ball flight under gravity) and is drawn as a 2D top-down game with WebGL.

Currently: a striker runs at goal against a defender and a goalkeeper, over and over.

- **Shooting grade (1–20)** — the striker aims at a corner, and the ball lands
  uniformly inside a circle around that aim point on the goal plane. Better
  shooters have a tighter circle (2.4 m radius at 1, 0.35 m at 20).
- **Reaction grade (1–20)** — after the strike the keeper stands frozen for a
  delay (400 ms at 1, 80 ms at 20), then dives towards where the ball will cross.

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

- **Out of play** — once the whole ball is over a touchline or the goal line,
  open play ends with the restart going against whoever touched it last:
  goal kick or a defence throw-in off the striker (counted as *lost*), corner
  or an attack throw-in off the defender (counted as a *set piece*). A ball
  that rolls into the net is still a goal. The striker only knocks the ball
  long when there's room on the pitch for it, and takes defenders on the
  infield side near a touchline.

The inset "striker's view" is a second camera on the same 3D scene, looking at
the goal mouth face-on so you can see the spread circle and where shots go.

## Stack

Bun, Vite, React + TypeScript, Tailwind, bitECS, raw WebGL2.

## Running

```bash
bun install
bun run dev
```

Space shoots early, R restarts the attack. `bun test` runs the simulation tests;
`bun run build` typechecks and builds.

## Layout

- `src/sim` — the ECS world: components, systems (striker and defender decisions, touches, locomotion, challenges, keeper, collisions, ball, contests, outcome), shooting model and grade curves. No DOM.
- `src/render` — WebGL renderer, cameras (top-down and goal-face orthographic) and the scene built from the world.
- `src/game` — fixed-step loop tying the simulation to the renderer, plus a store for the UI.
- `src/ui` — React HUD and controls.
