# oigaffer

A football match simulation. The simulation is fully 3D (metres, z-up, ballistic
ball flight under gravity) and is drawn as a 2D top-down game with WebGL.

Currently: five-a-side between two teams, Red and Blue, each with four outfielders
and a goalkeeper, on a small-sided 60 m × 40 m pitch with full-size goals. Red
attacks the goal at +x, Blue the one at -x. The four play a 1-2-1 diamond with
the ball and a 2-2 box without it. The simulation can also be run with one,
two or ten outfielders a side; ten play a 4-3-3 with the ball and a 4-1-4-1
without it, still on the small pitch for now.

- **Teammates and shape** — each team has a formation that lives in a block
  moving with the ball. With the ball, the block stretches: one outfielder
  stays deep and the other plays on the opposition's last line, on a diagonal.
  Without it, the block is compact and sits back from the ball. The player on
  the ball is the *carrier*. The defender quickest to the ball *presses* it.
  The rest share out jobs several times a second: one *covers* behind the
  presser, between the ball and goal, and the others pick up the attackers
  in and around their zones, goal-side of them once they're nearer goal than
  the ball. A spare defender holds their zone in the block. With only one
  defender behind the presser, they cover and mark at once. The presser
  hands over to whoever is clearly quicker to the ball. A loose ball goes to
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
- **Off the ball (1–20)** — the carrier's teammates hold their places in the
  shape and call for it when free. When the carrier is closed down or facing
  their own goal, the one or two nearest *show for it*: each goes to the spot
  around the carrier where a pass would be worth most, away from the angles
  their teammates already offer, and stays there until a clearly better spot
  appears. In a side of three or more, whoever plays deepest stays behind the
  ball as *rest defence*, the outlet to play back to and the first line
  against the counter; when they get the ball, the next deepest takes over.
  When the carrier has time and is facing forward, one at a time *runs in
  behind* (about one runner for every four outfielders). First they check towards the ball, then sprint for the space beyond
  the line that they'd win the race to, holding the line until the pass and
  calling for it there. The carrier hears a call even from a teammate they
  can't see, and can play into the called space. A run nobody finds is given
  up after a couple of seconds. **Off the ball** sets how often they spot the
  moment, how quickly they go, and how well they judge where to show. A
  passer misjudges a teammate's position against the line by up to about a
  metre, less with better decisions.
- **Defending as a unit** — the defender quickest to the ball presses it. The
  rest share out the other jobs by an optimal assignment: one covers behind
  the presser, and the others pick up the attackers in and around their zones,
  the more dangerous first, so no two take the same man. A spare defender
  holds their zone. A defender keeps their job unless another is clearly
  better placed to take it: half a second quicker to get there. The back line moves as one. It drops off
  when the carrier has time to play forward, and steps up on a pressing cue:
  the carrier facing their own goal, pinned on a touchline, or the ball played
  backwards. On a pressing cue markers also get tight. The covering defender
  holds the line rather than following a runner beyond it before the pass.
  With an attacker lurking on the line as a pass is shaped, the line may step
  up together to catch them offside. A runner who goes behind their marker's
  back is picked up late. **Positioning** sets how late, and how often the
  trap is sprung. Passes take a moment to wind up, and a runner times their
  burst to the strike: go too early and they're offside.
- **Offside** — judged each time a team plays the ball on purpose (a touch,
  pass, shot or first touch). Any teammate then in the opponents' half, and
  nearer their goal line than both the ball and the second-last opponent, is
  flagged. A flagged player who plays the ball gives away an indirect free
  kick where they were. Flags clear when the team plays it again or the other
  team does; a throw-in, corner or goal kick can't be offside. Players know
  the law: the attacker without the ball stays onside, and carriers don't pass
  to a teammate standing offside.
- **Show space** — a debug overlay that paints the space model players read
  the pitch with: how dangerous each spot is (threat), and which team would get
  to a ball there first (control).

- **Possession** — the carrier attacks (dribbles, takes the presser on, shoots).
  Win the ball back with a tackle or an
  interception and the roles swap on the spot: the new attacker turns and goes the
  other way, while the player who lost it needs a moment before challenging again.

- **When to shoot** — the carrier weighs shooting against keeping the ball and
  passing, all as expected goals. They reckon a shot by the gap the keeper
  leaves: the chance it lands between the post and as far as the keeper can
  reach in the time it takes to arrive, and under the bar. Keeping it is
  worth the better shot it could lead to, but only if they have a moment on
  the ball to carry it on; closed down, a shot now beats holding on. Nobody
  shoots with less than a 2% chance.
- **Shooting grade (1–20)** — the striker aims at the corner away from the
  keeper, and the shot goes off line by a normal error in angle (about 10° at
  1, 4° at 20), so a long shot misses by more. An opponent within 3 m hurries
  it, up to 2.2 times the error, and so does shooting across the body. Close
  in a shot is placed; further out it's driven harder, and less true. An
  average finisher against a set keeper scores roughly a half of shots from
  6 m, a third from 10 m and a sixth from 18 m: close to real shots, if a
  few points high from 14–18 m.
- **Keeper positioning** — the keeper stands on the line splitting the angle
  between the ball and the posts, further off their line the further away the
  ball is (1.2–3 m), and comes out up to 5 m to close down a shooter who is
  through on their own. Close to the shooter they spread themselves to block.
- **Reaction grade (1–20)** — after the strike the keeper stands frozen for a
  delay (400 ms at 1, 80 ms at 20), then dives towards where the ball will
  cross, at up to 5 m/s.
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
  An offside gives a free kick, with opponents 5 m away.
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
`bun run build` typechecks and builds. `bun run measure [minutes] [outfielders] [seeds]`
plays headless matches and reports how they played (tallies, effort, spacing,
shape) and what each system cost per simulated minute.

## Layout

- `src/sim` — the ECS world: components, teams, cues (the moments players react to, and how), systems (roles, the carrier's and presser's decisions, off-ball movement, touches, locomotion, challenges, keeper, collisions, ball, contests, outcome), formations and team shape, the space model (`space/`), shooting model and grade curves. No DOM.
- `src/render` — WebGL renderer, cameras (top-down and goal-face orthographic) and the scene built from the world.
- `src/game` — fixed-step loop tying the simulation to the renderer, plus a store for the UI.
- `src/ui` — React HUD and controls.
