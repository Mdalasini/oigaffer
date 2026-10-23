import type { Phase, Restart } from './state'

export type SimEvent =
  | { type: 'kick'; tick: number; by: number; kind: KickKind; to: number; x: number; y: number }
  | { type: 'control'; tick: number; by: number; x: number; y: number }
  | { type: 'out'; tick: number; restart: Restart; team: number; x: number; y: number; lastTouch: number }
  | { type: 'goal'; tick: number; team: number; scorer: number }
  | { type: 'phase'; tick: number; phase: Phase }

export type KickKind = 'pass' | 'touch' | 'restart'

export type SimEventType = SimEvent['type']
