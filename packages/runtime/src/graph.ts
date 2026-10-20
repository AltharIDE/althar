import type { GraphRound, GraphStep, GraphStepState } from '@althar/contracts'

/*
 * A task's rounds of work as its graph had them, for its Graph face: each run
 * (its plan's, then each follow-up, ADR-034) with its steps in the order they
 * ran, then what its plan still has to come. Read from the rows the store
 * keeps of runs, nodes and their tries, and never stored itself.
 *
 * A step is a node, however many times it was tried: a restart or a hand to
 * another agent is a try of the same step, which says where its last try
 * stands and who made it. What is still to come is only what the plan has and
 * hasn't started: its work, its first review and its pull request. A review's
 * settling, and the review after it, start the moment the step before
 * reports, so they show as they happen and are never guessed.
 */

type StepKey = GraphStep['key']

/** A try at a step, as `node_attempts` keeps it, with the agent and model of the session it ran in. */
export interface TryRow {
  readonly state: string
  readonly hold: string | null
  readonly agentId: string | null
  readonly model: string | null
  readonly startedAt: string | null
  readonly endedAt: string | null
}

/** A step of a run, as `nodes` keeps it, with its tries in order. */
export interface StepRow {
  readonly id: string
  readonly key: StepKey
  readonly iteration: number
  readonly state: string
  readonly tries: ReadonlyArray<TryRow>
}

/** Who a plan's step is for, as its parameters name them. */
export interface PlannedStep {
  readonly key: 'implement' | 'review'
  readonly agentId: string
  readonly model: string | null
  readonly skipped: boolean
}

/** A run, with what the caller read of it: its steps, its plan's, how it ends, and what started it. */
export interface RunRows {
  readonly id: string
  /** Null for a round of work after the plan. */
  readonly planId: string | null
  readonly createdAt: string
  readonly endedAt: string | null
  readonly planned: ReadonlyArray<PlannedStep>
  /** Whether it ends in publishing, as `conclude` would decide now: a pull request opened, or its branch pushed. */
  readonly publishes: boolean
  /** The steps its graph had as it began, by key. */
  readonly began: ReadonlyArray<string>
  /** When a change to its steps (a patch of its graph) added to them, if one did. */
  readonly changedAt: string | null
  readonly said: GraphRound['said']
  readonly steps: ReadonlyArray<StepRow>
}

const HOLDS = ['usage_limit', 'agent_unavailable', 'machine_busy'] as const
type Hold = (typeof HOLDS)[number]
const holdOf = (hold: string | null): Hold | null => HOLDS.find((one) => one === hold) ?? null

/** Where a try stands, in the graph's words. A try still being admitted, verified or reconciled is running. */
const stateOfTry = (state: string): GraphStepState => {
  switch (state) {
    case 'succeeded':
      return 'done'
    case 'waiting_attention':
      return 'waiting'
    case 'held':
      return 'held'
    case 'failed':
      return 'failed'
    case 'cancelled':
    case 'cancelling':
    case 'superseded':
      return 'cancelled'
    default:
      return 'running'
  }
}

/** Where a step stands: as its last try does; with none yet, to come, or cut short where the node was skipped or cancelled. */
const stateOf = (step: StepRow): GraphStepState => {
  const last = step.tries.at(-1)
  if (last !== undefined) return stateOfTry(last.state)
  return step.state === 'skipped' || step.state === 'cancelled' ? 'cancelled' : 'next'
}

/** Whether a step was put in by a change to the run's steps: the change came, and the run began without its kind of step. */
const addedTo = (run: RunRows, key: StepKey): boolean => {
  if (run.changedAt === null || key === 'implement') return false
  // A settling belongs to its review; publishing is never one of a graph's steps, so a change that came put it in.
  return key === 'publish' || !run.began.includes('review')
}

const stepOf = (run: RunRows, row: StepRow): GraphStep => {
  const last = row.tries.at(-1)
  const state = stateOf(row)
  // Who made its last try; before any try reached an agent, as one held for a place hasn't, who its plan names.
  const who = last?.agentId != null ? { agentId: last.agentId, model: last.model } : plannedFor(run, row.key)
  return {
    id: row.id,
    key: row.key,
    iteration: row.iteration,
    state,
    hold: state === 'held' ? holdOf(last?.hold ?? null) : null,
    agentId: who?.agentId ?? null,
    model: who?.model ?? null,
    startedAt: row.tries.find((one) => one.startedAt !== null)?.startedAt ?? null,
    endedAt: state === 'done' || state === 'failed' || state === 'cancelled' ? (last?.endedAt ?? null) : null,
    added: addedTo(run, row.key),
  }
}

/** Who a plan names for a kind of step: its lead for the work and the settling, its reviewer for a review, none for publishing. */
const plannedFor = (run: RunRows, key: StepKey): PlannedStep | undefined => {
  switch (key) {
    case 'implement':
    case 'settle':
      return run.planned.find((one) => one.key === 'implement')
    case 'review':
      return run.planned.find((one) => one.key === 'review')
    case 'publish':
      return undefined
  }
}

const toCome = (run: RunRows, key: StepKey): GraphStep => {
  const planned = plannedFor(run, key)
  return {
    id: `${run.id}:${key}:0`,
    key,
    iteration: 0,
    state: 'next',
    hold: null,
    agentId: planned?.agentId ?? null,
    model: planned?.model ?? null,
    startedAt: null,
    endedAt: null,
    added: addedTo(run, key),
  }
}

/** What a run under way still has to come, by its plan: its work, its first review, its pull request, each not started yet. */
const stillToCome = (run: RunRows, had: ReadonlyArray<GraphStep>): ReadonlyArray<GraphStep> => {
  if (run.endedAt !== null) return []
  const has = (key: StepKey) => had.some((step) => step.key === key)
  const reviews = run.planned.some((one) => one.key === 'review' && !one.skipped)
  return [
    ...(has('implement') ? [] : [toCome(run, 'implement')]),
    ...(reviews && !has('review') ? [toCome(run, 'review')] : []),
    ...(run.publishes && !has('publish') ? [toCome(run, 'publish')] : []),
  ]
}

/** A task's rounds of work, oldest first, from its runs' rows. */
export const graphOf = (runs: ReadonlyArray<RunRows>): ReadonlyArray<GraphRound> =>
  runs.map((run) => {
    const had = run.steps.map((row) => stepOf(run, row))
    return {
      id: run.id,
      followUp: run.planId === null,
      createdAt: run.createdAt,
      endedAt: run.endedAt,
      said: run.said,
      changedAt: run.changedAt,
      steps: [...had, ...stillToCome(run, had)],
    }
  })
