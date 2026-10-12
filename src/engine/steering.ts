import {
  THROW_IN_DISTANCE, WALL_DISTANCE, STEER_ACCEL, STEER_ARRIVAL_TIME, STEER_BODY_RADIUS, STEER_BRAKE,
  STEER_CLOSE_ARRIVAL_TIME, STEER_CONTACT_PASSES, STEER_FACE_SPEED, STEER_JOG_TURN, STEER_MAX_SPEED,
  STEER_SEPARATION_RADIUS, STEER_SEPARATION_SPEED, STEER_SPRINT_TURN, STEER_SUBSTEPS,
} from "./constants";
import { speedFactor, tire } from "./fatigue";
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
export function steerPlayer(p: MatchPlayer, target: Vec, speed: number, standOff: number, ball: Vec,
  separationX = 0, separationY = 0, acceleration = STEER_ACCEL, restartRadius = 0): void {
  const dt = 1 / STEER_SUBSTEPS;
  const maxSpeed = Math.min(STEER_MAX_SPEED, speed * speedFactor(p));
  const brake = STEER_BRAKE;
  for (let step = 0; step < STEER_SUBSTEPS; step++) {
    const dx = target.x - p.pos.x, dy = target.y - p.pos.y;
    const d = norm(dx, dy), remaining = Math.max(0, d - standOff);
    const arrive = Math.min(maxSpeed, remaining / (acceleration > STEER_ACCEL ? STEER_CLOSE_ARRIVAL_TIME : STEER_ARRIVAL_TIME), Math.sqrt(2 * brake * remaining));
    let vx = (d > 0 ? dx / d * arrive : 0) + separationX;
    let vy = (d > 0 ? dy / d * arrive : 0) + separationY;
    const desiredSpeed = norm(vx, vy);
    if (desiredSpeed > maxSpeed) { vx *= maxSpeed / desiredSpeed; vy *= maxSpeed / desiredSpeed; }
    const braking = vx * p.vel.x + vy * p.vel.y < 0 || norm(vx, vy) < norm(p.vel.x, p.vel.y);
    const ax = vx - p.vel.x, ay = vy - p.vel.y;
    const change = norm(ax, ay), limit = (braking ? brake : acceleration) * dt;
    const fraction = change > limit ? limit / change : 1;
    p.vel.x += ax * fraction;
    p.vel.y += ay * fraction;
    const oldX = p.pos.x, oldY = p.pos.y;
    p.pos.x = clamp(oldX + p.vel.x * dt, PITCH_LENGTH);
    p.pos.y = clamp(oldY + p.vel.y * dt, PITCH_WIDTH);
    if (restartRadius > 0) {
      constrainCircle(p, ball, Math.min(restartRadius, norm(oldX - ball.x, oldY - ball.y)));
    }
    if (p.pos.x === 0 || p.pos.x === PITCH_LENGTH) p.vel.x = 0;
    if (p.pos.y === 0 || p.pos.y === PITCH_WIDTH) p.vel.y = 0;
    tire(p, norm(p.pos.x - oldX, p.pos.y - oldY));
  }
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
  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i]!;
    for (let j = i + 1; j < state.players.length; j++) {
      const q = state.players[j]!;
      const dx = p.pos.x - q.pos.x, dy = p.pos.y - q.pos.y, d2 = dx * dx + dy * dy;
      if (d2 >= STEER_SEPARATION_RADIUS * STEER_SEPARATION_RADIUS) continue;
      const d = Math.sqrt(d2), angle = d === 0 ? coincidence(p, q) : 0;
      const strength = STEER_SEPARATION_SPEED * (1 - d / STEER_SEPARATION_RADIUS);
      const x = (d > 0 ? dx / d : Math.cos(angle)) * strength;
      const y = (d > 0 ? dy / d : Math.sin(angle)) * strength;
      buffer.separation[i * 2]! += x; buffer.separation[i * 2 + 1]! += y;
      buffer.separation[j * 2]! -= x; buffer.separation[j * 2 + 1]! -= y;
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

export function restartRadius(state: MatchState, p: MatchPlayer): number {
  if (state.ball.setPiece === null || state.ball.setPiece === "kickoff") return 0;
  const taker = owner(state);
  if (!taker || p === taker || (p.side === taker.side && state.ball.setPiece !== "penalty") ||
    (state.ball.setPiece === "penalty" && p.position === "GK")) return 0;
  return state.ball.setPiece === "throw_in" ? THROW_IN_DISTANCE : WALL_DISTANCE;
}

function contactPosition(state: MatchState, p: MatchPlayer, x: number, y: number): void {
  const radius = restartRadius(state, p);
  if (radius === 0) {
    p.pos.x = clamp(x, PITCH_LENGTH); p.pos.y = clamp(y, PITCH_WIDTH);
    return;
  }
  const minimum = Math.min(radius, norm(p.pos.x - state.ball.pos.x, p.pos.y - state.ball.pos.y));
  p.pos.x = clamp(x, PITCH_LENGTH); p.pos.y = clamp(y, PITCH_WIDTH);
  if (radius > 0) constrainCircle(p, state.ball.pos, minimum);
}

export function separateBodies(state: MatchState): void {
  const diameter = STEER_BODY_RADIUS * 2;
  for (let pass = 0; pass < STEER_CONTACT_PASSES; pass++) {
    let contacts = 0;
    for (let i = 0; i < state.players.length; i++) {
      const p = state.players[i]!;
      for (let j = i + 1; j < state.players.length; j++) {
        const q = state.players[j]!;
        const dx = p.pos.x - q.pos.x, dy = p.pos.y - q.pos.y, d2 = dx * dx + dy * dy;
        if (d2 >= diameter * diameter) continue;
        contacts++;
        const d = Math.sqrt(d2), angle = d === 0 ? coincidence(p, q) : 0;
        const nx = d > 0 ? dx / d : Math.cos(angle), ny = d > 0 ? dy / d : Math.sin(angle);
        const correction = (diameter - d) / 2;
        const px = p.pos.x, py = p.pos.y, qx = q.pos.x, qy = q.pos.y;
        contactPosition(state, p, px + nx * correction, py + ny * correction);
        contactPosition(state, q, qx - nx * correction, qy - ny * correction);
        tire(p, norm(p.pos.x - px, p.pos.y - py)); tire(q, norm(q.pos.x - qx, q.pos.y - qy));
        // Inelastic normal contact preserves tangential movement, avoiding bounce/jitter.
        const closing = (p.vel.x - q.vel.x) * nx + (p.vel.y - q.vel.y) * ny;
        if (closing < 0) {
          p.vel.x -= nx * closing / 2; p.vel.y -= ny * closing / 2;
          q.vel.x += nx * closing / 2; q.vel.y += ny * closing / 2;
        }
      }
    }
    if (contacts === 0) break;
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
