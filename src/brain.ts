import { stepBall, type Ball } from "./ball";
import {
  BALL_FRONT_ANGLE,
  CONTACT_HEIGHT,
  CONTROL_ERROR_BEST,
  CONTROL_ERROR_WORST,
  CONTROL_HEAVY_BEST,
  CONTROL_HEAVY_WORST,
  CONTROL_SPEED,
  DRIBBLE_ERROR_BEST,
  DRIBBLE_ERROR_WORST,
  DRIBBLE_SPEED_ERROR,
  DRIBBLE_SPEED_UP,
  DRIBBLE_TOP_SPEED,
  DRIBBLE_TOUCH_BASE,
  DRIBBLE_TOUCH_GAIN,
  AIR_DRAG,
  GRAVITY,
  MAX_TOUCH_TURN,
  PREDICT_HORIZON,
  PREDICT_STEP,
  REACH,
  ROLL_DECEL,
  SHOOT_CONFIDENCE,
  SHOT_AIM_HEIGHT,
  SHOT_ANGLE_ERROR,
  SHOT_BALL_ERROR,
  SHOT_ERROR_BEST,
  SHOT_ERROR_WORST,
  SHOT_LIFT_ERROR,
  SHOT_MAX_ANGLE,
  SHOT_RUNNING_ERROR,
  SHOT_SPEED,
  SHOT_SPEED_PER_POINT,
  TOUCH_COOLDOWN,
  TOUCH_ROOM,
  TURN_TOUCH_SOFTEN,
  TURN_RATE_STILL,
} from "./constants";
import { FAR_POST, GOAL_CENTRE, NEAR_POST, PITCH_LENGTH, PITCH_WIDTH } from "./pitch";
import { accelOf, topSpeed, type Player } from "./player";
import { gaussian } from "./random";
import { angleDiff, angleOf, dist, dot, fromAngle, length, normalize, sub, vec, type Vec } from "./vec";
import { lastTouch, type TouchKind, type World } from "./world";

// Linear in the attribute: `best` at 20, `worst` at 1
const bySkill = (attribute: number, best: number, worst: number): number => worst + ((best - worst) * (attribute - 1)) / 19;

// Abramowitz–Stegun 7.1.26, good to about 1e-7
function erf(x: number): number {
  const sign = Math.sign(x);
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return sign * y;
}

// ---------- Shooting ----------

export interface ShotOption {
  aim: number; // direction to the middle of the goal mouth as seen from the ball, rad
  halfAngle: number; // half the angle the goal mouth covers, rad
  across: number; // how far the strike is from the way the player faces, rad
  error: number; // spread of the strike's direction, rad
  chance: number; // probability of hitting the target
}

// How a strike from here would go: aimed at the middle of the goal, it's on target
// unless the direction error is larger than half the angle the goal covers
export function shotOption(p: Player, ball: Ball): ShotOption {
  const near = angleOf(sub(NEAR_POST, ball.pos));
  const far = angleOf(sub(FAR_POST, ball.pos));
  const span = angleDiff(near, far);
  const aim = near + span / 2;
  const halfAngle = Math.abs(span) / 2;
  const across = Math.abs(angleDiff(p.facing, aim));
  const running = Math.min(1, length(p.vel) / topSpeed(p));
  const ballSpeed = length(sub(ball.vel, p.vel));
  const error =
    bySkill(p.attributes.shooting, SHOT_ERROR_BEST, SHOT_ERROR_WORST) *
    (1 + SHOT_RUNNING_ERROR * running) *
    (1 + (SHOT_ANGLE_ERROR * Math.min(across, SHOT_MAX_ANGLE)) / SHOT_MAX_ANGLE) *
    (1 + SHOT_BALL_ERROR * ballSpeed);
  return { aim, halfAngle, across, error, chance: erf(halfAngle / (error * Math.SQRT2)) };
}

// ---------- Reaching the ball ----------

