import { useMemo, useState } from 'react'

import type { Draft, ThreadItem } from '@althar/contracts'
import { type LaunchPhase, type LaunchStep, TaskLaunch } from '@althar/ui'

import { useModelNames, useStepEfforts } from '../../shared/modelNames'
import { stepText } from '../../shared/steps'
import type { TaskCardContent } from '../../shared/thread'

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
  const effortsOf = useStepEfforts()
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
    ...(who === null ? {} : effortsOf(who.agentId, who.model, who.effort)),
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

/** Where a draft that became a task was in the thread then: after the item last there, the thread's start where none was. */
type Anchor = { readonly id: string; readonly createdAt: string } | null

/** The id of the stand-in for a draft's card, until its own is read. */
const STAND_IN = 'drafting:'

/**
 * A card read as being drafted, with no live draft to fill it (a window opened in the middle of the coordinator's turn,
 * before it hears the draft): it says it is being drafted, and holds as the live one does, by its task.
 */
const draftOfCard = (card: TaskCardContent): Draft => ({
  key: `task:${card.taskId}`,
  title: card.title,
  brief: true,
  taskId: card.taskId,
  slug: card.slug,
  planning: false,
  lead: null,
  review: null,
  noReview: false,
  preset: null,
  planned: false,
  held: false,
})

/**
 * The drafts to show on a thread, and Hold for them. A draft's card is in the
 * thread from the moment its task is made, where it was drafted (the runtime
 * posts it then), and keeps that place: the live draft shows in it (`inPlace`)
 * until its plan is in, so neither jumps past what the person said meanwhile.
 * Until its card is read, a draft that is a task stands in the thread (`placed`)
 * after what was there when the window heard it became one, so what the person
 * says from then on comes after it, as it will once its card is in. Only one
 * not yet a task shows after the thread (`shown`). Hold goes to the runtime at once,
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
  readonly placed: ReadonlyArray<ThreadItem>
  readonly inPlace: (card: TaskCardContent) => Draft | undefined
  readonly held: (draft: Draft) => boolean
  readonly hold: (draft: Draft) => void
} {
  const [pressed, setPressed] = useState<ReadonlySet<string>>(() => new Set())
  const cards = new Set(items.flatMap((item) => (item.kind === 'task' && !item.id.startsWith(STAND_IN) ? [item.content.taskId] : [])))
  // Tasks now, their cards not read yet: each where the thread was as the window heard it became one.
  const waiting = drafts.filter((draft) => draft.taskId !== null && !cards.has(draft.taskId))
  const [heard, setHeard] = useState<ReadonlyMap<string, Anchor>>(() => new Map())
  let anchors = heard
  if (waiting.some((draft) => !heard.has(draft.taskId ?? ''))) {
    const last = items.at(-1)
    const next = new Map(heard)
    for (const draft of waiting)
      if (!next.has(draft.taskId ?? ''))
        next.set(draft.taskId ?? '', last === undefined ? null : { id: last.id, createdAt: last.createdAt })
    anchors = next
    setHeard(next)
  }
  const standing = new Set(waiting.map((draft) => draft.taskId ?? ''))
  const placed = useMemo(() => {
    if (waiting.length === 0) return items
    const out = [...items]
    for (const draft of waiting) {
      const anchor = anchors.get(draft.taskId ?? '') ?? null
      // Its item, or, where that went (a message the runtime has under its own id now), the last before it.
      let at = anchor === null ? -1 : out.findIndex((item) => item.id === anchor.id)
      if (anchor !== null && at < 0) at = out.findLastIndex((item) => !item.id.startsWith(STAND_IN) && item.createdAt <= anchor.createdAt)
      at += 1
      while (out[at]?.id.startsWith(STAND_IN) === true) at += 1
      const before = out[at - 1]
      out.splice(at, 0, {
        id: `${STAND_IN}${draft.taskId}`,
        sequence: before?.sequence ?? 0,
        createdAt: before?.createdAt ?? new Date(0).toISOString(),
        agentId: null,
        kind: 'task',
        content: {
          taskId: draft.taskId,
          slug: draft.slug ?? '',
          title: draft.title ?? '',
          phase: 'drafting',
          plan: null,
        } as unknown as TaskCardContent,
      } as ThreadItem)
    }
    return out
    // `waiting` and `anchors` are read from `drafts`, `items` and `heard`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, drafts, heard])
  return {
    shown: drafts.filter((draft) => draft.taskId === null),
    placed,
    // Its plan in, the card has it: the thread's card shows it from then on. Read as being drafted with nothing live to fill
    // it, it says so, rather than that no plan came.
    inPlace: (card) => {
      const live = drafts.find((draft) => draft.taskId === card.taskId)
      if (live !== undefined) return !live.planned || standing.has(card.taskId) ? live : undefined
      return card.phase === 'drafting' && card.unplanned !== true && card.discarded !== true ? draftOfCard(card) : undefined
    },
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
