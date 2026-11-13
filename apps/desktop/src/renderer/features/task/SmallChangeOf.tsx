import { useEffect, useState } from 'react'

import { Model, SmallChange, type SmallChangeChecks, type SmallChangeReview, type SmallChangeReviewWhen } from '@althar/ui'

import { messageOf } from '../../data/client'
import { useServices } from '../../data/services'
import type { NameModel } from '../../shared/modelNames'
import type { SmallChangeContent } from '../../shared/thread'
import s from './FastLaneOf.module.css'

/*
 * A small change's card (docs/decisions/reviews.md, "A small change is
 * reviewed after it merges"): its route, read from the task as it stands.
 * Merge does what the task's own Merge does, and still asks. Its review stop
 * moves the review before the merge (Make it a full task), keeps it after,
 * or takes it off, at once, and goes back with a line where that fails. See
 * findings takes the person to the review's report in this thread; for a full
 * task, to its review task, whose review holds Merge until it comes back clear.
 */

export const text = {
  failed: (why: string) => `That didn’t go through. ${why}`,
}

type Step = SmallChangeContent['steps'][number]
const stepOf = (card: SmallChangeContent, key: Step['key']) => card.steps.find((step) => step.key === key)

/** What its lead reported changing, without the step's own verb: "6 files", "1 line in RunMenu.tsx". */
const wordsOf = (what: string | undefined) => (what === undefined ? null : what.replace(/^Changed /, ''))

/** Its checks, from its pull request as last seen. */
function checksOf(card: SmallChangeContent): SmallChangeChecks {
  const summary = card.change?.checks ?? null
  const at = stepOf(card, 'checks')?.at ?? null
  if (summary === null) return { state: 'waiting', passed: 0, total: 0, failing: null, at }
  const state = summary.outcome === 'none' ? (summary.total === 0 ? 'none' : 'waiting') : summary.outcome
  return { state, passed: summary.passed, total: summary.total, failing: summary.failing[0] ?? null, at }
}

/** When its review reads it: before the merge once it was made a full task, none where its rule or its own word says so. */
const whenOf = (card: SmallChangeContent): SmallChangeReviewWhen =>
  card.fullTask != null ? 'before' : card.reviewer === null || card.afterMerge?.holds === 'none' ? 'none' : 'after'

export function SmallChangeOf({
  card,
  named,
  busy,
  onMerge,
  onOpen,
  onShow,
}: {
  card: SmallChangeContent
  named: NameModel
  busy: boolean
  /** Merges its open change, as the task's header does, which asks first. */
  onMerge: (change: { readonly head: string; readonly url: string }) => void
  /** Opens another task, by its thread: the review it became a full task with. */
  onOpen?: (threadId: string) => void
  /** Brings an item of this thread into view: its review's report. */
  onShow?: (itemId: string) => void
}) {
  const { client } = useServices()
  const [error, setError] = useState<string | null>(null)
  // What the person just chose, shown at once until the card read again says it.
  const [chosen, setChosen] = useState<SmallChangeReviewWhen | null>(null)
  const kept = whenOf(card)
  useEffect(() => setChosen(null), [kept])
  const change = card.change
  const head = change?.head ?? null
  const merged = change?.state === 'merged'
  const checks = checksOf(card)
  const changed = stepOf(card, 'changed')
  const reported = changed?.done === true
  const after = card.reviewAfter
  const full = card.fullTask ?? null
  // A full task's review is its own task's, read before the merge and kept after it; else the review after the merge.
  const before = full === null ? undefined : card.reviewBefore
  const when = chosen ?? kept
  const review: SmallChangeReview =
    full !== null
      ? {
          when,
          state: before === undefined ? 'running' : before.state,
          findings: before?.findings ?? 0,
          at: before?.at ?? null,
        }
      : {
          when,
          state: after === undefined ? 'waiting' : after.state,
          findings: after?.findings ?? 0,
          at: after?.at ?? null,
        }
  // A full task merges once its review comes back clear, as its own task's review holds it.
  const reviewed = when !== 'before' || before?.state === 'clear'
  const ready =
    change !== null && change.state === 'open' && head !== null && reviewed && (checks.state === 'passed' || checks.state === 'none')
  const choose = (next: SmallChangeReviewWhen) => {
    if (next === when) return
    setError(null)
    setChosen(next)
    const done =
      next === 'before'
        ? client.makeItAFullTask(card.taskId)
        : client.setReviewAfterMerge(card.taskId, next === 'none' ? 'none' : card.afterMerge?.project === 'none' ? 'review' : null)
    done.catch((failure: unknown) => {
      setChosen(null)
      setError(messageOf(failure))
    })
  }
  const lead = named(card.lead.agentId, card.lead.model)
  const reviewer = card.reviewer == null ? null : named(card.reviewer.agentId, card.reviewer.model)
  const holds = card.afterMerge?.holds ?? 'major'
  const explain =
    when === 'before' && reviewer !== null ? (
      <>
        Made a full task: <Model model={reviewer} short /> reads it before it merges.
      </>
    ) : when === 'none' || reviewer === null ? (
      <>
        Starts at once on <Model model={lead} short />, with no plan, and no review after it merges.
      </>
    ) : (
      <>
        Starts at once on <Model model={lead} short />, with no plan. You merge it; <Model model={reviewer} short /> then reads what merged,
        and {holds === 'all' ? 'what it finds comes back here' : 'only something major comes back here'}.
      </>
    )
  const item = full === null ? (after?.item ?? null) : null
  return (
    <>
      <SmallChange
        title={card.title}
        started={stepOf(card, 'started')?.at ?? ''}
        changed={{
          at: reported ? (changed?.at ?? null) : null,
          words: reported ? wordsOf(changed?.what) : null,
        }}
        checks={checks}
        merge={{
          state: merged ? 'merged' : change?.queued === true ? 'queued' : ready ? 'ready' : 'waiting',
          at: stepOf(card, 'merged')?.at ?? null,
        }}
        review={review}
        explain={explain}
        busy={busy}
        {...(ready ? { onMerge: () => onMerge({ head, url: change.url }) } : {})}
        {...(merged || full !== null ? {} : { onReview: choose })}
        {...(full !== null
          ? onOpen === undefined
            ? {}
            : { onFindings: () => onOpen(full.threadId), onOpenReview: () => onOpen(full.threadId) }
          : item === null || onShow === undefined
            ? {}
            : { onFindings: () => onShow(item) })}
      />
      {error !== null && (
        <p className={s.failure} role="alert">
          {text.failed(error)}
        </p>
      )}
    </>
  )
}
