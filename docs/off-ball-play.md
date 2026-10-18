# Off-ball play: design

How players without the ball move, how teams share the work in and out of
possession, how passes are played and received, and how offside works. The
first target is two outfielders and a keeper a side. Nothing in this design is
specific to that format: the same code is meant to run 5v5 and 11v11.

## Why off-ball movement usually looks wrong

When AI teammates move unnaturally, it is nearly always one of these:

1. **Steering to an exact point every tick.** Real players stop once they are
   in roughly the right place. A player who chases a recomputed target 120
   times a second never stands still and jitters around their spot.
2. **Taking the argmax of a value field every tick.** The best spot moves
   continuously, and its maximum can jump across the pitch. A player who
   follows it zig-zags.
3. **No reaction time, and everyone at once.** Real players notice things late
   and one at a time. When all of them react on the same tick, the team moves
   like a flock of birds.
4. **Runs with no start and no end.** A real run has a cue, a moment to get free
   of the marker, a path that keeps the runner onside, and an ending. The ending
   is either the pass arriving or giving up and jogging back into shape.
   Without that structure, a "run" is just drift.
5. **Always sprinting.** Real outfielders walk or jog most of the match and
   sprint only for a reason. Running flat out to a support position looks
   robotic.
6. **Everyone deciding alone.** Defenders who each pick the "best" job all
   choose the same job: everyone presses the ball, and nobody marks the runner.

Each point below is the counter to one or more of these.

## Principles

- **Decide slowly, move smoothly.** Decisions are made a few times a second
  (every 0.2–0.4 s, staggered across players, quicker with better decision
  grades). Movement runs every tick and carries out the latest decision.
- **Aim for areas, not points.** A decision picks a target area: a spot plus
  a tolerance radius. A player inside that radius holds their position and
  only makes small adjustments, such as stepping out of a defender's cover
  shadow.
- **Commit, with hysteresis.** A player keeps their current intention until it
  becomes invalid, or until another option beats it by a clear margin (around
  20%). Changing their mind costs something.
- **Choose an effort level.** Every intention moves at walk, jog, run or
  sprint, and only urgent intentions sprint.
- **Face the play.** Repositioning players face the ball, or sit half-turned
  between the ball and the goal they attack. They use sidesteps and backpedals
  for short adjustments. The locomotion system already limits how fast each of
  these can be.
- **Perceive, don't know.** Players act on what they have noticed. A defender
  watching the ball loses a runner on their blind side. A carrier facing away
  from a teammate doesn't see that teammate unless they call for it.

## Layers

```
 team shape        where the team "is": formation slots, shifted with the ball
     │
 space model       how valuable and how contested each place is
     │
 intention         what this player is trying to do: support, run, mark…
     │
 movement          one target area plus an effort level → MoveIntent
```

### Team shape

