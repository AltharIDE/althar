import { useEffect, useRef, useState } from 'react'

import type { AgentStatus, PlanStep } from '@althar/contracts'
import {
  Model,
  SmallChange,
  useTypedTitle,
  type SmallChangeChecks,
  type SmallChangeReview,
  type SmallChangeReviewWhen,
  Problem,
} from '@althar/ui'

import { messageOf } from '../../data/client'
import { useServices } from '../../data/services'
import { type NameModel, useEffortNames } from '../../shared/modelNames'
import type { SmallChangeContent } from '../../shared/thread'
import { ChangeTeam, text as teamText, useTeamed } from '../team/Team'
import s from './FastLaneOf.module.css'

/*
 * A small change's card (docs/decisions/reviews.md, "An explicit review after merge"): its route, read from the task as it stands.
 * Merge does what the task's own Merge does, and still asks. Its review stop
 * moves the review before the merge (Make it a full task), keeps it after,
 * or takes it off, at once, and goes back with a line where that fails. See
 * findings takes the person to the review's report in this thread; for a full
 * task, to its review task, whose review holds Merge until it comes back clear.
 * Under its title is its team, and Change the team… from the moment the card
 * appears (it has no countdown to wait on): the same dialog a task's header
 * opens, a new lead taking over from its next turn, a new reviewer applying until
 * its review starts. What the person saved shows at once, until the card read
 * again says it.
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
const whenOf = (card: SmallChangeContent, reviewer: unknown): SmallChangeReviewWhen =>
  (card.fullTask ?? card.review) != null
    ? 'before'
    : card.reviewAfter !== undefined
      ? 'after'
      : card.reviewAfterMerge === false
        ? reviewer === null
          ? 'none'
          : 'before'
        : reviewer === null || card.afterMerge?.holds === 'none'
          ? 'none'
          : 'after'

/** Who is on a step as read: the lead as the board reads who leads next, the reviewer as the card reads it. */
interface Seat {
  readonly agentId: string
  readonly model: string | null
  readonly effort?: string | null | undefined
}

/** A step the person saved, with what was read of it when they did. */
interface Saved {
  readonly step: PlanStep
  readonly baseline: string
}

/** Whether a read says what was saved: the reviewer off, or the same agent and model, and the effort where one was picked. */
const confirms = (step: PlanStep, read: Seat | null): boolean =>
  step.skipped
    ? read === null
    : read !== null &&
      read.agentId === step.agentId &&
      (read.model ?? null) === (step.model ?? null) &&
      (step.effort == null || step.effort === (read.effort ?? null))

/** The team as its card says it: Sonnet 5.5 · Low, GPT-6.1 Sol reviews. */
const teamLine = (lead: string, review: string | null) =>
  teamText.team(lead, review === null ? teamText.noReview : teamText.reviews(review))

