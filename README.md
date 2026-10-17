# oigaffer

A football match simulation. The simulation is fully 3D (metres, z-up, ballistic
ball flight under gravity) and is drawn as a 2D top-down game with WebGL.

Currently: a striker runs at goal 1v1 against a goalkeeper, over and over.

- **Shooting grade (1–20)** — the striker aims at a corner, and the ball lands
  uniformly inside a circle around that aim point on the goal plane. Better
  shooters have a tighter circle (2.4 m radius at 1, 0.35 m at 20).
- **Reaction grade (1–20)** — after the strike the keeper stands frozen for a
  delay (400 ms at 1, 80 ms at 20), then dives towards where the ball will cross.

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

- `src/sim` — the ECS world: components, systems (striker, keeper, ball, outcome), shooting model and grade curves. No DOM.
- `src/render` — WebGL renderer, cameras (top-down and goal-face orthographic) and the scene built from the world.
- `src/game` — fixed-step loop tying the simulation to the renderer, plus a store for the UI.
- `src/ui` — React HUD and controls.
