import { useState } from 'react'

import type { BoardTask } from '@althar/contracts'
import { ReviewOffer } from '@althar/ui'

import { messageOf } from '../../data/client'
import { useServices } from '../../data/services'
import { useModelNames } from '../../shared/modelNames'

/*
 * The review a change is offered once, as its work turned real (a skipped review can be added back until merge): on its card,
 * with the reviewer the project's rules would pick. Add puts that reviewer on, through the same ChangeTeam its dialog uses, and
 * where the work is up its review starts; No thanks turns it down for good. Nothing is added unasked.
 */
export function ReviewOfferOf({ work }: { work: Pick<BoardTask, 'taskId' | 'plan' | 'reviewOffer'> }) {
  const { client, cache } = useServices()
  const named = useModelNames()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const offer = work.reviewOffer
  if (offer === undefined || work.plan === null) return null
  const act = async (go: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await go()
      void cache.invalidateQueries({ queryKey: ['board'] })
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }
  const steps = [...work.plan.steps.filter((step) => step.key !== 'review'), offer]
  return (
    <ReviewOffer
      who={named(offer.agentId, offer.model).name}
      busy={busy}
      error={error}
      onAdd={() => void act(() => client.changeTeam(work.taskId, steps))}
      onDecline={() => void act(() => client.declineReview(work.taskId))}
    />
  )
}
