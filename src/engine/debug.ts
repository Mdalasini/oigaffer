import type { Option } from "./decide";
import type { Vec } from "./geometry";
import type { MatchPlayer, MatchState } from "./state";

// Optional hooks for throwaway debugging probes (intent logs and "why" traces; see
// .claude/skills/verify-player-behaviour). The engine calls them only when they are set
// and never reads anything back, so a match plays out the same with or without them.
// Nothing in src/ should set them.

// Why a player is moving where he is this second
export type Intent =
  // The ball carrier
  | "walk_to_restart" // taker walking to the ball
  | "hold" // on the ball and not moving: about to act or waiting at a restart
  | "first_touch" // controlling a received ball, shielding it
  | "look_up" // carrying slowly while picking an option
  | "take_on" // bursting past a defender after a won dribble
  // Off the ball
  | "kickoff"
  | "penalty_position"
  | "set_piece_position" // attacking or defending a corner
  | "receive" // running to meet a pass, cross or through ball
  | "press" // closing down the carrier
  | "chase" // going for a loose ball
  | "keeper"
  | "mark" // goal-side of an attacker
  | "cover" // spare defender dropping behind the line out of possession
  | "on_shoulder" // forward on the last defender's shoulder in possession
  | "shape" // holding his place in the formation
  | "give_room"; // standing back from an opponent's restart

export interface DebugHook {
  // Once per player per second, after targets are chosen and before anyone moves.
  // target is world coordinates; speed in m/s.
  intent?(state: MatchState, player: MatchPlayer, intent: Intent, target: Vec, speed: number): void;
  // Every time a carrier chooses. probabilities[i] is the softmax chance of options[i].
  decision?(state: MatchState, carrier: MatchPlayer, options: Option[], probabilities: number[], chosen: number): void;
}
