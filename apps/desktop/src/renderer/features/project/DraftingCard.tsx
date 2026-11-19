import { useState } from 'react'

import type { Draft, ThreadItem } from '@althar/contracts'
import { type LaunchPhase, type LaunchStep, TaskLaunch } from '@althar/ui'

import { useEffortNames, useModelNames } from '../../shared/modelNames'
import { stepText } from '../../shared/steps'

/*
 * A task's card while the coordinator drafts it (`useDrafts`): the plan
 * card's own, filling in as the draft is written, from the moment it begins,
 * rather than the whole card after a long wait. Hold is its one action: a
 * draft held here comes as a held plan. The thread's card takes its
 * place once the plan is in. Where its plan's call failed it says it has no
 * plan, still, offering to plan or discard it; discarded, from here or
 * anywhere, it says so.
 */

/** What drafting is at, from what is written so far. */
export const phaseOf = (draft: Draft): LaunchPhase => {
  if (!draft.brief) return 'writing'
  if (!draft.planning && !draft.planned) return 'sizing'
  if (draft.lead === null) return 'lead'
  if (!draft.noReview && draft.review === null && !draft.planned) return 'review'
  return 'end'
}

export function DraftingCard({
  draft,
  project,
  held,
  onHold,
  onPlan,
  planAsked,
  onDiscard,
}: {
  draft: Draft
  project: string
  held: boolean
  onHold: () => void
  /** Asks the coordinator for its plan, once its plan didn't come. */
  onPlan?: (task: { readonly taskId: string; readonly title: string; readonly slug: string }) => void
  /** Whether its plan was asked for and is still on its way: Plan it isn't offered again until it isn't. */
  planAsked?: (taskId: string) => boolean
  /** Discards its task; done once the runtime has it, rejected where it didn't. */
  onDiscard?: (taskId: string) => Promise<void>
}) {
  const named = useModelNames()
  const effortOf = useEffortNames()
  // Discarded from here shows at once, and as it was again where the runtime turns it down.
  const [discarding, setDiscarding] = useState(false)
  const discarded = draft.discarded === true || discarding
  const ended = discarded ? ('discarded' as const) : draft.unplanned === true ? ('unplanned' as const) : undefined
  const task =
    draft.taskId === null || draft.slug === null || draft.title === null
      ? null
      : { taskId: draft.taskId, slug: draft.slug, title: draft.title }
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
      drafting={{ phase: phaseOf(draft), ...(ended === undefined ? {} : { ended }) }}
      {...(task === null || onPlan === undefined || planAsked?.(task.taskId) === true ? {} : { onPlan: () => onPlan(task) })}
      {...(task === null || onDiscard === undefined
        ? {}
        : {
            onDiscard: () => {
              setDiscarding(true)
              void onDiscard(task.taskId).catch(() => setDiscarding(false))
            },
          })}
    />
  )
}

/**
 * The drafts to show on a thread, and Hold for them. A draft's card is in the
 * thread from the moment its task is made, where it was drafted (the runtime
 * posts it then), and keeps that place: the live draft shows in it (`inPlace`)
 * until its plan is in, so neither jumps past what the person said meanwhile.
 * Only one not yet a task shows after the thread (`shown`). Hold goes to the runtime at once,
 * which makes the draft's plan held as it comes, whether this screen is still
 * open then or not; it shows held here at once, and stays so where the
 * runtime turns it down only until the draft says otherwise.
 */
export function useDraftingCards(
  threadId: string | null,
  drafts: ReadonlyArray<Draft>,
  items: ReadonlyArray<ThreadItem>,
  onHold: (threadId: string, key: string) => Promise<void>,
): {
  readonly shown: ReadonlyArray<Draft>
  readonly inPlace: (taskId: string) => Draft | undefined
  readonly held: (draft: Draft) => boolean
  readonly hold: (draft: Draft) => void
} {
  const [pressed, setPressed] = useState<ReadonlySet<string>>(() => new Set())
  const cards = items.flatMap((item) => (item.kind === 'task' ? [item.content] : []))
  return {
    shown: drafts.filter((draft) => draft.taskId === null || !cards.some((card) => card.taskId === draft.taskId)),
    // Its plan in, the card has it: the thread's card shows it from then on.
    inPlace: (taskId) => drafts.find((draft) => draft.taskId === taskId && !draft.planned),
    held: (draft) => draft.held || pressed.has(draft.key),
    hold: (draft) => {
      if (threadId === null) return
      setPressed((current) => new Set(current).add(draft.key))
      // Turned down: it shows as the runtime has it again.
      void onHold(threadId, draft.key).catch(() =>
        setPressed((current) => {
          const next = new Set(current)
          next.delete(draft.key)
          return next
        }),
      )
    },
  }
}
