import { useEffect, useEffectEvent, useRef, useState } from 'react'

import type { Draft, ThreadItem } from '@althar/contracts'
import { type LaunchPhase, type LaunchStep, TaskLaunch } from '@althar/ui'

import { useEffortNames, useModelNames } from '../../shared/modelNames'
import { stepText } from '../../shared/steps'

/*
 * A task's card while the coordinator drafts it (`useDrafts`): the plan
 * card's own, filling in as the draft is written, from the moment it begins,
 * rather than the whole card after a long wait. Hold is its one action: a
 * draft held here is held as its plan comes. The thread's card takes its
 * place once the plan is in.
 */

/** What drafting is at, from what is written so far. */
export const phaseOf = (draft: Draft): LaunchPhase => {
  if (!draft.brief) return 'writing'
  if (!draft.planning && !draft.planned) return 'sizing'
  if (draft.lead === null) return 'lead'
  if (!draft.noReview && draft.review === null && !draft.planned) return 'review'
  return 'end'
}

export function DraftingCard({ draft, project, held, onHold }: { draft: Draft; project: string; held: boolean; onHold: () => void }) {
  const named = useModelNames()
  const effortOf = useEffortNames()
  const step = (key: 'implement' | 'review', who: Draft['lead']): LaunchStep => ({
    id: key,
    label: stepText.label[key],
    agents: who === null ? [] : [named(who.agentId, who.model)],
    ...(who === null ? {} : { effort: effortOf(who.agentId, who.model, who.effort) }),
  })
  // A plan made without a review has no row for one; until that is known, its seat waits.
  const steps = [step('implement', draft.lead), ...(draft.noReview ? [] : [step('review', draft.review)])]
  return (
    <TaskLaunch
      task={draft.slug ?? ''}
      title={draft.title ?? ''}
      {...(draft.preset === null ? {} : { preset: draft.preset })}
      project={project}
      steps={steps}
      picker={() => null}
      onStart={() => undefined}
      held={held}
      onHeldChange={(next) => {
        if (next) onHold()
      }}
      drafting={{ phase: phaseOf(draft) }}
    />
  )
}

/**
 * The drafts to show on a thread, and Hold for them: a draft whose card is in
 * the thread is that card from then on, and one held while it was drafted is
 * held as its plan comes. What was held is kept by task, as the draft itself
 * goes when the turn ends.
 */
export function useDraftingCards(
  drafts: ReadonlyArray<Draft>,
  items: ReadonlyArray<ThreadItem>,
  onHold: (planId: string) => void,
): { readonly shown: ReadonlyArray<Draft>; readonly held: (draft: Draft) => boolean; readonly hold: (draft: Draft) => void } {
  const [heldKeys, setHeldKeys] = useState<ReadonlySet<string>>(() => new Set())
  const tasks = useRef(new Map<string, string>())
  const applied = useRef(new Set<string>())
  const cards = items.flatMap((item) => (item.kind === 'task' ? [item.content] : []))
  const holdNow = useEffectEvent(onHold)
  useEffect(() => {
    for (const draft of drafts) if (draft.taskId !== null && heldKeys.has(draft.key)) tasks.current.set(draft.key, draft.taskId)
    for (const [key, taskId] of tasks.current) {
      const card = cards.find((one) => one.taskId === taskId)
      if (card === undefined || card.plan === null || applied.current.has(key)) continue
      applied.current.add(key)
      if (card.phase === 'planned') holdNow(card.plan.id)
    }
  })
  return {
    shown: drafts.filter((draft) => draft.taskId === null || !cards.some((card) => card.taskId === draft.taskId)),
    held: (draft) => heldKeys.has(draft.key),
    hold: (draft) => setHeldKeys((current) => new Set(current).add(draft.key)),
  }
}
