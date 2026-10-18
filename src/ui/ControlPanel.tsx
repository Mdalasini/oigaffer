import { useState } from 'react'
import type { Game, GameSnapshot } from '../game/Game'
import { MAX_GRADE, MIN_GRADE } from '../sim/constants'
import { reactionDelay, readLag, shotSpreadRadius, sideStepSpeed, topSpeed, touchAngleError } from '../sim/grades'
import type { GradeKey, Role } from '../sim/match'

interface Props {
  game: Game
  snapshot: GameSnapshot
}

type GradeControl<R extends Role> = { key: GradeKey<R>; label: string; detail: (grade: number) => string }
type PlayerControls = { [R in Role]: { role: R; name: string; swatch: string; grades: GradeControl<R>[] } }[Role]

const pace: GradeControl<'striker' | 'defender'> = { key: 'pace', label: 'Pace', detail: (g) => `top speed ${topSpeed(g).toFixed(1)} m/s` }
const agility: GradeControl<'striker' | 'defender'> = {
  key: 'agility',
  label: 'Agility',
  detail: (g) => `sidestep ${sideStepSpeed(g).toFixed(1)} m/s`,
}

const PLAYERS: PlayerControls[] = [
  {
    role: 'striker',
    name: 'Striker',
    swatch: 'bg-red-500',
    grades: [
      { key: 'shooting', label: 'Shooting', detail: (g) => `spread radius ${shotSpreadRadius(g).toFixed(2)} m` },
      { key: 'dribbling', label: 'Dribbling', detail: (g) => `touch error ±${deg(touchAngleError(g))}°` },
      pace,
      agility,
    ],
  },
  {
    role: 'defender',
    name: 'Defender',
    swatch: 'bg-blue-500',
    grades: [
      { key: 'marking', label: 'Marking', detail: (g) => `reads a cut in ${Math.round(readLag(g, false) * 1000)} ms jockeying` },
      pace,
      agility,
    ],
  },
  {
    role: 'keeper',
    name: 'Keeper',
    swatch: 'bg-lime-400',
    grades: [{ key: 'reaction', label: 'Reaction', detail: (g) => `delay ${Math.round(reactionDelay(g) * 1000)} ms` }],
  },
]

const deg = (rad: number) => Math.round((rad * 180) / Math.PI)

export function ControlPanel({ game, snapshot }: Props) {
  // Start folded away on narrow screens, where the panel would cover the play.
  const [open, setOpen] = useState(() => window.innerWidth >= 1000)
  const conversion = snapshot.stats.shots ? Math.round((snapshot.stats.goals / snapshot.stats.shots) * 100) : 0
  if (!open) {
    return (
      <button
        className="absolute top-4 right-4 rounded-lg bg-black/60 px-3 py-2 text-sm font-medium shadow-xl backdrop-blur hover:bg-black/75"
        onClick={() => setOpen(true)}
      >
        Show controls
      </button>
    )
  }
  return (
    <aside className="absolute top-4 right-4 max-h-[calc(100%-2rem)] w-72 space-y-4 overflow-y-auto rounded-xl bg-black/60 p-4 text-sm shadow-xl backdrop-blur">
      <button className="-mt-1 ml-auto block text-xs text-neutral-400 hover:text-neutral-200" onClick={() => setOpen(false)}>
        Hide controls
      </button>
      {PLAYERS.map((player) => {
        const grades = snapshot.grades[player.role] as Record<string, number>
        const off = player.role === 'defender' && !snapshot.defenderActive
        return (
          <section key={player.role} className="space-y-2">
            <h2 className="flex items-center gap-2 text-xs font-semibold tracking-wide text-neutral-300 uppercase">
              <span className={`size-2.5 rounded-full ${player.swatch}`} />
              {player.name}
              {player.role === 'defender' && (
                <label className="ml-auto flex items-center gap-1.5 font-normal tracking-normal normal-case">
                  <input
                    type="checkbox"
                    className="accent-amber-400"
                    checked={snapshot.defenderActive}
                    onChange={(e) => game.setDefenderActive(e.target.checked)}
                  />
                  In play
                </label>
              )}
            </h2>
            <div className={off ? 'pointer-events-none opacity-40' : ''}>
              {player.grades.map(({ key, label, detail }) => (
                <GradeSlider
                  key={key}
                  label={`${player.name} ${label}`}
                  shortLabel={label}
                  value={grades[key]}
                  detail={detail(grades[key])}
                  // PlayerControls pairs each role with its own keys; TS cannot follow that through the union.
                  onChange={(g) => game.setGrade(player.role, key as never, g)}
                />
              ))}
            </div>
          </section>
        )
      })}

      <div className="flex gap-2">
        <button
          className="flex-1 rounded-md bg-amber-400 px-3 py-2 font-semibold text-neutral-900 hover:bg-amber-300 disabled:opacity-40"
          disabled={snapshot.phase !== 'approach'}
          onClick={() => game.shoot()}
        >
          Shoot <kbd className="ml-1 text-xs opacity-70">Space</kbd>
        </button>
        <button className="rounded-md bg-white/10 px-3 py-2 font-medium hover:bg-white/20" onClick={() => game.reset()}>
          Reset <kbd className="ml-1 text-xs opacity-60">R</kbd>
        </button>
      </div>

      <label className="flex items-center gap-2 text-neutral-300">
        <input
          type="checkbox"
          className="accent-amber-400"
          checked={snapshot.autoReset}
          onChange={(e) => game.setAutoReset(e.target.checked)}
        />
        Replay automatically
      </label>

      <p className="text-xs leading-relaxed text-neutral-400">
        The striker takes on the defender with small touches and knocks it past once clear. Rings mark touches: <span className="text-cyan-300">small</span> keeps it close,{' '}
        <span className="text-orange-300">large</span> knocks it ahead. Shots land inside the yellow circle. Conversion:{' '}
        <span className="font-semibold text-neutral-200">{conversion}%</span>
      </p>
    </aside>
  )
}

interface GradeSliderProps {
  label: string
  shortLabel: string
  value: number
  detail: string
  onChange: (grade: number) => void
}

function GradeSlider({ label, shortLabel, value, detail, onChange }: GradeSliderProps) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between">
        <span className="font-medium">{shortLabel}</span>
        <span className="font-bold tabular-nums">{value}</span>
      </div>
      <input
        type="range"
        min={MIN_GRADE}
        max={MAX_GRADE}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-amber-400"
      />
      <div className="-mt-1 text-[11px] text-neutral-400">{detail}</div>
    </label>
  )
}
