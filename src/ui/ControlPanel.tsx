import type { Game, GameSnapshot } from '../game/Game'
import { MAX_GRADE, MIN_GRADE } from '../sim/constants'

interface Props {
  game: Game
  snapshot: GameSnapshot
}

export function ControlPanel({ game, snapshot }: Props) {
  const conversion = snapshot.stats.shots ? Math.round((snapshot.stats.goals / snapshot.stats.shots) * 100) : 0
  return (
    <aside className="absolute top-4 right-4 w-72 space-y-4 rounded-xl bg-black/60 p-4 text-sm shadow-xl backdrop-blur">
      <GradeSlider
        label="Striker · Shooting"
        swatch="bg-red-500"
        value={snapshot.shooting}
        detail={`Spread radius ${snapshot.spreadRadius.toFixed(2)} m`}
        onChange={(g) => game.setShooting(g)}
      />
      <GradeSlider
        label="Keeper · Reaction"
        swatch="bg-lime-400"
        value={snapshot.reaction}
        detail={`Reaction delay ${Math.round(snapshot.reactionDelay * 1000)} ms`}
        onChange={(g) => game.setReaction(g)}
      />

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
        The striker shoots at the yellow circle; the ball lands anywhere inside it. Conversion so far:{' '}
        <span className="font-semibold text-neutral-200">{conversion}%</span>
      </p>
    </aside>
  )
}

interface GradeSliderProps {
  label: string
  swatch: string
  value: number
  detail: string
  onChange: (grade: number) => void
}

function GradeSlider({ label, swatch, value, detail, onChange }: GradeSliderProps) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between">
        <span className="flex items-center gap-2 font-medium">
          <span className={`size-2.5 rounded-full ${swatch}`} />
          {label}
        </span>
        <span className="text-lg font-bold tabular-nums">{value}</span>
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
      <div className="text-xs text-neutral-400">{detail}</div>
    </label>
  )
}