Each team has a formation: for every player, a slot giving their depth (own
goal line to the opposition's) and width (touchline to touchline). There are
two sets of slots, one in possession and one out of possession. The slots sit
in a **block**, a rectangle that moves with the game:

- **Out of possession** the block is compact, about a third of the pitch long.
  Its back edge is the defensive line. It slides across towards the ball, and
  steps up or drops off as a unit.
- **In possession** the block stretches. Its width becomes almost the full
  pitch, and its front edge reaches up to the opposition's line, which is the
  offside line. It slides less towards the ball, so the far side stays open
  for a switch of play.

A player's **home** is their slot mapped into the block. Home is where the
player drifts back to when they have no other job, and where any job they take
is anchored. Each role has a **freedom radius** that limits how far its jobs
may pull the player from home. A centre-back's is small and a free forward's
is large. This is how team shape survives off-ball decisions made player by
player.

### Zones

The pitch is split into the zones coaches use: five vertical lanes (two wide,
two half-spaces, one centre) by six horizontal bands. The lanes line up with
the edges of the penalty box and the goal area. Zones are for **decisions**:

- They describe a role's area, for example "a right winger lives in the right
  wide lane, bands 3–5".
- They enforce positional-play spacing: no more than two attackers in a lane,
  and no three in a row across a band. That stops attackers bunching without
  any special rule for it.
- They seed the candidate spots a player considers. A player looks at the
  centre of their zone, the zones next to it, and the gaps between defenders,
  not every square metre.

Execution stays continuous. Zones choose the area, and the movement layer
handles the exact spot within its tolerance.

### Space model

The space model is a set of pure functions over the world. It holds no per-player
state, so it is a resource on the world rather than ECS components. Grids that
never change are built once per pitch, and everything else is evaluated on
demand at the candidate spots.

- **Threat** is how dangerous it is to have the ball at a spot (expected
  threat, or xT). Start from the chance of scoring a shot from there, which
  depends on distance and angle to goal. Then let the value flow backwards: a
  spot is also worth what it leads to a pass or carry later, at a discount.
  Building it from the pitch's own geometry means it works on any pitch size.
- **Arrival time** is how long a player takes to reach a spot. It counts their
  reaction time, keeps them moving on their current velocity for that long,
  then runs them at top speed, with a penalty for turning. This is the model
  that tracking-data pitch-control work uses (Spearman; Fernández & Bornn).
- **Control** is which team would get to the ball first at a spot, given as a
  probability. It is a logistic of the gap between the two teams' best arrival
  times.
- **Pass safety** is the chance a given pass reaches its target. Sample the
  ball's path, and at each sample compare when the ball gets there with when
  each opponent could. The keeper counts only inside their area, where they can
  use their hands.
- **Pressure** is how long until the nearest opponent can reach a player:
  their time on the ball.

Everything is evaluated at the candidate spots, so the cost grows with the
number of candidates times the number of players. That works out to tens of
thousands of cheap operations a second at 11v11, which is fine.

## In possession

### Who decides: the carrier

The **carrier decides**, as in real football: the movement asks the question
and the pass answers it. Teammates make their intentions readable, through
their run and through a **call**, and the carrier chooses among what it can
perceive. In real life, calls carry information the passer can't see: "in
behind!", "man on!", "time!", "turn!". Here, a call does the same job. A
teammate who is calling is perceived even when the carrier is facing away from
them.

On each decision, the carrier rates its options by expected value:

| Option | Value |
| --- | --- |
| Shoot | chance of scoring from here, given the lane and the keeper |
| Carry | threat where the carry ends × chance of keeping the ball, given pressure and a take-on |
| Pass to feet | pass safety × threat at the receiver × receiver's time on the ball × receiver's body shape |
| Through ball | the same, at the point where the runner meets the ball |

The **vision** grade decides which teammates the carrier perceives: those in
its field of view, plus a chance per decision to spot the others. The
**decisions** grade sets how much noise goes into the ratings before the best
one is picked. Poor decision-makers sometimes choose the second-best option.

### Off-ball intentions

Each teammate of the carrier has one intention at a time, re-chosen on its
decision ticks with hysteresis:

- **Hold**: stay home and keep a passing angle open. This is the default.
- **Support**, or "show for it": offer an out ball when the carrier is under
  pressure or facing their own goal. Go to a spot 8–15 m away (scaled to the
  pitch) that is outside every defender's cover shadow, on a diagonal rather
  than flat, and inside the player's freedom radius.
- **Pin and stretch**: stand on the last line at the widest or highest point
  of the zone. This holds a defender there and makes room for teammates. It is
  the default for forwards.
- **Run in behind**: a run into the space behind the defensive line.

### Choosing the most dangerous place to receive

A runner rates each candidate spot as:

```
threat(spot) × own-team control there at the runner's arrival
             × pass safety from the carrier × onside when the pass is played
             − cost of getting there
```

This is how the runner receives in the most dangerous place it can actually
get to. The carrier then chooses where to put the ball along the runner's path:
to feet, or ahead of the runner into space. The runner's **body shape** at the
moment of receiving is part of the value. Receiving on the half-turn, already
facing forward, is worth more than receiving with your back to goal, because
the first touch can go forward.

### Runs have a lifecycle

```
 hold ──cue──▶ prepare ──▶ go ──pass played──▶ receive
                  │          │
                  └──────────┴──no pass / offside / lane shut──▶ recycle ──▶ hold
```

- **Cue**: the carrier has time, meaning no one is pressing them; their body
  is open to play forward; there is space behind the line; and the runner's
  marker is watching the ball or is flat-footed. These are the cues real
  coaches teach.
- **Prepare**: get free of the marker. This is a check away (a step short and
  then spin), or a curved run along the line to stay onside.
- **Go**: accelerate into the channel, staying onside until the pass is
  struck, then burst. While going, call for the ball in space.
- **Recycle**: if no pass comes within a window, or the runner strays
  offside, give up, jog back onside, and rejoin the shape. Most real runs end
  this way. A run that isn't found still pulls a defender away and opens space
  for the next pass.

## Passing and receiving

### Pass types

- **To feet**: aim at where the receiver will be, struck so it arrives at a
  controllable speed. Play it firmer when the lane is tight, to give
  interceptors less time, but a firmer pass is harder to control.
- **Through ball (into space)**: solve for the meeting point, the spot on the
  runner's path where runner and ball arrive together. Weight the pass so the
  ball has slowed to running pace there and won't roll on to the keeper. A
  through ball is "perfectly weighted" when it falls inside the window between
  the runner arriving and the keeper arriving.
- Lofted balls, crosses and driven passes come later. They use the same
  meeting-point solver, with flight instead of roll.

Each pass gets direction and weight errors from the **passing** grade, the
same way touches do now. The errors grow with distance and pressure.

### First touch

When the ball reaches the receiver, the difficulty of controlling it depends
on:

- its speed relative to the receiver;
- its height (a bouncing ball is harder);
- whether the receiver's body is open to it.

The **first touch** grade turns that difficulty into where the ball ends up.
A good touch is directional: it goes into space, away from pressure, and
forward when the receiver is half-turned. A poor touch bounces off further
away, and the ball is loose and contestable. A through ball is taken in
stride, as a large touch.

### Interception

Any player can intercept a pass by getting to its path first. Every body can
deflect the ball, not only the presser's.

## Out of possession

### Pressure, cover, balance

These are the defending principles of play:

- **First defender (pressure)**: engages the ball. This is the existing
  jockey, tackle and barge behaviour. The first defender delays the carrier
  and shows them away from goal. When the presser is chosen, its run curves so
  that its **cover shadow** blocks the most dangerous pass behind it.
- **Second defender (cover)**: stands behind and to the side of the presser,
  close enough to engage if the presser is beaten. The angle and distance
  depend on where the ball is.
- **Others (balance)**: mark dangerous attackers, tuck in, and hold the line.

The second defender's dilemma is real. If the other attacker is far away, cover
the presser. If they are close and dangerous, mark them, from a spot that still
helps cover. The assignment cost below makes that trade-off directly instead of
hard-coding it.

### Coordination by assignment, not by every player choosing alone

Several times a second, each team solves an assignment of players to jobs:

- press the ball;
- cover the presser;
- mark a particular attacker;
- hold a zone.

The cost of a player taking a job is their arrival time to the job's position
plus a role-suitability term. The current holder of each job gets a bonus, which
provides the hysteresis. The assignment is optimal (Hungarian, at most 10 × 10),
so two defenders never take the same job and the ball is never left unpressed.
This is the code's version of defenders talking: "I've got the ball", "yours",
"pass him on".

**Handovers** take time. When a runner moves from one defender's zone to
another's, the first defender keeps the job until the second is goal-side and
within reach. Only then does the first defender let the runner go. This is
"passing on" a runner in a zonal system. A man-marking instruction skips the
handover and the marker follows the runner.

### Marking

A marker stands goal-side of their attacker, on the line from the attacker to
the centre of goal, shaded towards the ball. The closer the attacker is to the
ball or the goal, the tighter the marking: about 1–2 m near the ball, 3–5 m
far from it. Where the marker can, they stand in the passing lane to deny the
pass. The marker's **attention** is split between the ball and the attacker.
A marker watching the ball reacts late to a run on their blind side, and their
**positioning** grade sets how often that happens.

### The defensive line

The last outfield line moves as a unit and is the team's offside line:

- **Step up** when the ball goes backwards, or when the carrier is pressed or
  facing their own goal and can't play forward.
- **Drop off** when the carrier has time and is facing forward. Drop further
  against quicker attackers.

The offside trap and the line's cat-and-mouse with runners come out of these
rules. Neither is scripted.

### Pressing triggers

The team presses as one on these cues: a bad first touch, a pass backwards, a
carrier facing their own goal, or the ball near the touchline. When a trigger
fires, each defender's job moves up a step: cover becomes press, mark becomes
deny.

## Offside (Law 11)

A player is in an **offside position** when, at the moment a teammate plays
the ball, all three of these hold:

- they are in the opponents' half (the halfway line itself doesn't count);
- they are nearer the opponents' goal line than the ball;
- they are nearer the opponents' goal line than the second-last opponent. The
  keeper usually counts as one of the last two.

