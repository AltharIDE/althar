// Scrappy: plan usage where a model is chosen. Each model says what its route has left: the account Althar would start it on, its tightest window, a model's own window (Opus's week) counted for it alone. A: the figure on every row. B: the bar's steps and the figure, on every row and beside the chip. C: only where it matters, from half down. In A and C the chip says it beside itself once under a tenth.
import type { PlanUsage } from '@althar/contracts'
import { type ModelInfo, usageTone } from '@althar/ui'

import { choiceOf } from '../../../src/renderer/shared/models'
import type { Direction } from '../store'
import { routeOf, SAY_UNDER, whenShort } from '../usage'
import { Gauge } from './Plan'
import s from './plan.module.css'

const routeFor = (usage: PlanUsage | null, info: Pick<ModelInfo, 'id'>) => {
  const { agentId, model } = choiceOf(info.id)
  const known = (usage?.accounts ?? []).some((account) => account.agentId === agentId)
  return { known, route: routeOf(usage, agentId, model) }
}

/** What a model's route has left, in words for a row: "62%", "Side · 94%", "3% · until 14:00", "out · until Mon 09:00". */
export const routeWords = (usage: PlanUsage | null, info: Pick<ModelInfo, 'id'>, d: Direction): string | null => {
  const { known, route } = routeFor(usage, info)
  if (!known) return null
  if (route === null) return d === 'C' ? null : 'no reading'
  const { room, account, several } = route
  if (d === 'C' && room.left > 50) return null
  const figure = room.left === 0 ? 'out' : d === 'C' ? `${room.left}% left` : `${room.left}%`
  const until = room.resetsAt !== null && room.left <= 25 ? ` · until ${whenShort(room.resetsAt)}` : ''
  return `${several ? `${account.accountName} · ` : ''}${figure}${until}`
}

/** A picker's row, beside a model. */
export function ModelNote({ usage, info, d }: { readonly usage: PlanUsage | null; readonly info: ModelInfo; readonly d: Direction }) {
  const words = routeWords(usage, info, d)
  if (words === null) return null
  const { route } = routeFor(usage, info)
  if (route === null)
    return (
      <span className={`${s.note} ${s.quiet}`} data-usage>
        {words}
      </span>
    )
  return (
    <span className={s.note} data-usage data-tone={usageTone(route.room.left)}>
      {d === 'B' && <Gauge left={route.room.left} small />}
      {words}
    </span>
  )
}

/** Beside a composer's chip: in B, the steps always; in A and C, the figure and until when once under a tenth. */
export function ChipSays({ usage, info, d }: { readonly usage: PlanUsage | null; readonly info: ModelInfo; readonly d: Direction }) {
  const { route } = routeFor(usage, info)
  if (route === null) return null
  const { room } = route
  if (d === 'B')
    return (
      <span className={s.chipSays} title={`${room.left}% left`}>
        <Gauge left={room.left} small />
        {room.left <= SAY_UNDER && `${room.left}%`}
      </span>
    )
  if (room.left > SAY_UNDER) return null
  return (
    <span className={s.chipSays} role="note">
      {room.left === 0 ? 'out' : `${room.left}% left`}
      {room.resetsAt !== null && <span>until {whenShort(room.resetsAt)}</span>}
    </span>
  )
}