export function SmallChangeOf({
  card,
  named,
  projectId,
  agents,
  busy,
  onMerge,
  onOpen,
  onShow,
}: {
  card: SmallChangeContent
  named: NameModel
  projectId: string
  agents: ReadonlyArray<AgentStatus>
  busy: boolean
  /** Merges its open change, as the task's header does, which asks first. */
  onMerge: (change: { readonly head: string; readonly url: string; readonly bypassQueue?: boolean }) => void
  /** Opens another task, by its thread: the review it became a full task with. */
  onOpen?: (threadId: string) => void
  /** Brings an item of this thread into view: its review's report. */
  onShow?: (itemId: string) => void
}) {
  const { client } = useServices()
  const title = useTypedTitle(card.title)
  const [error, setError] = useState<string | null>(null)
  // Its team: what the person just saved, laid over what is read until a read of its own says it, or says something else.
  const effortOf = useEffortNames()
  const teamed = useTeamed(projectId, card.taskId)
  const [changingTeam, setChangingTeam] = useState(false)
  // Who leads from its next turn: the board's reading, which follows a lead changed through the composer or by Auto, not only the plan's.
  const planned = teamed?.plan?.steps.find((step) => step.key === 'implement')
  const nowLead: Seat = planned ?? { agentId: card.lead.agentId, model: card.lead.model, effort: card.lead.effort ?? null }
  const nowReview: Seat | null = card.reviewer ?? null
  const [saved, setSaved] = useState<Partial<Record<PlanStep['key'], Saved>>>({})
  // Each saved step is let go once its own read confirms it, or reads as anything else after the save: the read that confirms it
  // may come before the command's answer, and a later change of lead through the composer must not hide behind it.
  const reads = useRef({ lead: nowLead, review: nowReview })
  reads.current = { lead: nowLead, review: nowReview }
  const readLead = JSON.stringify(nowLead)
  const readReview = JSON.stringify(nowReview)
  useEffect(() => {
    setSaved((was) => {
      let next = was
      for (const key of ['implement', 'review'] as const) {
        const one = was[key]
        if (one === undefined) continue
        const auth = key === 'implement' ? nowLead : nowReview
        if (confirms(one.step, auth) || JSON.stringify(auth) !== one.baseline) {
          if (next === was) next = { ...was }
          delete next[key]
        }
      }
      return next
    })
    // The reads are compared by what they say, not by identity.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [saved, readLead, readReview])
  // Its reviewer as it stands, the person's saved word first: the route below follows it, as the team line does.
  const savedReview = saved.review?.step
  const reviewStep = savedReview === undefined ? card.reviewer : savedReview.skipped ? null : savedReview
  // What the person just chose, shown at once until the card read again says it.
  const [chosen, setChosen] = useState<SmallChangeReviewWhen | null>(null)
  const kept = whenOf(card, reviewStep)
  useEffect(() => setChosen(null), [kept])
  const change = card.change
  const head = change?.head ?? null
  const merged = change?.state === 'merged'
  const checks = checksOf(card)
  const changed = stepOf(card, 'changed')
  const reported = changed?.done === true
  const after = card.reviewAfter
  // Its review task: kept as fullTask after the merge too, and as review where a runtime before that names it only there.
  const full = card.fullTask ?? card.review ?? null
  // A full task's review is its own task's, read before the merge and kept after it; else the review after the merge.
  const beforeShip = card.reviewAfterMerge === false && card.reviewAfter === undefined
  const before = full === null && !beforeShip ? undefined : card.reviewBefore
  const beforeStep = beforeShip ? stepOf(card, 'review') : undefined
  const when = chosen ?? kept
  const review: SmallChangeReview =
    full !== null || beforeShip
      ? {
          when,
          state:
            before?.state ??
            (beforeShip
              ? beforeStep?.done === true
                ? 'clear'
                : beforeStep?.what === 'Reviewing before Ship'
                  ? 'running'
                  : beforeStep?.at != null
                    ? 'stopped'
                    : 'waiting'
              : 'running'),
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
  const reviewed = when !== 'before' || before?.state === 'clear' || (beforeShip && beforeStep?.what === 'Review skipped')
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
  const leadStep = saved.implement?.step ?? nowLead
  const lead = named(leadStep.agentId, leadStep.model)
  const reviewer = reviewStep == null ? null : named(reviewStep.agentId, reviewStep.model)
  const effort = effortOf(leadStep.agentId, leadStep.model, leadStep.effort ?? null)
  const team = teamLine(`${lead.name}${effort === null ? '' : ` · ${effort}`}`, reviewer === null ? null : reviewer.name)
  const holds = card.afterMerge?.holds ?? 'major'
  const explain = beforeShip ? (
    reviewer === null ? (
      <>
        Starts at once on <Model model={lead} short />, with no countdown and no reviewer configured.
      </>
    ) : (
      <>
        Starts at once on <Model model={lead} short />. <Model model={reviewer} short /> reads the change before Ship.
      </>
    )
  ) : when === 'before' && reviewer !== null ? (
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
  // A review set to read after the merge keeps its timing: only the Review stop changes it, so the dialog leaves it out.
  const leadOnly = card.reviewAfterMerge === true || after !== undefined
  const item = full === null ? (after?.item ?? null) : null
  return (
    <>
      <SmallChange
        title={title}
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
        team={team}
        {...(teamed === null ? {} : { onTeam: () => setChangingTeam(true) })}
        busy={busy}
        {...(ready ? { onMerge: () => onMerge({ head, url: change.url }) } : {})}
        {...(ready && change.canBypassQueue === true && change.unpushed === 0
          ? { onBypassQueue: () => onMerge({ head, url: change.url, bypassQueue: true }) }
          : {})}
        {...(beforeShip
          ? {
              text: {
                fullTask: 'Small change',
                beforeMerge: beforeStep?.what ?? 'Review before Ship',
                stopped: beforeStep?.what ?? 'Review stopped',
                clear: 'Reviewed before Ship',
              },
            }
          : {})}
        {...(card.reviewAfterMerge === false || merged || full !== null ? {} : { onReview: choose })}
        {...(full !== null
          ? onOpen === undefined
            ? {}
            : { onFindings: () => onOpen(full.threadId), onOpenReview: () => onOpen(full.threadId) }
          : item === null || onShow === undefined
            ? {}
            : { onFindings: () => onShow(item) })}
      />
      {error !== null && <Problem className={s.failure}>{text.failed(error)}</Problem>}
      {changingTeam && (
        <ChangeTeam
          projectId={projectId}
          task={teamed}
          agents={agents}
          onClose={() => setChangingTeam(false)}
          {...(leadOnly ? { leadOnly: true } : {})}
          onSaved={(changed) =>
            setSaved((was) => ({
              ...was,
              ...Object.fromEntries(
                changed.map((step) => [
                  step.key,
                  { step, baseline: JSON.stringify(step.key === 'implement' ? reads.current.lead : reads.current.review) },
                ]),
              ),
            }))
          }
        />
      )}
    </>
  )
}
