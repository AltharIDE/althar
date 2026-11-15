import type { ComponentProps } from 'react'

import { Card as AppCard } from '../../../src/renderer/features/project/Card'
import { RequestCard } from '../directions/InThread'
import { direction, scenario, useStore } from '../state'

export * from '../../../src/renderer/features/project/Card'

/*
 * The coordinator's thread draws each task's card through here. In A, the
 * request's tasks are one card, the request's graph, where the first of
 * them was; the rest draw nothing. Everywhere else, each is its own card,
 * as today.
 */
export function Card(props: ComponentProps<typeof AppCard>) {
  const picked = useStore(direction)
  const tasks = scenario().tasks
  const mine = tasks.findIndex((one) => props.card.slug === `${scenario().key}-${one.key}`)
  if (picked !== 'a' || mine < 0) return <AppCard {...props} />
  return mine === 0 ? <RequestCard /> : null
}
