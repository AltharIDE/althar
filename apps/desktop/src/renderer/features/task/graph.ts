import type { AttentionRequest, GraphRound, GraphStep, ThreadItem, ThreadSnapshot } from '@althar/contracts'
import { GraphNodeState, type StepGraphLane, type StepGraphRound, type StepGraphStep, unreachable } from '@althar/ui'

import type { NameModel } from '../../shared/modelNames'
import { stepText } from '../../shared/steps'
import { running } from '../../shared/time'

/*
 * A task's Graph face, from its thread's snapshot: the runtime's rounds of
 * work and their steps (`task.graph`), each step with what it came to from
 * its report, and the calls waiting on it from the snapshot's attention. A
 * lane for each agent and model that worked on it, the lead's first, and
 * Althar's last; a marker for each round, saying who started it.
 */

export const graphText = {
  label: { ...stepText.label, settle: 'Settle', publish: 'Pull request' },
  review: (n: number) => `Review ${n}`,
  althar: 'Althar',
  by: { asked: 'You asked', followedUp: 'You followed up', relayed: 'From the coordinator', followUp: 'Follow-up' },
  later: (minutes: number) =>
    minutes < 60
      ? `${minutes}m later`
      : minutes < 48 * 60
        ? `${Math.round(minutes / 60)}h later`
        : `${Math.round(minutes / 1440)} days later`,
  added: (labels: ReadonlyArray<string>) => `${labels.join(' and ')} added`,
  corner: {
    next: 'next',
    added: 'added',
    asks: 'asks you',
    stuck: 'stuck',
    proposed: 'your say',
    held: 'waits for an agent',
    limit: 'at its limit',
  },
  outcome: {
    passed: (notes: number) => (notes === 0 ? 'Passed' : `Passed · ${notes === 1 ? '1 note' : `${notes} notes`}`),
    findings: (n: number) => (n === 1 ? '1 finding' : `${n} findings`),
    settled: (n: number) => `${n} settled`,
    change: (draft: boolean, name: string, merged: boolean) => `${draft && !merged ? 'Draft ' : ''}${name}${merged ? ' merged' : ''}`,
    permission: 'A command to allow',
    question: 'A question for you',
    stuck: 'Needs you',
  },
}

/** The block the thread opens with, what the person asked for, by its id there (TaskView). */
export const REQUEST = 'request'

/** A round's gap before it worth saying, in minutes: under five, it carried straight on. */
const GAP = 5

export type Report = Extract<ThreadItem, { kind: 'step_result' }>

/** What the face knows of a step beyond its card: where it came from, its report, the calls waiting on it. */
export interface StepFacts {
  readonly step: GraphStep
  readonly round: GraphRound
  readonly report: Report | null
  /** For a settling, the report of the review it settled, in its own round. */
  readonly reviewed: Report | null
  readonly calls: ReadonlyArray<AttentionRequest>
  readonly state: GraphNodeState
}

export interface TaskGraph {
  readonly lanes: ReadonlyArray<StepGraphLane>
  readonly rounds: ReadonlyArray<StepGraphRound>
  readonly steps: ReadonlyArray<StepGraphStep>
  readonly facts: ReadonlyMap<string, StepFacts>
  /**
   * Where each round's marker goes in the conversation, by the item's id (`data-item`): what started a follow-up, the
   * request the thread opens with for the plan's (`request`), else its first report. Absent: the conversation as it is.
   */
  readonly saidAt: ReadonlyMap<string, string>
}

const minutesBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 60_000)

/** Its report: the step's kind and how-manyth, in its round's span. */
const reportOf = (reports: ReadonlyArray<Report>, step: GraphStep, round: GraphRound, next: GraphRound | undefined): Report | null =>
  reports.findLast(
    (item) =>
      item.content.step === step.key &&
      item.content.round === step.iteration &&
      item.createdAt >= round.createdAt &&
      (next === undefined || item.createdAt < next.createdAt),
  ) ?? null

const stateOf = (step: GraphStep): GraphNodeState => {
  switch (step.state) {
    case 'done':
      return GraphNodeState.Done
    case 'running':
      return GraphNodeState.Now
    case 'waiting':
      return GraphNodeState.Waiting
    case 'held':
      return GraphNodeState.Held
    case 'failed':
    case 'cancelled':
      return GraphNodeState.Stopped
    case 'next':
      return step.added ? GraphNodeState.Added : GraphNodeState.Next
    default:
      return unreachable(step.state)
  }
}

const labelOf = (step: GraphStep, round: GraphRound): string => {
  switch (step.key) {
    case 'implement':
      return round.followUp ? stepText.followUp : graphText.label.implement
    case 'review':
      return graphText.review(step.iteration + 1)
    case 'settle':
    case 'publish':
      return graphText.label[step.key]
    default:
      return unreachable(step.key)
  }
}

