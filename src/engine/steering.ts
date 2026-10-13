import {
  THROW_IN_DISTANCE, WALL_DISTANCE, STEER_ACCEL, STEER_ARRIVAL_TIME, STEER_BODY_RADIUS, STEER_BRAKE,
  STEER_CLOSE_ARRIVAL_TIME, STEER_CONTACT_PASSES, STEER_FACE_SPEED, STEER_JOG_TURN, STEER_MAX_SPEED,
  STEER_SEPARATION_RADIUS, STEER_SEPARATION_SPEED, STEER_SPRINT_TURN, STEER_SUBSTEPS,
} from "./constants";
import { accelFactor, fatigueRate, paceFactor, speedFactor, tire } from "./fatigue";
import { PITCH_LENGTH, PITCH_WIDTH, type Vec } from "./geometry";
import { owner, type MatchPlayer, type MatchState } from "./state";

const clamp = (n: number, max: number) => Math.max(0, Math.min(max, n));
const norm = (x: number, y: number) => Math.sqrt(x * x + y * y);

export function turnFacing(p: MatchPlayer, ball: Vec, dt: number): void {
  const speed = norm(p.vel.x, p.vel.y);
  const x = speed > STEER_FACE_SPEED ? p.vel.x : ball.x - p.pos.x;
  const y = speed > STEER_FACE_SPEED ? p.vel.y : ball.y - p.pos.y;
  if (x === 0 && y === 0) return;
  let delta = Math.atan2(y, x) - p.facing;
  if (delta > Math.PI) delta -= 2 * Math.PI;
  if (delta < -Math.PI) delta += 2 * Math.PI;
  const rate = STEER_JOG_TURN + (STEER_SPRINT_TURN - STEER_JOG_TURN) * Math.min(1, speed / STEER_MAX_SPEED);
  p.facing += Math.max(-rate * dt, Math.min(rate * dt, delta));
  if (p.facing > Math.PI) p.facing -= 2 * Math.PI;
  if (p.facing < -Math.PI) p.facing += 2 * Math.PI;
}

// The carrier and off-ball players use exactly the same acceleration/arrival law.
// Position and velocity are held in locals across the substeps and written back once,
// because repeated property writes on the player objects are the dominant cost here.
export function steerPlayer(p: MatchPlayer, target: Vec, speed: number, standOff: number, ball: Vec,
  separationX = 0, separationY = 0, acceleration = STEER_ACCEL, restartRadius = 0): void {
  const dt = 1 / STEER_SUBSTEPS;
  const pace = paceFactor(p);
  const maxSpeed = Math.min(STEER_MAX_SPEED * pace, speed * speedFactor(p) * pace);
  const brake = STEER_BRAKE;
  // Acceleration is scaled by the player's acceleration; the arrival choice above keeps the unscaled argument
  const accel = acceleration * accelFactor(p);
  let x = p.pos.x, y = p.pos.y, velX = p.vel.x, velY = p.vel.y;
  const rate = fatigueRate(p);
  let energy = p.energy;
  for (let step = 0; step < STEER_SUBSTEPS; step++) {
    const dx = target.x - x, dy = target.y - y;
    const d = norm(dx, dy), remaining = Math.max(0, d - standOff);
    const arrive = Math.min(maxSpeed, remaining / (acceleration > STEER_ACCEL ? STEER_CLOSE_ARRIVAL_TIME : STEER_ARRIVAL_TIME), Math.sqrt(2 * brake * remaining));
    let vx = (d > 0 ? dx / d * arrive : 0) + separationX;
    let vy = (d > 0 ? dy / d * arrive : 0) + separationY;
    const desiredSpeed = norm(vx, vy);
    if (desiredSpeed > maxSpeed) { vx *= maxSpeed / desiredSpeed; vy *= maxSpeed / desiredSpeed; }
    // Unclamped, the desired speed is still desiredSpeed; only a clamp changes it
    const wanted = desiredSpeed > maxSpeed ? norm(vx, vy) : desiredSpeed;
    const braking = vx * velX + vy * velY < 0 || wanted < norm(velX, velY);
    const ax = vx - velX, ay = vy - velY;
    const change = norm(ax, ay), limit = (braking ? brake : accel) * dt;
    const fraction = change > limit ? limit / change : 1;
    velX += ax * fraction;
    velY += ay * fraction;
    const oldX = x, oldY = y;
    x = clamp(oldX + velX * dt, PITCH_LENGTH);
    y = clamp(oldY + velY * dt, PITCH_WIDTH);
    if (restartRadius > 0) {
      p.pos.x = x; p.pos.y = y; p.vel.x = velX; p.vel.y = velY;
      constrainCircle(p, ball, Math.min(restartRadius, norm(oldX - ball.x, oldY - ball.y)));
      x = p.pos.x; y = p.pos.y; velX = p.vel.x; velY = p.vel.y;
    }
    if (x === 0 || x === PITCH_LENGTH) velX = 0;
    if (y === 0 || y === PITCH_WIDTH) velY = 0;
    // Same as tire(p, metres), with energy held locally across the substeps
    energy = Math.max(0, energy - norm(x - oldX, y - oldY) * rate);
  }
  p.pos.x = x; p.pos.y = y; p.vel.x = velX; p.vel.y = velY; p.energy = energy;
  turnFacing(p, ball, 1);
}