// Seconds to get within reach of a point at full effort: turn, then a burst that fades to top speed
export function timeToReach(p: Player, point: Vec): number {
  const toPoint = sub(point, p.pos);
  const d = length(toPoint) - REACH;
  if (d <= 0) return 0;
  const dir = normalize(toPoint);
  const turn = Math.abs(angleDiff(p.facing, angleOf(dir))) / TURN_RATE_STILL;
  const top = topSpeed(p);
  const v0 = Math.min(top, Math.max(0, dot(p.vel, dir)));
  const tau = top / accelOf(p);
  const covered = (t: number) => top * t - (top - v0) * tau * (1 - Math.exp(-t / tau));
  let lo = 0;
  let hi = d / Math.max(v0, 1) + 2 * tau;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (covered(mid) >= d) hi = mid;
    else lo = mid;
  }
  return turn + hi;
}

export interface Interception {
  point: Vec;
  time: number; // when the ball gets there
}

// The first place along the ball's path the player can get to in time, low enough to play
export function intercept(p: Player, ball: Ball): Interception {
  const future: Ball = { pos: { ...ball.pos }, z: ball.z, vel: { ...ball.vel }, vz: ball.vz };
  for (let t = 0; t <= PREDICT_HORIZON; t += PREDICT_STEP) {
    if (future.z <= CONTACT_HEIGHT && timeToReach(p, future.pos) <= t) return { point: { ...future.pos }, time: t };
    stepBall(future, PREDICT_STEP);
  }
  return { point: { ...future.pos }, time: PREDICT_HORIZON };
}

// ---------- Touches ----------

function kick(w: World, p: Player, kind: TouchKind, vel: Vec, vz = 0, chance?: number): void {
  const { ball } = w;
  w.touches.push({ time: w.time, playerId: p.id, kind, at: { ...ball.pos }, ballVel: { ...vel }, vz, chance });
  ball.vel = { ...vel };
  ball.vz = vz;
  p.touchReadyAt = w.time + TOUCH_COOLDOWN;
}

function shoot(w: World, p: Player, shot: ShotOption): void {
  const speed = SHOT_SPEED + SHOT_SPEED_PER_POINT * (p.attributes.shooting - 10);
  const miss = gaussian(w.rng) * shot.error;
  // Loft that would cross the line at the aimed height, ignoring drag
  const flight = dist(w.ball.pos, GOAL_CENTRE) / speed;
  const vz = (SHOT_AIM_HEIGHT - w.ball.z) / flight + 0.5 * GRAVITY * flight + gaussian(w.rng) * SHOT_LIFT_ERROR * speed * shot.error;
  kick(w, p, "shot", fromAngle(shot.aim + miss, speed), Math.max(0, vz), shot.chance);
}

// Metres to the nearest line going this way from a point on the pitch
function roomAhead(from: Vec, dir: number): number {
  const d = fromAngle(dir);
  const along = (pos: number, step: number, max: number) => (step > 0 ? (max - pos) / step : step < 0 ? -pos / step : Infinity);
  return Math.min(along(from.x, d.x, PITCH_LENGTH), along(from.y, d.y, PITCH_WIDTH));
}

// Fastest a ground ball can be played and still stop within `distance` (inverts the roll in ball.ts)
const speedToRoll = (distance: number): number =>
  Math.sqrt(((Math.exp(2 * AIR_DRAG * Math.max(0, distance)) - 1) * ROLL_DECEL) / AIR_DRAG);

// A touch that sets the ball ahead to run onto, weighted for a little faster than
// they're going now, so a dribbler builds up speed touch by touch. It never turns
// the ball sharper than a foot can (a player facing away turns with a few softer,
// angled touches) and never knocks it out of play.
function carryTouch(w: World, p: Player, want: number, error: number): Vec {
  const turn = Math.max(-MAX_TOUCH_TURN, Math.min(MAX_TOUCH_TURN, angleDiff(p.facing, want)));
  const dir = p.facing + turn + error * gaussian(w.rng);
  const running = Math.max(0, dot(p.vel, fromAngle(dir)));
  const building = Math.min(topSpeed(p) * DRIBBLE_TOP_SPEED, running + DRIBBLE_SPEED_UP);
  const soften = 1 - TURN_TOUCH_SOFTEN * (Math.abs(turn) / MAX_TOUCH_TURN);
  const speed = (DRIBBLE_TOUCH_BASE + DRIBBLE_TOUCH_GAIN * building) * soften * (1 + DRIBBLE_SPEED_ERROR * gaussian(w.rng));
  const room = speedToRoll(roomAhead(w.ball.pos, dir) - TOUCH_ROOM);
  return fromAngle(dir, Math.max(0.3, Math.min(speed, room)));
}

