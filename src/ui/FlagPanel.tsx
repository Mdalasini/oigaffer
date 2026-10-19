import { useState } from 'react'
import type { FlagView, Game } from '../game/Game'
import { secondsAt } from '../sim/replay'
import { clock } from '../sim/trace'

interface Props {
  game: Game
  flag: FlagView | null
}

const time = (tick: number) => clock(secondsAt(tick))

/**
 * Flagging a moment: the match pauses, and the last two minutes can be
 * scrubbed and played back to pick out the stretch that looks wrong. The
 * flag copied is a line of text that replays that stretch exactly, for
 * `bun run inspect`.
 */
export function FlagPanel({ game, flag }: Props) {
  const [note, setNote] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  if (!flag) {
    return (
      <button
        className="absolute right-4 bottom-4 rounded-md bg-black/55 px-3 py-2 text-sm font-medium backdrop-blur hover:bg-black/70"
        onClick={() => game.startFlag()}
        title="Pause and pick out a stretch of the last two minutes (F)"
      >
        ⚑ Flag a moment
      </button>
    )
  }

  const span = Math.max(1, flag.latest - flag.earliest)
  const pct = (tick: number) => `${(100 * (tick - flag.earliest)) / span}%`
  const copy = async () => {
    const text = game.flagText(note)
    try {
      await navigator.clipboard.writeText(text)
      setCopied('Copied: paste it to Claude')
    } catch {
      // Without clipboard access, show it to copy by hand.
      setCopied(text)
    }
  }
  const close = () => {
    setNote('')
    setCopied(null)
    game.endFlag()
  }

  return (
    <div className="absolute bottom-4 left-1/2 w-[min(560px,calc(100%-2rem))] -translate-x-1/2 rounded-lg bg-black/75 p-3 text-sm backdrop-blur">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">⚑ Flag a moment</span>
        <span className="text-xs text-neutral-400 tabular-nums">
          showing {time(flag.at)} · flagged {time(flag.from)}–{time(flag.to)} ({secondsAt(flag.to - flag.from).toFixed(1)} s)
        </span>
      </div>

      <div className="relative mt-3 h-6">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded bg-white/15" />
        <div className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded bg-amber-300/70" style={{ left: pct(flag.from), width: `calc(${pct(flag.to)} - ${pct(flag.from)})` }} />
        <input
          type="range"
          aria-label="Moment shown"
          className="absolute inset-0 w-full cursor-pointer appearance-none bg-transparent accent-white"
          min={flag.earliest}
          max={flag.latest}
          value={flag.at}
          onChange={(e) => game.seek(Number(e.target.value))}
        />
      </div>
      <div className="flex justify-between text-[11px] text-neutral-500 tabular-nums">
        <span>{time(flag.earliest)}</span>
        <span>{time(flag.latest)}</span>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <button className="rounded-md bg-white/10 px-2.5 py-1.5 hover:bg-white/20" onClick={() => game.seek(flag.from)} title="Back to the start of the flagged stretch">
          ⏮
        </button>
        <button className="w-16 rounded-md bg-white/10 px-2.5 py-1.5 hover:bg-white/20" onClick={() => game.toggleFlagPlay()} title="Space">
          {flag.playing ? 'Pause' : 'Play'}
        </button>
        <button className="rounded-md bg-white/10 px-2.5 py-1.5 hover:bg-white/20" onClick={() => game.markFlag('from')}>
          Start here
        </button>
        <button className="rounded-md bg-white/10 px-2.5 py-1.5 hover:bg-white/20" onClick={() => game.markFlag('to')}>
          End here
        </button>
      </div>

      <textarea
        className="mt-2 w-full resize-none rounded-md bg-white/10 px-2.5 py-1.5 text-sm placeholder:text-neutral-500"
        rows={2}
        placeholder="What looks wrong? Players are labelled, e.g. “B2 stops tracking R3’s run”"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {copied && <div className="mt-1 max-h-20 overflow-auto text-xs break-all text-emerald-300 select-text">{copied}</div>}

      <div className="mt-2 flex justify-end gap-1.5">
        <button className="rounded-md bg-white/10 px-3 py-1.5 hover:bg-white/20" onClick={close} title="Esc">
          Back to the match
        </button>
        <button className="rounded-md bg-amber-300 px-3 py-1.5 font-semibold text-black hover:bg-amber-200" onClick={copy}>
          Copy flag
        </button>
      </div>
    </div>
  )
}