/** What it came to: a review's verdict, how many findings a settling settled, the pull request it opened. */
const outcomeOf = (snapshot: ThreadSnapshot, facts: StepFacts): Pick<StepGraphStep, 'outcome' | 'warn'> => {
  const waiting = facts.calls[0]
  if (waiting !== undefined)
    return {
      outcome:
        waiting.kind === 'permission'
          ? graphText.outcome.permission
          : waiting.kind === 'question'
            ? graphText.outcome.question
            : graphText.outcome.stuck,
    }
  const report = facts.report
  if (report === null) return {}
  const { content } = report
  switch (facts.step.key) {
    case 'review':
      return content.verdict === 'changes_requested'
        ? { outcome: graphText.outcome.findings(content.findings.length), warn: true }
        : { outcome: graphText.outcome.passed(content.findings.length) }
    case 'settle':
      return facts.reviewed === null ? {} : { outcome: graphText.outcome.settled(facts.reviewed.content.findings.length) }
    case 'publish': {
      const change = content.change
      if (change === null) return {}
      const now = snapshot.task.changes.find((one) => one.url === change.url) ?? change
      return { outcome: graphText.outcome.change(now.draft, `${change.prefix}${change.number}`, now.state === 'merged') }
    }
    case 'implement':
      return {}
    default:
      return unreachable(facts.step.key)
  }
}

const cornerOf = (step: GraphStep, state: GraphNodeState, calls: ReadonlyArray<AttentionRequest>, now: string): string | undefined => {
  switch (state) {
    case GraphNodeState.Done:
    case GraphNodeState.Stopped:
      return step.startedAt === null || step.endedAt === null ? undefined : running(step.startedAt, step.endedAt)
    case GraphNodeState.Now:
      return step.startedAt === null ? undefined : running(step.startedAt, now)
    case GraphNodeState.Waiting:
      return calls.some((call) => call.kind === 'stuck') ? graphText.corner.stuck : graphText.corner.asks
    case GraphNodeState.Held:
      return step.hold === 'usage_limit' ? graphText.corner.limit : graphText.corner.held
    case GraphNodeState.Proposed:
      return graphText.corner.proposed
    case GraphNodeState.Added:
      return graphText.corner.added
    case GraphNodeState.Next:
      return graphText.corner.next
    default:
      return unreachable(state)
  }
}

/** Who a step is, as its lane knows it: Althar's own, or an agent on a model. */
const whoKey = (step: GraphStep) => (step.agentId === null ? 'althar' : `${step.agentId}|${step.model ?? ''}`)

/**
 * Its lanes, in the order their agents first worked on it, the lead's first and Althar's last. A step its plan names an
 * agent's default model for (one to come) goes in the lane that agent last worked in, so its default isn't a lane of its own.
 */
const lanesOf = (snapshot: ThreadSnapshot, rounds: ReadonlyArray<GraphRound>, named: NameModel) => {
  const keys: string[] = []
  const laneOf = new Map<string, string>()
  for (const step of rounds.flatMap((round) => round.steps)) {
    const own = whoKey(step)
    const theirs = step.agentId !== null && step.model === null ? keys.findLast((key) => key.startsWith(`${step.agentId}|`)) : undefined
    const key = theirs ?? own
    laneOf.set(step.id, key)
    if (!keys.includes(key)) keys.push(key)
  }
  const lead = snapshot.task.lead
  const isLead = (key: string) =>
    lead !== null && key.startsWith(`${lead.agentId}|`) && (lead.model === null || key === `${lead.agentId}|${lead.model}`)
  const ordered = [
    ...keys.filter(isLead),
    ...keys.filter((key) => !isLead(key) && key !== 'althar'),
    ...keys.filter((key) => key === 'althar'),
  ]
  const lanes = ordered.map((key): StepGraphLane => {
    if (key === 'althar') return { id: key, who: { kind: 'althar', name: graphText.althar } }
    const [agentId = '', model = ''] = key.split('|')
    return { id: key, who: { kind: 'model', model: named(agentId, model === '' ? null : model) }, ...(isLead(key) ? { lead: true } : {}) }
  })
  return { lanes, laneOf }
}

