import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Game, type GameSnapshot } from '../game/Game'
import type { ChallengeKind, ChallengeResult } from '../sim/challenge'
import { DefenderMode } from '../sim/components'
import type { MatchEventKind, RestartKind, TeamStats } from '../sim/match'
import { ControlPanel } from './ControlPanel'
import { TEAM_STYLE } from './teamStyle'

const RESTART_TEXT: Record<Exclude<RestartKind, 'kick-off'>, string> = {
  'goal-kick': 'GOAL KICK',
  corner: 'CORNER',
  'throw-in': 'THROW-IN',
  'free-kick': 'FREE KICK',
}

const DEFENDER_MODE_LABEL: Record<DefenderMode, string> = {
  [DefenderMode.Jockey]: 'Jockeying',
  [DefenderMode.Run]: 'Running',
  [DefenderMode.StandTackle]: 'Standing tackle',
  [DefenderMode.SlideTackle]: 'Sliding tackle',
  [DefenderMode.Barge]: 'Barging',
  [DefenderMode.Grounded]: 'Getting up',
}

const CHALLENGE_LABEL: Record<ChallengeKind, string> = { stand: 'Standing tackle', slide: 'Sliding tackle', barge: 'Barge' }
const CHALLENGE_RESULT: Record<ChallengeResult, string> = {
  won: 'won the ball',
  poked: 'poked it loose',
  missed: 'missed',
  held: 'held off',
}

/** Banner text for each kind of moment; `null` for ones named by their restart. */
const EVENT_BANNER: Record<MatchEventKind, { text: string; className: string; withTeam?: boolean } | null> = {
  goal: { text: 'GOAL!', className: 'text-emerald-300', withTeam: true },
  caught: { text: 'CAUGHT', className: 'text-sky-300' },
  parried: { text: 'PARRIED', className: 'text-sky-300' },
  claimed: { text: 'CLAIMED', className: 'text-sky-300' },
  blocked: { text: 'BLOCKED', className: 'text-rose-300' },
  wide: { text: 'WIDE', className: 'text-rose-300' },
  over: { text: 'OVER THE BAR', className: 'text-rose-300' },
  tackled: { text: 'TACKLED', className: 'text-amber-300', withTeam: true },
  intercepted: { text: 'INTERCEPTED', className: 'text-amber-300', withTeam: true },
  offside: { text: 'OFFSIDE', className: 'text-amber-300', withTeam: true },
  out: null,
}

