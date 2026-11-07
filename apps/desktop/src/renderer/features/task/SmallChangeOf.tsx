import { useState } from 'react'

import { SmallChange } from '@althar/ui'

import { messageOf } from '../../data/client'
import { useServices } from '../../data/services'
import type { NameModel } from '../../shared/modelNames'
import type { SmallChangeContent } from '../../shared/thread'
import s from './FastLaneOf.module.css'

/*
 * A small change's card (README section 6): Merge does what the task's own
 * Merge does, and still asks; Make it a full task starts its review before the
 * merge, and the card folds once there is one. What couldn't be done is said
 * under it, in a line.
 */

export const text = {
  failed: (why: string) => `That didn’t go through. ${why}`,
}

export function SmallChangeOf({
  card,
  named,
  busy,
  onMerge,
  onOpen,
}: {
  card: SmallChangeContent
  named: NameModel
  busy: boolean
  /** Merges its open change, as the task's header does, which asks first. */
  onMerge: (change: { readonly head: string; readonly url: string }) => void
  /** Opens another task, by its thread: the review it became a full task with. */
  onOpen?: (threadId: string) => void
}) {
  const { client } = useServices()
  const [making, setMaking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const change = card.change
  const head = change?.head ?? null
  const name = change === null ? '' : `${change.prefix}${change.number}`
  // Where its review went: the one its merge started, or the one it became a full task with.
  const made = card.fullTask ?? card.review ?? null
  const makeFullTask = () => {
    setError(null)
    setMaking(true)
    client.makeItAFullTask(card.taskId).then(
      () => setMaking(false),
      (failure: unknown) => {
        setMaking(false)
        setError(messageOf(failure))
      },
    )
  }
  return (
    <>
      <SmallChange
        title={card.title}
        model={named(card.lead.agentId, card.lead.model).name}
        skips={card.skips}
        steps={card.steps}
        {...(change === null ? {} : { change: { name, state: change.state } })}
        {...(made === null || onOpen === undefined ? {} : { review: { title: made.title, onOpen: () => onOpen(made.threadId) } })}
        {...(card.fullTask == null ? {} : { fullTask: true })}
        busy={busy || making}
        {...(change === null || head === null ? {} : { onMerge: () => onMerge({ head, url: change.url }) })}
        onMakeFullTask={makeFullTask}
      />
      {error !== null && (
        <p className={s.failure} role="alert">
          {text.failed(error)}
        </p>
      )}
    </>
  )
}
