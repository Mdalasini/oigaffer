import type { Game, GameSnapshot } from '../game/Game'
import { MAX_GRADE, MIN_GRADE } from '../sim/constants'
import { reactionDelay, shotSpreadRadius, sideStepSpeed, topSpeed, touchAngleError } from '../sim/grades'
import type { GradeKey } from '../sim/match'

interface Props {
  game: Game
  snapshot: GameSnapshot
}

interface PlayerControls {
  name: string
  swatch: string
  grades: { key: GradeKey; label: string; detail: (grade: number) => string }[]
}

const PLAYERS: PlayerControls[] = [
  {
    name: 'Striker',
    swatch: 'bg-red-500',
    grades: [
      { key: 'shooting', label: 'Shooting', detail: (g) => `spread radius ${shotSpreadRadius(g).toFixed(2)} m` },
      { key: 'dribbling', label: 'Dribbling', detail: (g) => `touch error ±${deg(touchAngleError(g))}°` },
      { key: 'pace', label: 'Pace', detail: (g) => `top speed ${topSpeed(g).toFixed(1)} m/s` },
      { key: 'agility', label: 'Agility', detail: (g) => `sidestep ${sideStepSpeed(g).toFixed(1)} m/s` },
    ],
  },
  {
    name: 'Keeper',
    swatch: 'bg-lime-400',
    grades: [{ key: 'reaction', label: 'Reaction', detail: (g) => `delay ${Math.round(reactionDelay(g) * 1000)} ms` }],
  },
]

const deg = (rad: number) => Math.round((rad * 180) / Math.PI)

export function ControlPanel({ game, snapshot }: Props) {
  const conversion = snapshot.stats.shots ? Math.round((snapshot.stats.goals / snapshot.stats.shots) * 100) : 0
  return (
    <aside className="absolute top-4 right-4 max-h-[calc(100%-2rem)] w-72 space-y-4 overflow-y-auto rounded-xl bg-black/60 p-4 text-sm shadow-xl backdrop-blur">
      {PLAYERS.map((player) => (
        <section key={player.name} className="space-y-2">
          <h2 className="flex items-center gap-2 text-xs font-semibold tracking-wide text-neutral-300 uppercase">
            <span className={`size-2.5 rounded-full ${player.swatch}`} />
            {player.name}
          </h2>
          {player.grades.map(({ key, label, detail }) => (
            <GradeSlider
              key={key}
              label={`${player.name} ${label}`}
              shortLabel={label}
              value={snapshot.grades[key]}
              detail={detail(snapshot.grades[key])}
              onChange={(g) => game.setGrade(key, g)}
            />
          ))}
        </section>
      ))}

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
        Rings on the ball mark touches: <span className="text-cyan-300">small</span> keeps it close,{' '}
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
