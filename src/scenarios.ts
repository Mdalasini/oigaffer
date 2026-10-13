import { restingBall } from "./ball";
import { PITCH_LENGTH, PITCH_WIDTH } from "./pitch";
import { vec } from "./vec";
import { makeWorld, type World } from "./world";

export interface Scenario {
  name: string;
  description: string;
  setup: (seed: number) => World;
}

const mid = PITCH_WIDTH / 2;

// One player, one ball, an empty goal at x = 105
export const SCENARIOS: Scenario[] = [
  {
    name: "Carry from halfway",
    description: "Ball at the feet on the halfway line, facing goal.",
    setup: (seed) => makeWorld({ seed, players: [{ pos: vec(52, mid), facing: 0 }], ball: vec(52.7, mid) }),
  },
  {
    name: "Go to a still ball",
    description: "The ball is 15 m away, off to one side.",
    setup: (seed) => makeWorld({ seed, players: [{ pos: vec(60, 20), facing: 0 }], ball: vec(72, 30) }),
  },
  {
    name: "Facing own goal",
    description: "Ball at the feet 25 m out, back to goal: turn, then go.",
    setup: (seed) => makeWorld({ seed, players: [{ pos: vec(PITCH_LENGTH - 25, mid), facing: Math.PI }], ball: vec(PITCH_LENGTH - 25.7, mid) }),
  },
  {
    name: "Pass from the side",
    description: "A firm pass rolls in from the left; control it and go.",
    setup: (seed) =>
      makeWorld({
        seed,
        players: [{ pos: vec(80, 30), facing: Math.PI / 2 }],
        ball: { ...restingBall(vec(70, 52)), vel: vec(4.5, -9.5) },
      }),
  },
  {
    name: "Wide by the byline",
    description: "Ball at the feet near the corner of the box.",
    setup: (seed) => makeWorld({ seed, players: [{ pos: vec(98, 12), facing: 0.6 }], ball: vec(98.6, 12.4) }),
  },
];
