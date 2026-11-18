/*
 * What the coordinator is asked when the person wants a draft with no plan
 * planned, from its card in the thread or its card on the board: it plans
 * it, or says why it can't.
 */
export const planIt = (task: { readonly title: string; readonly slug: string }) =>
  `Plan “${task.title}” (${task.slug}): it is a draft with no plan. Call propose_plan for it, or tell me why you can't.`
