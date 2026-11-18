/*
 * What the coordinator is asked when the person wants a draft with no plan
 * planned, from its card in the thread or its card on the board: it plans
 * it, or says why it can't.
 */
export const planIt = (task: { readonly title: string; readonly slug: string }) =>
  `Plan “${task.title}” (${task.slug}): it is a draft with no plan. Call propose_plan for it, or tell me why you can't.`

/**
 * Whether a draft's plan, asked for at `askedAt` (ms), is still on its way: until the coordinator's turn that took the
 * ask is over, begun after it and ended since. Then its card offers Plan it again, where no plan came.
 */
export const planStillAsked = (askedAt: number, turnStarted: string | null, turnEnded: string | null): boolean => {
  const started = turnStarted === null ? Number.NaN : Date.parse(turnStarted)
  const ended = turnEnded === null ? Number.NaN : Date.parse(turnEnded)
  return !(started >= askedAt && ended >= started)
}
