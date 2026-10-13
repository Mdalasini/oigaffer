import { restingBall, type Ball } from "./ball";
import { averageAttributes, type Attributes, type Player } from "./player";
import { seededRng, type Rng } from "./random";
import { vec, type Vec } from "./vec";

export type TouchKind = "control" | "dribble" | "shot";

export interface Touch {
  time: number;
  playerId: string;
  kind: TouchKind;
  at: Vec; // where the ball was played from
  ballVel: Vec; // horizontal velocity given to the ball
  vz: number;
  chance?: number; // for a shot, the shooter's estimate of hitting the target
}

export type Result = { kind: "goal" | "out" | "time"; time: number };

export interface World {
  time: number; // s
  ball: Ball;
  players: Player[];
  touches: Touch[];
  result: Result | null;
  timeLimit: number; // s
  rng: Rng;
}

export interface PlayerSetup {
  id?: string;
  pos: Vec;
  facing: number;
  vel?: Vec;
  attributes?: Partial<Attributes>;
}

export function makeWorld(setup: { players: PlayerSetup[]; ball: Ball | Vec; seed: number; timeLimit?: number }): World {
  const ball = "z" in setup.ball ? setup.ball : restingBall(setup.ball);
  return {
    time: 0,
    ball: { pos: { ...ball.pos }, z: ball.z, vel: { ...ball.vel }, vz: ball.vz },
    players: setup.players.map((p, i) => ({
      id: p.id ?? `p${i + 1}`,
      attributes: { ...averageAttributes(), ...p.attributes },
      pos: { ...p.pos },
      vel: p.vel ? { ...p.vel } : vec(0, 0),
      facing: p.facing,
      touchReadyAt: 0,
      intent: { action: "wait", move: vec(0, 0), target: { ...ball.pos } },
    })),
    touches: [],
    result: null,
    timeLimit: setup.timeLimit ?? 30,
    rng: seededRng(setup.seed),
  };
}

export const lastTouch = (w: World): Touch | undefined => w.touches.at(-1);