// Scratch space is not match data. Reuse it rather than allocating per pair/tick.
interface Buffer { orders: Float64Array; separation: Float64Array }
const buffers = new WeakMap<MatchState, Buffer>();
export function movementBuffer(state: MatchState): Buffer {
  let buffer = buffers.get(state);
  if (!buffer || buffer.orders.length < state.players.length * 5) {
    buffer = { orders: new Float64Array(state.players.length * 5), separation: new Float64Array(state.players.length * 2) };
    buffers.set(state, buffer);
  }
  return buffer;
}

// Typed copies of every body's kinematics, used by the O(n^2) pair passes.
// Module scratch only: it is fully rewritten at the start of each pass that uses it.
interface Bodies { x: Float64Array; y: Float64Array; vx: Float64Array; vy: Float64Array; radius: Float64Array }
let bodies: Bodies = { x: new Float64Array(0), y: new Float64Array(0), vx: new Float64Array(0), vy: new Float64Array(0), radius: new Float64Array(0) };
function bodyScratch(n: number): Bodies {
  if (bodies.x.length < n) {
    bodies = { x: new Float64Array(n), y: new Float64Array(n), vx: new Float64Array(n), vy: new Float64Array(n), radius: new Float64Array(n) };
  }
  return bodies;
}

// A stable, antisymmetric direction for coincident bodies, without consuming RNG.
function coincidence(p: MatchPlayer, q: MatchPlayer): number {
  const first = p.id < q.id ? p.id : q.id, second = p.id < q.id ? q.id : p.id;
  let hash = 0;
  for (let i = 0; i < first.length; i++) hash = (Math.imul(hash, 31) + first.charCodeAt(i)) | 0;
  for (let i = 0; i < second.length; i++) hash = (Math.imul(hash, 31) + second.charCodeAt(i)) | 0;
  return (hash >>> 0) / 0x100000000 * Math.PI * 2 + (p.id < q.id ? 0 : Math.PI);
}

export function separation(state: MatchState, buffer: Buffer): void {
  buffer.separation.fill(0);
  const n = state.players.length;
  const { x, y } = bodyScratch(n);
  // Positions do not move during this pass, so one snapshot serves every pair
  for (let i = 0; i < n; i++) { x[i] = state.players[i]!.pos.x; y[i] = state.players[i]!.pos.y; }
  const radius = STEER_SEPARATION_RADIUS, radius2 = radius * radius;
  for (let i = 0; i < n; i++) {
    const xi = x[i]!, yi = y[i]!;
    for (let j = i + 1; j < n; j++) {
      const dx = xi - x[j]!;
      // Cheap reject: |dx| >= radius already implies d2 >= radius^2
      if (dx >= radius || dx <= -radius) continue;
      const dy = yi - y[j]!, d2 = dx * dx + dy * dy;
      if (d2 >= radius2) continue;
      const p = state.players[i]!, q = state.players[j]!;
      const d = Math.sqrt(d2), angle = d === 0 ? coincidence(p, q) : 0;
      const strength = STEER_SEPARATION_SPEED * (1 - d / radius);
      const sx = (d > 0 ? dx / d : Math.cos(angle)) * strength;
      const sy = (d > 0 ? dy / d : Math.sin(angle)) * strength;
      buffer.separation[i * 2]! += sx; buffer.separation[i * 2 + 1]! += sy;
      buffer.separation[j * 2]! -= sx; buffer.separation[j * 2 + 1]! -= sy;
    }
  }
}

// The legal stand-back circle is an obstacle during a restart. Contact must not
// push a player back inside it (or undo their progress while they are escaping).
function constrainCircle(p: MatchPlayer, ball: Vec, minimum: number): void {
  const dx = p.pos.x - ball.x, dy = p.pos.y - ball.y, d = norm(dx, dy);
  if (d > 0 && d < minimum) {
    p.pos.x = clamp(ball.x + dx * minimum / d, PITCH_LENGTH);
    p.pos.y = clamp(ball.y + dy * minimum / d, PITCH_WIDTH);
    const inward = (p.vel.x * dx + p.vel.y * dy) / d;
    if (inward < 0) { p.vel.x -= dx / d * inward; p.vel.y -= dy / d * inward; }
  }
}

