import type { ComponentProps } from 'react'

import { Card as AppCard } from '../../../src/renderer/features/project/Card'
import { PlanInThread } from '../chat'

export * from '../../../src/renderer/features/project/Card'

/*
 * The coordinator's thread draws each card through here: the plan's, which
 * the lab writes as a card whose slug is `plan@kind@version`, as the chat
 * option on show draws it; any other as the app does.
 */
export function Card(props: ComponentProps<typeof AppCard>) {
  const [mark, kind, version] = props.card.slug.split('@')
  if (mark === 'plan' && kind !== undefined) return <PlanInThread kind={kind} version={Number(version)} />
  return <AppCard {...props} />
}