/** The calls waiting on a round's steps: a stuck step's on its own step, a permission or question on the step at work. */
const callsOf = (snapshot: ThreadSnapshot, round: GraphRound) => {
  const stuck = snapshot.attention.filter((call) => call.kind === 'stuck' && call.stuck !== null)
  const asking = snapshot.attention.filter((call) => call.kind === 'permission' || call.kind === 'question')
  const on = new Map<string, AttentionRequest[]>()
  const add = (id: string | undefined, call: AttentionRequest) => id !== undefined && on.set(id, [...(on.get(id) ?? []), call])
  for (const call of stuck)
    if (call.stuck?.why !== 'round_limit')
      add(round.steps.findLast((step) => step.key === call.stuck?.step && step.state !== 'next')?.id, call)
  const atWork = round.steps.findLast((step) => step.state === 'waiting') ?? round.steps.findLast((step) => step.state === 'running')
  for (const call of asking) add(atWork?.id, call)
  return { on, proposal: stuck.find((call) => call.stuck?.why === 'round_limit') }
}

/** A task's Graph face, from its snapshot; null where the runtime keeps no rounds of work for it. */
export function taskGraphOf(snapshot: ThreadSnapshot, named: NameModel, now: string): TaskGraph | null {
  const rounds = snapshot.task.graph ?? []
  if (rounds.length === 0) return null
  // Its steps' reports, whatever page they're on, and any that came since.
  const reports = [...new Map([...snapshot.reports, ...snapshot.items].map((item) => [item.id, item])).values()]
    .filter((item): item is Report => item.kind === 'step_result')
    .sort((one, other) => one.sequence - other.sequence)
  const { lanes, laneOf } = lanesOf(snapshot, rounds, named)
  const facts = new Map<string, StepFacts>()
  const steps: StepGraphStep[] = []
  const markers: StepGraphRound[] = []
  const saidAt = new Map<string, string>()

  rounds.forEach((round, index) => {
    const before = rounds[index - 1]
    const last = index === rounds.length - 1
    const { on, proposal } = last ? callsOf(snapshot, round) : { on: new Map<string, AttentionRequest[]>(), proposal: undefined }
    const shown: GraphStep[] = [...round.steps]
    // A fourth review the person's say would add: after the last review's settling, before what is still to come.
    const lastReview = shown.findLast((step) => step.key === 'review')
    if (proposal?.stuck != null && lastReview !== undefined) {
      const at = shown.findIndex((step) => step.state === 'next')
      const proposed: GraphStep = {
        ...lastReview,
        id: `${round.id}:proposed`,
        key: 'review',
        iteration: proposal.stuck.round,
        state: 'next',
        startedAt: null,
        endedAt: null,
      }
      shown.splice(at === -1 ? shown.length : at, 0, proposed)
      on.set(proposed.id, [proposal])
      laneOf.set(proposed.id, laneOf.get(lastReview.id) ?? whoKey(lastReview))
    }
    for (const step of shown) {
      const calls = on.get(step.id) ?? []
      const proposed = step.id === `${round.id}:proposed`
      const state = proposed ? GraphNodeState.Proposed : calls.length > 0 ? GraphNodeState.Waiting : stateOf(step)
      const next = rounds[index + 1]
      const one: StepFacts = {
        step,
        round,
        report: reportOf(reports, step, round, next),
        reviewed: step.key === 'settle' ? reportOf(reports, { ...step, key: 'review' }, round, next) : null,
        calls,
        state,
      }
      facts.set(step.id, one)
      const corner = cornerOf(step, state, calls, now)
      steps.push({
        id: step.id,
        lane: laneOf.get(step.id) ?? whoKey(step),
        round: round.id,
        label: labelOf(step, round),
        state,
        ...(corner === undefined ? {} : { corner }),
        ...outcomeOf(snapshot, one),
      })
    }

    // Its marker: who started it, how long after the round before, what they said, and what a change to its steps put in.
    const said = round.said
    const by = !round.followUp
      ? graphText.by.asked
      : said === null
        ? graphText.by.followUp
        : said.relayed
          ? graphText.by.relayed
          : graphText.by.followedUp
    const gap = before === undefined ? null : minutesBetween(before.endedAt ?? before.createdAt, round.createdAt)
    const added = [
      ...new Set(
        round.steps.filter((step) => step.added).map((step) => (step.key === 'publish' ? graphText.label.publish : graphText.label.review)),
      ),
    ]
    markers.push({
      id: round.id,
      by,
      said: said?.text ?? (round.followUp ? '' : (snapshot.task.request ?? snapshot.task.description)),
      ...(gap !== null && gap >= GAP ? { after: graphText.later(gap) } : {}),
      ...(round.changedAt === null || added.length === 0 ? {} : { changed: graphText.added(added) }),
    })
    // What it goes to: what started a follow-up; for the plan's, the request the thread opens with; else where it reported first.
    const first = round.steps.map((step) => facts.get(step.id)?.report).find((report) => report != null)
    const target = said?.itemId ?? (!round.followUp && snapshot.task.request !== null ? REQUEST : first?.id)
    if (target !== undefined) saidAt.set(round.id, target)
  })

  return { lanes, rounds: markers, steps, facts, saidAt }
}