// Same constraint as constrainCircle, on the typed body arrays.
function constrainBody(b: Bodies, i: number, ball: Vec, minimum: number): void {
  const dx = b.x[i]! - ball.x, dy = b.y[i]! - ball.y, d = norm(dx, dy);
  if (d > 0 && d < minimum) {
    b.x[i] = clamp(ball.x + dx * minimum / d, PITCH_LENGTH);
    b.y[i] = clamp(ball.y + dy * minimum / d, PITCH_WIDTH);
    const inward = (b.vx[i]! * dx + b.vy[i]! * dy) / d;
    if (inward < 0) { b.vx[i]! -= dx / d * inward; b.vy[i]! -= dy / d * inward; }
  }
}

export function restartRadius(state: MatchState, p: MatchPlayer): number {
  return restartRadiusFor(state, owner(state), p);
}

// Same as restartRadius, for callers that already know who is taking the restart.
export function restartRadiusFor(state: MatchState, taker: MatchPlayer | undefined, p: MatchPlayer): number {
  if (state.ball.setPiece === null || state.ball.setPiece === "kickoff") return 0;
  if (!taker || p === taker || (p.side === taker.side && state.ball.setPiece !== "penalty") ||
    (state.ball.setPiece === "penalty" && p.position === "GK")) return 0;
  return state.ball.setPiece === "throw_in" ? THROW_IN_DISTANCE : WALL_DISTANCE;
}

function contactPosition(b: Bodies, ball: Vec, i: number, x: number, y: number): void {
  const radius = b.radius[i]!;
  if (radius === 0) {
    b.x[i] = clamp(x, PITCH_LENGTH); b.y[i] = clamp(y, PITCH_WIDTH);
    return;
  }
  const minimum = Math.min(radius, norm(b.x[i]! - ball.x, b.y[i]! - ball.y));
  b.x[i] = clamp(x, PITCH_LENGTH); b.y[i] = clamp(y, PITCH_WIDTH);
  constrainBody(b, i, ball, minimum);
}

export function separateBodies(state: MatchState): void {
  const diameter = STEER_BODY_RADIUS * 2, diameter2 = diameter * diameter;
  const n = state.players.length;
  // Contact never changes who has the ball, so one lookup serves every pass
  const taker = owner(state);
  const b = bodyScratch(n);
  const ball = state.ball.pos;
  for (let i = 0; i < n; i++) {
    const p = state.players[i]!;
    b.x[i] = p.pos.x; b.y[i] = p.pos.y; b.vx[i] = p.vel.x; b.vy[i] = p.vel.y;
    b.radius[i] = restartRadiusFor(state, taker, p);
  }
  const bx = b.x, by = b.y, bvx = b.vx, bvy = b.vy;
  for (let pass = 0; pass < STEER_CONTACT_PASSES; pass++) {
    let contacts = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        // Position i is re-read after each contact, which may have moved it
        const dx = bx[i]! - bx[j]!;
        if (dx >= diameter || dx <= -diameter) continue;
        const dy = by[i]! - by[j]!, d2 = dx * dx + dy * dy;
        if (d2 >= diameter2) continue;
        contacts++;
        const p = state.players[i]!, q = state.players[j]!;
        const d = Math.sqrt(d2), angle = d === 0 ? coincidence(p, q) : 0;
        const nx = d > 0 ? dx / d : Math.cos(angle), ny = d > 0 ? dy / d : Math.sin(angle);
        const correction = (diameter - d) / 2;
        const px = b.x[i]!, py = b.y[i]!, qx = b.x[j]!, qy = b.y[j]!;
        contactPosition(b, ball, i, px + nx * correction, py + ny * correction);
        contactPosition(b, ball, j, qx - nx * correction, qy - ny * correction);
        tire(p, norm(b.x[i]! - px, b.y[i]! - py)); tire(q, norm(b.x[j]! - qx, b.y[j]! - qy));
        // Inelastic normal contact preserves tangential movement, avoiding bounce/jitter.
        const closing = (b.vx[i]! - b.vx[j]!) * nx + (b.vy[i]! - b.vy[j]!) * ny;
        if (closing < 0) {
          b.vx[i]! -= nx * closing / 2; b.vy[i]! -= ny * closing / 2;
          b.vx[j]! += nx * closing / 2; b.vy[j]! += ny * closing / 2;
        }
      }
    }
    if (contacts === 0) break;
  }
  for (let i = 0; i < n; i++) {
    const p = state.players[i]!;
    p.pos.x = b.x[i]!; p.pos.y = b.y[i]!; p.vel.x = b.vx[i]!; p.vel.y = b.vy[i]!;
  }
  // Exchanging normal momentum can combine a fast tangent with a fast normal.
  for (const p of state.players) {
    const speed = norm(p.vel.x, p.vel.y);
    if (speed > STEER_MAX_SPEED) {
      p.vel.x *= STEER_MAX_SPEED / speed;
      p.vel.y *= STEER_MAX_SPEED / speed;
    }
  }
}
