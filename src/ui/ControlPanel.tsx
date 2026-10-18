import { useState } from 'react'
import type { Game, GameSnapshot } from '../game/Game'
import { MAX_GRADE, MIN_GRADE } from '../sim/constants'
import { catchChance, reactionDelay, readLag, shotSpreadRadius, sideStepSpeed, tackleSkill, topSpeed, touchAngleError } from '../sim/grades'
import type { GradeKey, Role } from '../sim/match'
import { TEAM_NAMES, type TeamName } from '../sim/teams'
import { TEAM_STYLE } from './teamStyle'

interface Props {
  game: Game
  snapshot: GameSnapshot
  open: boolean
  onOpenChange: (open: boolean) => void
}

type GradeControl<R extends Role> = { key: GradeKey<R>; label: string; detail: (grade: number) => string }
type RoleControls = { [R in Role]: { role: R; name: string; grades: GradeControl<R>[] } }[Role]

const deg = (rad: number) => Math.round((rad * 180) / Math.PI)

const ROLE_CONTROLS: RoleControls[] = [
  {
    role: 'outfielder',
    name: 'Outfielder',
    grades: [
      { key: 'shooting', label: 'Shooting', detail: (g) => `spread radius ${shotSpreadRadius(g).toFixed(2)} m` },
      { key: 'dribbling', label: 'Dribbling', detail: (g) => `touch error ±${deg(touchAngleError(g))}°` },
      { key: 'marking', label: 'Marking', detail: (g) => `reads a cut in ${Math.round(readLag(g, false) * 1000)} ms jockeying` },
      { key: 'tackling', label: 'Tackling', detail: (g) => `${Math.round(tackleSkill(g, 10) * 100)}% vs a 10 dribbler, before reach` },
      { key: 'pace', label: 'Pace', detail: (g) => `top speed ${topSpeed(g).toFixed(1)} m/s` },
      { key: 'agility', label: 'Agility', detail: (g) => `sidestep ${sideStepSpeed(g).toFixed(1)} m/s` },
      { key: 'strength', label: 'Strength', detail: () => 'wins barges, holds off when shielding' },
    ],
  },
  {
    role: 'keeper',
    name: 'Keeper',
    grades: [
      { key: 'reaction', label: 'Reaction', detail: (g) => `delay ${Math.round(reactionDelay(g) * 1000)} ms` },
      { key: 'handling', label: 'Handling', detail: (g) => `holds ${Math.round(catchChance(g) * 100)}% of shots at the body` },
    ],
  },
]

export function ControlPanel({ game, snapshot, open, onOpenChange: setOpen }: Props) {
  const [teamIndex, setTeamIndex] = useState(0)
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
  const team: TeamName = TEAM_NAMES[teamIndex]
  const style = TEAM_STYLE[teamIndex]
  return (
    <aside className="absolute top-4 right-4 max-h-[calc(100%-2rem)] w-72 space-y-4 overflow-y-auto rounded-xl bg-black/60 p-4 text-sm shadow-xl backdrop-blur">
      <button className="-mt-1 ml-auto block text-xs text-neutral-400 hover:text-neutral-200" onClick={() => setOpen(false)}>
        Hide controls
      </button>

      <div role="tablist" className="grid grid-cols-2 gap-1 rounded-lg bg-white/5 p-1">
        {TEAM_STYLE.map((t, i) => (
          <button
            key={t.name}
            role="tab"
            aria-selected={i === teamIndex}
            className={`flex items-center justify-center gap-2 rounded-md px-2 py-1.5 font-semibold ${i === teamIndex ? 'bg-white/15' : 'text-neutral-400 hover:bg-white/10'}`}
            onClick={() => setTeamIndex(i)}
          >
            <span className={`size-2.5 rounded-full ${t.dot}`} />
            {t.name}
          </button>
        ))}
      </div>

      {ROLE_CONTROLS.map((controls) => {
        const grades = snapshot.grades[team][controls.role] as Record<string, number>
        return (
          <section key={controls.role} className="space-y-2">
            <h2 className="flex items-center gap-2 text-xs font-semibold tracking-wide text-neutral-300 uppercase">
              <span className={`size-2.5 rounded-full ${style.dot}`} />
              {style.name} {controls.name}
            </h2>
            {controls.grades.map(({ key, label, detail }) => (
              <GradeSlider
                key={key}
                label={`${style.name} ${controls.name} ${label}`}
                shortLabel={label}
                value={grades[key]}
                detail={detail(grades[key])}
                // RoleControls pairs each role with its own keys; TS cannot follow that through the union.
                onChange={(g) => game.setGrade(team, controls.role, key as never, g)}
              />
            ))}
          </section>
        )
      })}

      <div className="flex gap-2">
        <button
          className="flex-1 rounded-md bg-amber-400 px-3 py-2 font-semibold text-neutral-900 hover:bg-amber-300 disabled:opacity-40"
          disabled={snapshot.phase !== 'play'}
          onClick={() => game.shoot()}
        >
          Shoot <kbd className="ml-1 text-xs opacity-70">Space</kbd>
        </button>
        <button className="rounded-md bg-white/10 px-3 py-2 font-medium hover:bg-white/20" onClick={() => game.reset()}>
          New match <kbd className="ml-1 text-xs opacity-60">R</kbd>
        </button>
      </div>

      <p className="text-xs leading-relaxed text-neutral-400">
        Red attacks to the right, Blue to the left. Whoever has the ball takes the other outfielder on with small touches,
        shields when they get tight, and knocks it past once clear; win it back and you go the other way. Rings mark touches:{' '}
        <span className="text-cyan-300">small</span> keeps it close, <span className="text-orange-300">large</span> knocks it
        ahead. Shots land inside the yellow circle. Space makes whoever has the ball shoot.
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
