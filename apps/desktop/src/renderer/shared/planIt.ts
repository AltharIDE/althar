import { useEffect, useState } from 'react'

import type { ThreadItem } from '@althar/contracts'

/*
 * What the coordinator is asked when the person wants a draft with no plan
 * planned, from its card in the thread or its card on the board: it plans
 * it, or says why it can't.
 */
export const planIt = (task: { readonly title: string; readonly slug: string }) =>
  `Plan “${task.title}” (${task.slug}): it is a draft with no plan. Call propose_plan for it, or tell me why you can't.`

/**
 * Whether a draft's plan, asked for at `askedAt` (ms), is still on its way: its message, `said` as the thread has it, not
 * there yet or waiting its turn, or taken by a turn not over. The session keeps when its last turn ended, not when it began,
 * so the ask is over once it was taken, no turn runs and one ended since it was asked. A message taken back is no ask. Then
 * its card offers Plan it again, where no plan came.
 */
export const planStillAsked = (
  askedAt: number,
  said: { readonly state: 'queued' | 'delivered' | 'superseded' | 'withdrawn' } | null | undefined,
  session: { readonly turnRunning: boolean; readonly turnEndedAt: string | null } | null,
): boolean => {
  if (said === undefined || said?.state === 'queued') return true
  if (said?.state === 'withdrawn' || said?.state === 'superseded') return false
  if (session === null || session.turnRunning) return true
  const ended = session.turnEndedAt === null ? Number.NaN : Date.parse(session.turnEndedAt)
  return !(ended >= askedAt)
}

/**
 * A draft's plan as the person asked for it: when, of which task, the message so worded already in the thread then (an
 * earlier ask's, not this one), and whether this one's message was in the thread since. Kept from the press until the ask
 * is over, then let go, so neither a later turn nor the thread cleared from view says anything of it.
 */
export type PlanAsk = {
  readonly at: number
  readonly title: string
  readonly slug: string
  readonly before: string | null
  readonly seen: boolean
}

/** The person's message asking for a draft's plan, the newest so worded, as the thread has it; not the one there `before`. */
export const planAskIn = (
  items: ReadonlyArray<ThreadItem>,
  task: { readonly title: string; readonly slug: string; readonly before?: string | null },
) => {
  const words = planIt(task)
  for (let at = items.length - 1; at >= 0; at--) {
    const item = items[at]
    if (item?.kind === 'user_message' && item.content.text === words)
      return item.id === task.before ? undefined : { id: item.id, input: item.input }
  }
  return undefined
}

/**
 * Where an ask stands now: still on its way or over, and whether its message was ever in the thread. Seen, then gone from
 * the thread as it shows (cleared from view), the coordinator's turns alone say whether it is over.
 */
export const planAskNow = (
  ask: PlanAsk,
  items: ReadonlyArray<ThreadItem>,
  session: { readonly turnRunning: boolean; readonly turnEndedAt: string | null } | null,
): { readonly still: boolean; readonly seen: boolean } => {
  const said = planAskIn(items, ask)
  const seen = ask.seen || said !== undefined
  return { still: planStillAsked(ask.at, said === undefined && seen ? null : said?.input, session), seen }
}

type Session = { readonly turnRunning: boolean; readonly turnEndedAt: string | null } | null

/**
 * The drafts whose plan the person asked for, by task, each from the press until its ask is over: Plan it comes back where
 * the ask wasn't sent, or once the coordinator's turn that took it is over and no plan came. Let go then, so a later turn
 * hides nothing again; and its message once seen, a thread cleared from view leaves it to the turns.
 */
export const usePlansAsked = (items: ReadonlyArray<ThreadItem>, session: Session) => {
  const [asks, setAsks] = useState<ReadonlyMap<string, PlanAsk>>(() => new Map())
  useEffect(() => {
    if (asks.size === 0) return
    let next: Map<string, PlanAsk> | null = null
    for (const [taskId, ask] of asks) {
      const now = planAskNow(ask, items, session)
      if (now.still && now.seen === ask.seen) continue
      next ??= new Map(asks)
      if (now.still) next.set(taskId, { ...ask, seen: true })
      else next.delete(taskId)
    }
    if (next !== null) setAsks(next)
  }, [asks, items, session])
  return {
    ask: (task: { readonly taskId: string; readonly title: string; readonly slug: string }) => {
      const before = planAskIn(items, task)?.id ?? null
      setAsks((now) => new Map(now).set(task.taskId, { at: Date.now(), title: task.title, slug: task.slug, before, seen: false }))
    },
    unask: (taskId: string) =>
      setAsks((now) => {
        if (!now.has(taskId)) return now
        const next = new Map(now)
        next.delete(taskId)
        return next
      }),
    asked: (taskId: string) => {
      const ask = asks.get(taskId)
      return ask !== undefined && planAskNow(ask, items, session).still
    },
  }
}
