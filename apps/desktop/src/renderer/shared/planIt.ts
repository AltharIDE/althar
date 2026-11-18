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

/** The person's message asking for a draft's plan, the newest so worded, as the thread has it: its state with the lead. */
export const planAskIn = (items: ReadonlyArray<ThreadItem>, task: { readonly title: string; readonly slug: string }) => {
  const words = planIt(task)
  for (let at = items.length - 1; at >= 0; at--) {
    const item = items[at]
    if (item?.kind === 'user_message' && item.content.text === words) return item.input
  }
  return undefined
}