The rule as modelled:

- Every deliberate touch by a team takes a snapshot. A pass, a dribble touch
  and a shot all count, because each of them plays the ball. The snapshot
  flags every teammate in an offside position.
- A flagged player commits an offence when they become involved: they play
  the ball, or challenge an opponent for it. The other team then gets an
  **indirect free kick** where the offence happened.
- Flags clear when the team takes a new snapshot, or when an opponent
  deliberately plays the ball. A deflection or a save doesn't clear them.
- A throw-in, goal kick or corner can't produce an offside.

Players use the rule as well as the referee. Runners hold their run until the
pass. A player caught offside who isn't involved drifts back onside. Carriers
don't pass to a teammate they can see is offside. Defensive lines step up to
catch runners.

## What scales and how

- Every system loops over queries. There are no hard-coded `striker` or
  `defender` singletons; the roles of the moment are the **carrier** and the
  **presser**, chosen each time.
- The format (players per side, pitch size, formations) is data. Pitch size is
  picked to give a sensible area per player, around 250–330 m², which is what
  11v11 has.
- Team-level coordination is per team: the shape, the line and the defensive
  assignment. Individual decisions are per player and staggered.
- The space model costs candidates × players and runs at decision rate, not
  tick rate.

## Delivery

The work lands as a series of stacked PRs:

1. **Squads refactor.** Replace the `striker`/`defender` singletons with
   squads, a carrier and a presser. Behaviour doesn't change.
2. **Space model.** Add zones, threat, arrival time, control and pass safety,
   with a debug overlay.
3. **Teammates and shape.** Add a second outfielder a side, formations and the
   block, the natural-movement rules (areas, effort, hysteresis, staggered
   decisions), the presser and its cover, and a pitch sized for the format.
4. **Passing and receiving.** Add passes to feet and through balls, weight,
   the passing and first touch grades, interception by anyone, and the
   carrier's choice between shooting, carrying and passing.
5. **Offside.** Add the law, the indirect free kick, and players who respect
   the line.
6. **Off-ball runs and calls.** Add the intentions, the run lifecycle and
   calls, and the vision and off-the-ball grades.
7. **Defending as a unit.** Add assignment, marking, handovers, the line and
   pressing triggers, and the positioning grade.

Each PR has a check that its movement looks natural, as well as tests of its
rules. The movement check is a headless match that measures off-ball players
against how real players move: how much of the time they are walking, jogging
or sprinting; how often they reverse direction; and how far teammates stay
apart.
