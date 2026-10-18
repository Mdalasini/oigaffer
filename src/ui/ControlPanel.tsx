import { useState } from 'react'
import type { Game, GameSnapshot } from '../game/Game'
import type { Overlay } from '../render/overlay'
import { MAX_GRADE, MIN_GRADE } from '../sim/constants'
import {
  blindSideDelay,
  catchChance,
  cleanTakeSpeed,
  gradeT,
  judgementError,
  passAngleError,
  passWeightError,
  reactionDelay,
  readLag,
  shotSpreadRadius,
  sideStepSpeed,
  spotChance,
  tackleSkill,
  topSpeed,
  touchAngleError,
  trapChance,
} from '../sim/grades'
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
    name: 'Outfielders',
    grades: [
      { key: 'shooting', label: 'Shooting', detail: (g) => `spread radius ${shotSpreadRadius(g).toFixed(2)} m` },
      { key: 'dribbling', label: 'Dribbling', detail: (g) => `touch error ±${deg(touchAngleError(g))}°` },
      { key: 'marking', label: 'Marking', detail: (g) => `reads a cut in ${Math.round(readLag(g, false) * 1000)} ms jockeying` },
      { key: 'tackling', label: 'Tackling', detail: (g) => `${Math.round(tackleSkill(g, 10) * 100)}% vs a 10 dribbler, before reach` },
      { key: 'passing', label: 'Passing', detail: (g) => `aim error ±${deg(passAngleError(g))}°, weight ±${Math.round(passWeightError(g) * 100)}%` },
      { key: 'firstTouch', label: 'First touch', detail: (g) => `takes a ${cleanTakeSpeed(g).toFixed(0)} m/s ball dead` },
      { key: 'vision', label: 'Vision', detail: (g) => `spots ${Math.round(spotChance(g) * 100)}% of teammates over the shoulder` },
      { key: 'decisions', label: 'Decisions', detail: (g) => `misjudges options by ±${Math.round(judgementError(g) * 100)}%` },
      { key: 'offTheBall', label: 'Off the ball', detail: (g) => `goes for ${Math.round((0.15 + 0.45 * gradeT(g)) * 100)}% of chances to run in behind` },
      { key: 'positioning', label: 'Positioning', detail: (g) => `picks up a blind-side run in ${Math.round(blindSideDelay(g) * 1000)} ms; springs the trap ${Math.round(trapChance(g) * 100)}% of the time` },
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

const OVERLAYS: { value: Overlay; label: string; detail: string }[] = [
  { value: 'off', label: 'Off', detail: 'How players read the pitch, drawn over it.' },
  { value: 'threat', label: 'Threat', detail: 'How dangerous it is to have the ball in each spot, for the team on it.' },
  { value: 'control', label: 'Control', detail: 'Which team would get to a ball in each spot first, and how surely.' },
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

      <section className="space-y-2">
        <h2 className="text-xs font-semibold tracking-wide text-neutral-300 uppercase">Show space</h2>
        <div role="radiogroup" aria-label="Show space" className="grid grid-cols-3 gap-1 rounded-lg bg-white/5 p-1">
          {OVERLAYS.map(({ value, label }) => (
            <button
              key={value}
              role="radio"
              aria-checked={snapshot.overlay === value}
              className={`rounded-md px-2 py-1 text-xs font-semibold ${snapshot.overlay === value ? 'bg-white/15' : 'text-neutral-400 hover:bg-white/10'}`}
              onClick={() => game.setOverlay(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-neutral-400">{OVERLAYS.find((o) => o.value === snapshot.overlay)?.detail}</p>
      </section>

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
        Red attacks to the right, Blue to the left, four outfielders and a keeper a side; outfield grades apply to all of a
        team's outfielders. Whoever has the ball takes the nearest defender on, shields when they get tight, and knocks it
        past once clear. Their teammate holds the line, shows for it when the carrier is closed down, and runs in behind when
        the carrier has time to play forward; a yellow ring means they're calling for it, with a line to the space they
        want it in. When a pass is the better bet it's played: a white ring marks where it's aimed, dashed for a through
        ball. The other defender covers, and steps in once the first is
        beaten. Rings mark touches: <span className="text-cyan-300">small</span> keeps it close,{' '}
        <span className="text-orange-300">large</span> knocks it ahead. Shots land inside the yellow circle. Space makes
        whoever has the ball shoot.
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
