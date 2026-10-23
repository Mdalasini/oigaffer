import { useEffect, useState, useSyncExternalStore } from 'react'
import { Game } from '../game/Game'
import { TICK_RATE } from '../sim/constants'
import { matchClock } from '../sim/match'
import { Phase } from '../sim/state'
import { PitchCanvas } from './PitchCanvas'

const SPEEDS = [0.5, 1, 2, 4, 8]
const PHASE_NAMES = Object.fromEntries(Object.entries(Phase).map(([k, v]) => [v, k]))

function clock(tick: number): string {
  const s = Math.floor(tick / TICK_RATE)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export function App() {
  const [game] = useState(() => new Game())
  const status = useSyncExternalStore(
    (fn) => game.subscribe(fn),
    () => {
      const m = game.sim.m
      return `${m.score[0]}|${m.score[1]}|${clock(matchClock(game.sim))}|${PHASE_NAMES[m.phase]}|${game.paused}|${game.speed}`
    },
  )
  const [home, away, time, phase, paused, speed] = status.split('|')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault()
        game.setPaused(!game.paused)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [game])

  return (
    <main className="app">
      <header className="bar">
        <span className="score">
          <span className="home">Home {game.sim.formations[0].name}</span> {home} – {away}{' '}
          <span className="away">{game.sim.formations[1].name} Away</span>
        </span>
        <span className="clock">{time}</span>
        <span className="phase">{phase}</span>
        <span className="spacer" />
        <button onClick={() => game.setPaused(paused !== 'true')}>{paused === 'true' ? 'Play' : 'Pause'}</button>
        {SPEEDS.map((s) => (
          <button key={s} className={String(s) === speed ? 'active' : ''} onClick={() => game.setSpeed(s)}>
            {s}×
          </button>
        ))}
      </header>
      <PitchCanvas game={game} />
    </main>
  )
}
