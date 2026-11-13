import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { ReviewOffer } from '@althar/ui'

import { messageOf } from '../../data/client'
import { reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { useModelNames } from '../../shared/modelNames'
import type { Offer } from '../../shared/thread'

/*
 * A review a lead or the coordinator offered a task as its work turned real with none (`offer_review`; a skipped review can be
 * added back until merge): a line of the thread it was offered in, by its reviewer. Add puts that reviewer on, through the same
 * ChangeTeam its dialog uses, and where the work is up its review starts; No thanks turns it down for good. Nothing is added
 * unasked. While the offer stands, as the task's card has it, the line has its buttons; once answered, what came of it.
 */
export function ReviewOfferOf({ offer, ask }: { offer: Extract<Offer, { kind: 'review' }>; ask?: string }) {
  const { client, cache } = useServices()
  const named = useModelNames()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const board = useQuery(reads(client).board(offer.projectId))
  const work = board.data?.tasks.find((one) => one.taskId === offer.taskId)
  if (work === undefined || work.plan === null) return null
  const standing = work.reviewOffer
  if (standing === undefined) {
    // Answered, or no longer the task's to take: who reviews it now, where someone does.
    const review = work.plan.steps.find((step) => step.key === 'review' && !step.skipped)
    return (
      <ReviewOffer
        who=""
        {...(ask === undefined ? {} : { ask })}
        answered={review === undefined ? null : named(review.agentId, review.model).name}
      />
    )
  }
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
  const steps = [standing]
  return (
    <ReviewOffer
      who={named(standing.agentId, standing.model).name}
      {...(ask === undefined ? {} : { ask })}
      busy={busy}
      error={error}
      onAdd={() => void act(() => client.changeTeam(work.taskId, steps))}
      onDecline={() => void act(() => client.declineReview(work.taskId))}
    />
  )
}
