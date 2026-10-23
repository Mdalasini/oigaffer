import { useEffect, useState, useSyncExternalStore } from 'react'
import { Game } from '../game/Game'
import type { Flag } from '../replay/flag'
import { frameValue } from '../replay/recorder'
import { clock } from '../replay/report'
import { TICK_RATE } from '../sim/constants'
import { matchClock } from '../sim/match'
import { INTENT_NAMES, type IntentKind } from '../sim/intents'
import { label, roleOf } from '../sim/sim'
import { Phase } from '../sim/state'
import { PitchCanvas } from './PitchCanvas'

const SPEEDS = [0.5, 1, 2, 4, 8]
const PHASE_NAMES = Object.fromEntries(Object.entries(Phase).map(([k, v]) => [v, k]))

function useGame(game: Game) {
  return useSyncExternalStore(
    (fn) => game.subscribe(fn),
    () => {
      const m = game.sim.m
      const shown = game.shownTick()
      const sel = game.selected.map((e) => `${e}:${intentOf(game, e)}`).join(',')
      return `${m.score[0]}|${m.score[1]}|${Math.floor(shown / TICK_RATE)}|${m.phase}|${game.paused}|${game.speed}|${game.scrubTick}|${sel}`
    },
  )
}

function intentOf(game: Game, eid: number): string {
  const kind =
    game.scrubTick === null
      ? game.sim.c.Intent.kind[eid]
      : frameValue(game.rec.frame(game.scrubTick), game.rec.entities.indexOf(eid), 'intent')
  return INTENT_NAMES[kind as IntentKind]
}

async function saveFlag(flag: Flag): Promise<string> {
  const body = JSON.stringify(flag)
  try {
    const res = await fetch('/__flags', { method: 'POST', body })
    if (res.ok) return (await res.json()).path
  } catch {}
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([body], { type: 'application/json' }))
  a.download = `flag-${flag.flagTick}.json`
  a.click()
  return a.download
}

export function App() {
  const [game] = useState(() => new Game())
  useGame(game)
  const [flagOpen, setFlagOpen] = useState(false)
  const [toast, setToast] = useState('')
  const m = game.sim.m
  const scrubbing = game.scrubTick !== null

  useEffect(() => {
    const name = new URLSearchParams(location.search).get('flag')
    if (!name) return
    fetch(`/__flags/${encodeURIComponent(name)}`)
      .then((r) => r.json())
      .then((flag: Flag) => game.loadFlag(flag))
      .catch(() => setToast(`Could not load flag ${name}`))
  }, [game])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (flagOpen || (e.target as HTMLElement).closest('input, textarea')) return
      if (e.code === 'Space') {
        e.preventDefault()
        game.setPaused(!game.paused)
      } else if (e.code === 'KeyF') {
        e.preventDefault()
        game.setPaused(true)
        setFlagOpen(true)
      } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        e.preventDefault()
        const delta = (e.code === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? TICK_RATE : 1)
        game.scrubTo(game.shownTick() + delta)
      } else if (e.code === 'Escape') {
        game.clearSelection()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [game, flagOpen])

  return (
    <main className="app">
      <header className="bar">
        <span className="score">
          <span className="home">Home {game.sim.formations[0].name}</span> {m.score[0]} – {m.score[1]}{' '}
          <span className="away">{game.sim.formations[1].name} Away</span>
        </span>
        <span className="clock">{clock(matchClock(game.sim) - (m.tick - game.shownTick()))}</span>
        <span className="phase">{PHASE_NAMES[m.phase]}</span>
        <span className="spacer" />
        <button onClick={() => game.setPaused(!game.paused)}>{game.paused ? 'Play' : 'Pause'}</button>
        {SPEEDS.map((s) => (
          <button key={s} className={s === game.speed ? 'active' : ''} onClick={() => game.setSpeed(s)}>
            {s}×
          </button>
        ))}
        <button
          className="flag"
          onClick={() => {
            game.setPaused(true)
            setFlagOpen(true)
          }}
          title="Flag this moment (F)"
        >
          Flag
        </button>
      </header>
      <PitchCanvas game={game} />
      <footer className="bar">
        {game.paused && game.rec.length > 0 ? (
          <input
            className="scrub"
            type="range"
            min={game.rec.firstTick()}
            max={game.rec.lastTick()}
            value={game.shownTick()}
            onChange={(e) => game.scrubTo(Number(e.target.value))}
          />
        ) : (
          <span className="hint">Space pause · ←/→ step (shift = 1 s) · click players to select · F flag</span>
        )}
        {scrubbing && <span className="hint">{((game.shownTick() - m.tick) / TICK_RATE).toFixed(1)} s</span>}
        <span className="selected">
          {game.selected.map((e) => `${label(game.sim, e)} ${roleOf(game.sim, e)} ${intentOf(game, e)}`).join(' · ')}
        </span>
        {toast && <span className="toast">{toast}</span>}
      </footer>
      {flagOpen && (
        <FlagDialog
          subjects={game.selected.map((e) => label(game.sim, e))}
          at={clock(game.shownTick())}
          onCancel={() => setFlagOpen(false)}
          onSave={async (note) => {
            setFlagOpen(false)
            try {
              setToast(`Saved ${await saveFlag(game.flag(note))}`)
            } catch (err) {
              setToast(`Flag failed: ${(err as Error).message}`)
            }
          }}
        />
      )}
    </main>
  )
}

function FlagDialog(props: { subjects: string[]; at: string; onCancel: () => void; onSave: (note: string) => void }) {
  const [note, setNote] = useState('')
  return (
    <div className="dialog-backdrop" onClick={props.onCancel}>
      <form
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          props.onSave(note)
        }}
      >
        <h2>Flag {props.at}</h2>
        <p>Players: {props.subjects.join(', ') || 'none selected (click players on the pitch first)'}</p>
        <textarea
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) props.onSave(note)
            if (e.key === 'Escape') props.onCancel()
          }}
          placeholder="What is not quite right? e.g. H7 should not run back towards his own goal here"
          rows={4}
        />
        <div className="actions">
          <button type="button" onClick={props.onCancel}>
            Cancel
          </button>
          <button type="submit">Save flag</button>
        </div>
      </form>
    </div>
  )
}
