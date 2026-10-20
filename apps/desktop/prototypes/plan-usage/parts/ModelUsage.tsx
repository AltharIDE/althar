// Scrappy: B · usage beside the models. Each model in a picker says how much its route has left (the account Althar would start it on, its tightest window, a model's own window included), or that there is no reading; a model chip whose route is under a tenth says so beside it.
import type { PlanUsage } from '@althar/contracts'
import { type ModelInfo, usageTone } from '@althar/ui'

import { choiceOf } from '../../../src/renderer/shared/models'
import { routeOf, whenShort } from '../usage'
import { Bar } from './Meter'
import s from './parts.module.css'

/** Under this share left, the chip of a model on that route says so. */
export const WARN_UNDER = 10

const routeFor = (usage: PlanUsage | null, info: ModelInfo) => {
  const { agentId, model } = choiceOf(info.id)
  const known = (usage?.accounts ?? []).some((account) => account.agentId === agentId)
  return { known, route: routeOf(usage, agentId, model) }
}

/** What a picker's row says beside a model. */
export function ModelNote({ usage, info }: { readonly usage: PlanUsage | null; readonly info: ModelInfo }) {
  const { known, route } = routeFor(usage, info)
  if (!known) return null
  if (route === null)
    return (
      <span className={s.note} data-usage>
        no reading
      </span>
    )
  const { room, account, several } = route
  const until = room.resetsAt === null || room.left > 50 ? '' : ` · until ${whenShort(room.resetsAt)}`
  return (
    <span className={s.note} data-usage data-tone={usageTone(room.left)}>
      {several ? `${account.accountName} · ` : ''}
      {room.left === 0 ? 'out' : `${room.left}% left`}
      {until}
    </span>
  )
}

/** Beside a model chip whose route is nearly out: how much, and until when. */
export function ChipWarning({ usage, info }: { readonly usage: PlanUsage | null; readonly info: ModelInfo }) {
  const { route } = routeFor(usage, info)
  if (route === null || route.room.left >= WARN_UNDER) return null
  const { room } = route
  return (
    <span className={s.warn} data-tone={usageTone(room.left)} role="note">
      <Bar left={room.left} />
      {room.left === 0 ? 'Out' : `${room.left}% left`}
      {room.resetsAt === null ? '' : ` · until ${whenShort(room.resetsAt)}`}
    </span>
  )
}