export function App() {
  const [game] = useState(() => new Game())
  const snapshot = useSyncExternalStore(game.subscribe, game.getSnapshot)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const insetRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  // Start folded away on narrow screens, where the panel would cover the play.
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 1000)

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

  const banner = bannerFor(snapshot)
  const defending = 1 - snapshot.possession

  return (
    <main className="relative h-full w-full overflow-hidden bg-neutral-950 font-sans text-neutral-100 select-none">
      {/* On wide screens the pitch makes room for the open control panel rather than sitting under it. */}
      <canvas ref={canvasRef} className={`absolute inset-y-0 left-0 h-full w-full ${panelOpen ? 'lg:w-[calc(100%-19rem)]' : ''}`} />

      <div className="absolute top-4 left-4 flex flex-col items-start gap-2">
        <Scoreboard stats={snapshot.stats} possession={snapshot.possession} />
        {snapshot.phase === 'held' && (
          <div className="flex items-center gap-2 rounded-md bg-black/55 px-2.5 py-1 text-xs backdrop-blur">
            <span className={`size-2 rounded-full ${TEAM_STYLE[snapshot.possession].dot}`} />
            {TEAM_STYLE[snapshot.possession].name} keeper has the ball
          </div>
        )}
        {snapshot.defenderMode !== null && (
          <div className="flex items-center gap-2 rounded-md bg-black/55 px-2.5 py-1 text-xs backdrop-blur">
            <span className={`size-2 rounded-full ${TEAM_STYLE[defending].dot}`} />
            {TEAM_STYLE[defending].name} defending: <span className="font-semibold">{DEFENDER_MODE_LABEL[snapshot.defenderMode]}</span>
            {snapshot.carrierShielding && <span className={TEAM_STYLE[snapshot.possession].text}>· {TEAM_STYLE[snapshot.possession].name} shielding</span>}
          </div>
        )}
      </div>

      {snapshot.challenge && (
        <div className="pointer-events-none absolute inset-x-0 top-56 text-center">
          <span className="rounded-md bg-black/60 px-3 py-1.5 text-sm font-semibold backdrop-blur">
            {CHALLENGE_LABEL[snapshot.challenge.kind]}: {CHALLENGE_RESULT[snapshot.challenge.result]}
          </span>
        </div>
      )}

      {banner && (
        <div className="pointer-events-none absolute inset-x-0 top-40 text-center">
          <span
            className={`font-black tracking-wider drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)] ${banner.big ? 'text-5xl' : 'text-3xl'} ${banner.className}`}
          >
            {banner.text}
            {banner.team !== undefined && <span className={`ml-3 ${TEAM_STYLE[banner.team].text}`}>{TEAM_STYLE[banner.team].name.toUpperCase()}</span>}
          </span>
        </div>
      )}

      <div
        ref={insetRef}
        className="pointer-events-none absolute bottom-4 left-4 aspect-[12/5] w-[min(40%,360px)] rounded-md ring-2 ring-white/25"
      >
        <span className="absolute top-1.5 left-2 rounded bg-black/50 px-1.5 py-0.5 text-[11px] font-medium tracking-wide text-neutral-300 uppercase">
          Goal view
        </span>
      </div>

      <ControlPanel game={game} snapshot={snapshot} open={panelOpen} onOpenChange={setPanelOpen} />

      {error && (
        <div className="absolute inset-0 grid place-items-center bg-black/80 p-6 text-center text-rose-300">{error}</div>
      )}
    </main>
  )
}

/**
 * Stoppages get a big banner until the restart; a blocked shot or the ball
 * being won back gets a smaller one for a moment, without stopping play.
 */
function bannerFor({ phase, event, restart }: GameSnapshot) {
  if (!event) return null
  const big = phase === 'stopped'
  if (event.kind === 'out' && restart && restart.kind !== 'kick-off') {
    return { text: RESTART_TEXT[restart.kind], team: restart.team, className: 'text-neutral-100', big }
  }
  const banner = EVENT_BANNER[event.kind]
  if (!banner) return null
  return { text: banner.text, team: banner.withTeam ? event.team : undefined, className: banner.className, big }
}

function Scoreboard({ stats, possession }: { stats: [TeamStats, TeamStats]; possession: number }) {
  return (
    <div className="rounded-lg bg-black/55 px-3 py-2 text-sm backdrop-blur">
      <div className="flex items-center gap-3 text-2xl font-black tabular-nums">
        {TEAM_STYLE.map((team, i) => (
          <div key={team.name} className={`flex items-center gap-2 ${i === 1 ? 'flex-row-reverse' : ''}`}>
            <span className={`size-3 rounded-full ${team.dot} ${possession === i ? 'ring-2 ring-white/80' : ''}`} />
            <span className="text-xs font-semibold tracking-wide text-neutral-300 uppercase">{team.name}</span>
            <span>{stats[i].goals}</span>
            {i === 0 && <span className="ml-1 text-neutral-500">–</span>}
          </div>
        ))}
      </div>
      <table className="mt-1 text-[11px] text-neutral-400 tabular-nums">
        <thead>
          <tr className="text-[10px] tracking-wide uppercase">
            <th />
            <th className="px-1.5 font-medium">Passes</th>
            <th className="px-1.5 font-medium">Shots</th>
            <th className="px-1.5 font-medium">Saved</th>
            <th className="px-1.5 font-medium">Won back</th>
          </tr>
        </thead>
        <tbody>
          {TEAM_STYLE.map((team, i) => (
            <tr key={team.name} className="text-center">
              <td className={`pr-1.5 text-left font-semibold ${team.text}`}>{team.name}</td>
              <td>
                {stats[i].completed}/{stats[i].passes}
              </td>
              <td>{stats[i].shots}</td>
              <td>{stats[i].saved}</td>
              <td>{stats[i].won}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
