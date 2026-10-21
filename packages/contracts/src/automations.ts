import { Schema } from 'effect'

import { Schedule } from './schedules'

/*
 * Automations as the window and the coordinator see them
 * (docs/plans/automations.md): a kept request and a schedule, the runs it
 * made, and where it stands. Each run is an ordinary task; the automation
 * only says when one starts.
 */

/** Who does a run's work, as a plan's step names them: an agent, its model (null for its own) and how hard it thinks. */
export const AutomationStep = Schema.Struct({
  agentId: Schema.String,
  model: Schema.NullOr(Schema.String),
  effort: Schema.optional(Schema.NullOr(Schema.String)),
})
export type AutomationStep = typeof AutomationStep.Type

/** What a run that makes a change ends in: a draft pull request, one ready for review, or nothing that leaves this computer (null). */
export const AutomationEnd = Schema.NullOr(Schema.Literals(['draft', 'ready']))
export type AutomationEnd = typeof AutomationEnd.Type

/** What each run does with what it asks. */
export const AutomationWork = Schema.Union([
  /** A task of its own, from the prompt: its lead, a reviewer or none, and what it ends in. */
  Schema.Struct({ kind: Schema.Literal('task'), review: Schema.NullOr(AutomationStep), end: AutomationEnd }),
  /**
   * A review of each pull request opened since its last run that came back
   * whole, by anyone but the person, and not reviewed by a task already: one
   * review task each, its review waiting for the person until they let this
   * automation's post themselves.
   */
  Schema.Struct({ kind: Schema.Literal('review') }),
])
export type AutomationWork = typeof AutomationWork.Type

/** How long a run may work, in minutes of its agents' work over all its steps. */
export const AutomationMinutes = Schema.Int.check(Schema.isBetween({ minimum: 5, maximum: 240 }))

/** What a time the computer slept through does: runs once on waking, within its window, or is skipped for the next. */
export const AutomationLate = Schema.Literals(['once', 'skip'])
export type AutomationLate = typeof AutomationLate.Type

/** What an automation is: everything a change to it changes. */
export const AutomationDefinition = Schema.Struct({
  /** A few words: "Morning review". */
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(60)),
  /** What each run is asked, as the person would say it to the coordinator. */
  prompt: Schema.String,
  schedule: Schedule,
  /** The zone it was made in, kept for later; its times come where the computer is. */
  zone: Schema.String,
  lead: AutomationStep,
  work: AutomationWork,
  /** Its task allows everything, so no ask stops a run, short of pushing to the default branch, which it never may. */
  allowEverything: Schema.Boolean,
  minutes: AutomationMinutes,
  late: AutomationLate,
})
export type AutomationDefinition = typeof AutomationDefinition.Type

/** The limits a new automation starts with. */
export const AUTOMATION_DEFAULTS = { allowEverything: true, minutes: 45, late: 'once' } as const

export const AutomationState = Schema.Literals(['proposed', 'on', 'paused', 'deleted'])
export type AutomationState = typeof AutomationState.Type

/**
 * One time it ran, or didn't. `subject` is what it ran on, where it has one
 * (a pull request it reviewed); `reason` says, in a sentence, what it found,
 * why it was skipped, missed or failed; `task` is the task it started.
 */
export const AutomationRun = Schema.Struct({
  id: Schema.String,
  cause: Schema.Literals(['schedule', 'now']),
  state: Schema.Literals(['starting', 'running', 'made', 'nothing', 'failed', 'missed', 'skipped']),
  /** When it was due: its slot's time, or when the person asked. */
  dueAt: Schema.String,
  /** When Althar started it, or found it skipped or missed. */
  at: Schema.String,
  subject: Schema.NullOr(Schema.String),
  reason: Schema.NullOr(Schema.String),
  task: Schema.NullOr(Schema.Struct({ id: Schema.String, threadId: Schema.String, title: Schema.String })),
})
export type AutomationRun = typeof AutomationRun.Type

/** An automation as its card on the Automations tab shows it. */
export const AutomationSummary = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  name: Schema.String,
  prompt: Schema.String,
  schedule: Schedule,
  work: Schema.Literals(['task', 'review']),
  state: AutomationState,
  pausedBy: Schema.NullOr(Schema.Literals(['person', 'itself'])),
  /** Why it paused itself, in a sentence. */
  pauseReason: Schema.NullOr(Schema.String),
  /** When it runs next, where it is on and nothing stops it; or, not turned on yet, when it would first. */
  nextAt: Schema.NullOr(Schema.String),
  /** Its latest runs, newest first: seven at most. */
  latest: Schema.Array(AutomationRun),
})
export type AutomationSummary = typeof AutomationSummary.Type

/** A project's automations, for the Automations tab. */
export const AutomationsSnapshot = Schema.Struct({
  cursor: Schema.Int,
  automations: Schema.Array(AutomationSummary),
  /** The person paused every automation: none starts until they resume them. */
  allPaused: Schema.Boolean,
})
export type AutomationsSnapshot = typeof AutomationsSnapshot.Type

/** One automation, for its own page: its card, its limits and its runs. */
export const AutomationView = Schema.Struct({
  ...AutomationSummary.fields,
  definition: AutomationDefinition,
  /** Its reviews post themselves, as the person said on its first one; an outside pull request's still waits. */
  postsReviews: Schema.Boolean,
  /** Its runs, newest first: the latest fifty. */
  runs: Schema.Array(AutomationRun),
  allPaused: Schema.Boolean,
})
export type AutomationView = typeof AutomationView.Type

export const AutomationSnapshot = Schema.Struct({ cursor: Schema.Int, automation: AutomationView })
export type AutomationSnapshot = typeof AutomationSnapshot.Type

/**
 * An automation's card in the coordinator's thread: as it proposed it, as it
 * changed it (with what it was), or asking the person to resume it or run it
 * now. Althar posts it and keeps it current: `state` and `nextAt` are the
 * automation's now, `definition` what the card shows.
 */
export const AutomationCard = Schema.Struct({
  automationId: Schema.String,
  definition: AutomationDefinition,
  /** What the coordinator changed it from, where it changed it. */
  was: Schema.NullOr(AutomationDefinition),
  /** What the coordinator asks of the person, where it asks: to resume it, or to run it now; `done` once they did. */
  ask: Schema.NullOr(Schema.Struct({ what: Schema.Literals(['resume', 'run']), done: Schema.Boolean })),
  state: AutomationState,
  nextAt: Schema.NullOr(Schema.String),
})
export type AutomationCard = typeof AutomationCard.Type

/** The automation a task's run came from, as its card says it. */
export const FromAutomation = Schema.Struct({ id: Schema.String, name: Schema.String })
export type FromAutomation = typeof FromAutomation.Type
