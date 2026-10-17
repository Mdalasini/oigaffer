import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Game } from '../game/Game'
import type { Outcome } from '../sim/match'
import { ControlPanel } from './ControlPanel'

const OUTCOME_BANNER: Record<Outcome, { text: string; className: string }> = {
  goal: { text: 'GOAL!', className: 'text-emerald-300' },
  save: { text: 'SAVED', className: 'text-sky-300' },
  claimed: { text: 'CLAIMED', className: 'text-sky-300' },
  wide: { text: 'WIDE', className: 'text-rose-300' },
  over: { text: 'OVER THE BAR', className: 'text-rose-300' },
}

export function App() {
  const [game] = useState(() => new Game())
  const snapshot = useSyncExternalStore(game.subscribe, game.getSnapshot)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const insetRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    try {
      return game.mount(canvasRef.current!, insetRef.current!)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [game])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return
      if (e.code === 'Space') {
        e.preventDefault()
        game.shoot()
      } else if (e.code === 'KeyR') game.reset()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [game])

  const banner = snapshot.phase === 'result' && snapshot.outcome ? OUTCOME_BANNER[snapshot.outcome] : null
  const { stats } = snapshot

  return (
    <main className="relative h-full w-full overflow-hidden bg-neutral-950 font-sans text-neutral-100 select-none">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      <div className="absolute top-4 left-4 flex gap-1 rounded-lg bg-black/55 p-1 text-sm backdrop-blur">
        <Stat label="Shots" value={stats.shots} />
        <Stat label="Goals" value={stats.goals} className="text-emerald-300" />
        <Stat label="Saves" value={stats.saves} className="text-sky-300" />
        <Stat label="Misses" value={stats.misses} className="text-rose-300" />
        <Stat label="Lost" value={stats.lost} className="text-neutral-300" />
      </div>

      {banner && (
        <div className="pointer-events-none absolute inset-x-0 top-20 text-center">
          <span className={`text-5xl font-black tracking-wider drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)] ${banner.className}`}>
            {banner.text}
          </span>
        </div>
      )}

      <div
        ref={insetRef}
        className="pointer-events-none absolute bottom-4 left-4 aspect-[12/5] w-[min(46%,460px)] rounded-md ring-2 ring-white/25"
      >
        <span className="absolute top-1.5 left-2 rounded bg-black/50 px-1.5 py-0.5 text-[11px] font-medium tracking-wide text-neutral-300 uppercase">
          Striker's view
        </span>
      </div>

      <ControlPanel game={game} snapshot={snapshot} />

      {error && (
        <div className="absolute inset-0 grid place-items-center bg-black/80 p-6 text-center text-rose-300">{error}</div>
      )}
    </main>
  )
}

function Stat({ label, value, className = '' }: { label: string; value: number; className?: string }) {
  return (
    <div className="min-w-16 rounded-md bg-white/5 px-3 py-1.5 text-center">
      <div className={`text-xl font-bold tabular-nums ${className}`}>{value}</div>
      <div className="text-[10px] tracking-wide text-neutral-400 uppercase">{label}</div>
    </div>
  )
}
