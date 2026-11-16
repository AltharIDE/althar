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
 * unasked. While the offer stands, as the task's card has it, the line has its buttons; once answered, what came of it, from
 * the press: who reviews it, or nobody, held until the card says so, and back with its buttons, saying why, where it didn't
 * go through.
 */
export function ReviewOfferOf({ offer, ask }: { offer: Extract<Offer, { kind: 'review' }>; ask?: string }) {
  const { client, cache } = useServices()
  const named = useModelNames()
  // What the person answered, by the offer as it stood then: shown until the card no longer has that offer, or it failed.
  const [answered, setAnswered] = useState<{ readonly offer: unknown; readonly who: string | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const board = useQuery(reads(client).board(offer.projectId))
  const work = board.data?.tasks.find((one) => one.taskId === offer.taskId)
  if (work === undefined || work.plan === null) return null
  const standing = work.reviewOffer
  if (answered !== null && standing !== undefined && answered.offer !== standing) setAnswered(null)
  if (standing !== undefined && answered?.offer === standing)
    return <ReviewOffer who="" {...(ask === undefined ? {} : { ask })} answered={answered.who} />
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
  const act = (who: string | null, go: () => Promise<void>) => {
    setError(null)
    setAnswered({ offer: standing, who })
    go().then(
      () => void cache.invalidateQueries({ queryKey: ['board'] }),
      (failure: unknown) => {
        setAnswered(null)
        setError(messageOf(failure))
      },
    )
  }
  const steps = [standing]
  return (
    <ReviewOffer
      who={named(standing.agentId, standing.model).name}
      {...(ask === undefined ? {} : { ask })}
      error={error}
      onAdd={() => act(named(standing.agentId, standing.model).name, () => client.changeTeam(work.taskId, steps))}
      onDecline={() => act(null, () => client.declineReview(work.taskId))}
    />
  )
}