function dribble(w: World, p: Player, want: number): void {
  const running = Math.min(1, length(p.vel) / topSpeed(p));
  const error = bySkill(p.attributes.dribbling, DRIBBLE_ERROR_BEST, DRIBBLE_ERROR_WORST) * (1 + running);
  kick(w, p, "dribble", carryTouch(w, p, want, error));
}

// Take the pace off a ball that arrives quickly and set it out of the feet the way
// they want to go. A poorer touch goes astray and leaves some of the pace on it.
function control(w: World, p: Player, want: number): void {
  const incoming = length(sub(w.ball.vel, p.vel));
  const error = bySkill(p.attributes.firstTouch, CONTROL_ERROR_BEST, CONTROL_ERROR_WORST);
  const heavy = bySkill(p.attributes.firstTouch, CONTROL_HEAVY_BEST, CONTROL_HEAVY_WORST) * Math.abs(gaussian(w.rng)) * incoming;
  const set = carryTouch(w, p, want, error);
  const along = normalize(w.ball.vel);
  kick(w, p, "control", vec(set.x + along.x * heavy, set.y + along.y * heavy));
}

// ---------- Deciding ----------

function canTouch(w: World, p: Player): boolean {
  const toBall = sub(w.ball.pos, p.pos);
  return (
    w.time >= p.touchReadyAt &&
    length(toBall) <= REACH &&
    w.ball.z <= CONTACT_HEIGHT &&
    Math.abs(angleDiff(p.facing, angleOf(toBall))) <= BALL_FRONT_ANGLE
  );
}

// One player alone with a ball and an empty goal: get to the ball, take it
// towards goal, and shoot once they're confident of hitting the target.
export function think(w: World, p: Player): void {
  const { ball } = w;
  const last = lastTouch(w);

  if (last?.kind === "shot") {
    p.intent = { action: "watch", move: vec(0, 0), target: { ...ball.pos } };
    return;
  }

  const towardsGoal = angleOf(sub(GOAL_CENTRE, ball.pos));
  if (canTouch(w, p)) {
    const shot = shotOption(p, ball);
    if (shot.chance >= SHOOT_CONFIDENCE && shot.across <= SHOT_MAX_ANGLE) {
      shoot(w, p, shot);
      p.intent = { action: "shoot", move: { ...p.vel }, target: { ...GOAL_CENTRE }, note: `${Math.round(100 * shot.chance)}% on target` };
      return;
    }
    // Running onto their own touch is just the next touch; a pass or loose ball moving at pace has to be controlled
    const theirs = last?.playerId === p.id;
    if (!theirs && length(ball.vel) > CONTROL_SPEED) control(w, p, towardsGoal);
    else dribble(w, p, towardsGoal);
  }

  // Run to meet the ball, arriving as it does rather than early; carrying it is a little slower
  const mine = last?.playerId === p.id;
  const cap = topSpeed(p) * (mine ? DRIBBLE_TOP_SPEED : 1);
  const meet = intercept(p, ball);
  const toMeet = sub(meet.point, p.pos);
  const gap = Math.max(0, length(toMeet) - REACH / 2);
  const speed = Math.min(cap, gap / Math.max(meet.time, PREDICT_STEP));
  const move = gap === 0 ? { ...ball.vel } : fromAngle(angleOf(toMeet), speed);
  const chance = shotOption(p, ball).chance;
  p.intent = {
    action: mine ? "carry" : "go to ball",
    move,
    target: meet.point,
    note: `shot ${Math.round(100 * chance)}% on target`,
  };
}
