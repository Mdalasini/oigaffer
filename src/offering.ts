import { ACCELERATION, MAX_DRIBBLE_TOUCH_SPEED, OFFER_DEPTHS, OFFER_HORIZON, OFFER_WIDTHS, PITCH_LENGTH, PITCH_WIDTH, TOUCH_INTERVAL } from "./constants";
import { distanceRunIn } from "./defender";
import type { Keeper } from "./keeper";
import { steer, type Aim, type Body } from "./running";
import type { Point } from "./shooting";
import { canGetThere, closingIn, passValue, type Opponent, type Receiver, type Runner } from "./valuation";

export type Offer = { along: number; across: number };

export type Scene = {
  ball: [x: number, y: number];
  path: [vx: number, vy: number];
  carried: boolean;
  forward: number;
  defenders: Opponent[];
  standingOpponents: [x: number, y: number][];
  keeper: Keeper | null;
};

function carryingOn({ path }: Scene) {
  const speed = Math.hypot(path[0], path[1]);
  return { speed, onwardX: speed > 0 ? path[0] / speed : 0, onwardY: speed > 0 ? path[1] / speed : 0 };
}

export function ballAt(scene: Scene, time: number): Point {
  const { ball, path, carried } = scene;
  if (!carried) return [ball[0] + path[0] * time, ball[1] + path[1] * time, 0];
  const { speed, onwardX, onwardY } = carryingOn(scene);
  const along = distanceRunIn(time, MAX_DRIBBLE_TOUCH_SPEED, speed);
  return [ball[0] + onwardX * along, ball[1] + onwardY * along, 0];
}

function ballVelocityAt(scene: Scene, time: number): [vx: number, vy: number] {
  if (!scene.carried) return scene.path;
  const { speed, onwardX, onwardY } = carryingOn(scene);
  const speedThen = Math.min(Math.max(speed, MAX_DRIBBLE_TOUCH_SPEED), speed + ACCELERATION * time);
  return [onwardX * speedThen, onwardY * speedThen];
}

const defendersAt = (scene: Scene, time: number) => scene.defenders.map((defender) => closingIn(defender, ballAt(scene, time), time));

export function onsideLimit(scene: Scene, time: number): number {
  const { forward } = scene;
  const opponentsX = [...defendersAt(scene, time).map(({ at }) => at[0]), ...scene.standingOpponents.map(([x]) => x)];
  const secondLast = opponentsX.sort((a, b) => forward * (b - a))[1];
  const ballX = ballAt(scene, time)[0];
  const line = secondLast ?? (forward > 0 ? PITCH_LENGTH : 0);
  return forward * line < forward * ballX ? ballX : line;
}

export function offerAim({ along, across }: Offer, scene: Scene, time: number): Aim {
  const [ballX, ballY] = ballAt(scene, time);
  const [ballVx, ballVy] = ballVelocityAt(scene, time);
  const limit = onsideLimit(scene, time);
  const wanted = ballX + scene.forward * along;
  const beyond = scene.forward * wanted > scene.forward * limit;
  return {
    x: beyond ? limit : wanted,
    y: Math.max(0, Math.min(PITCH_WIDTH, ballY + across)),
    vx: beyond ? 0 : ballVx,
    vy: ballVy,
    arrivalFacing: NaN,
  };
}

export function predictRun(body: Body, offer: Offer, scene: Scene, time: number, dt: number): Body {
  let now = body;
  for (let elapsed = 0; elapsed < time - dt / 2; elapsed += dt) {
    const steered = steer(now, offerAim(offer, scene, elapsed), dt).body;
    now = { ...steered, x: steered.x + steered.vx * dt, y: steered.y + steered.vy * dt };
  }
  return now;
}

const MOMENT_PRECISION = 0.02;

const isClosedDownBy = (scene: Scene, time: number) => scene.defenders.some((defender) => canGetThere(defender, ballAt(scene, time), time));

export function momentOfNeed(scene: Scene): number {
  if (!isClosedDownBy(scene, OFFER_HORIZON)) return OFFER_HORIZON;
  let [free, closed] = [0, OFFER_HORIZON];
  while (closed - free > MOMENT_PRECISION) {
    const middle = (free + closed) / 2;
    if (isClosedDownBy(scene, middle)) closed = middle;
    else free = middle;
  }
  return Math.max(0, free - TOUCH_INTERVAL);
}

export function receiverOnTheRun(body: Body, offer: Offer, scene: Scene, runner: Runner, time: number, dt: number): Receiver | null {
  const then = predictRun(body, offer, scene, time, dt);
  if (scene.forward * then.x > scene.forward * onsideLimit(scene, time)) return null;
  return { ...runner, at: [then.x, then.y], moving: [then.vx, then.vy] };
}

export function offerValue(body: Body, offer: Offer, scene: Scene, runner: Runner, dt: number): number {
  const moment = momentOfNeed(scene);
  const receiver = receiverOnTheRun(body, offer, scene, runner, moment, dt);
  return receiver ? passValue(ballAt(scene, moment), receiver, scene.keeper, defendersAt(scene, moment), dt) : 0;
}

export function withBallHeadingTo(scene: Scene, ballTo: Point, time: number): Scene {
  const path: [number, number] = time > 0 ? [(ballTo[0] - scene.ball[0]) / time, (ballTo[1] - scene.ball[1]) / time] : [0, 0];
  return { ...scene, path, carried: false };
}

export const OFFERS: Offer[] = OFFER_DEPTHS.flatMap((along) => OFFER_WIDTHS.flatMap((width) => [{ along, across: width }, { along, across: -width }]));

export function nearestOffer(at: [x: number, y: number], scene: Scene): Offer {
  const along = scene.forward * (at[0] - scene.ball[0]);
  const across = at[1] - scene.ball[1];
  return OFFERS.reduce((best, offer) =>
    Math.hypot(offer.along - along, offer.across - across) < Math.hypot(best.along - along, best.across - across) ? offer : best,
  );
}
