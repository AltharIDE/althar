import {
  type AutomationCard,
  type AutomationDefinition,
  type AutomationRun,
  type AutomationSummary,
  type AutomationView,
  scheduleInLine,
  timeWords,
} from '@althar/contracts'
import { ConnectorFailed, type ListedChange } from '@althar/connectors'
import { type ActorId, Ids, newId, type ProjectId } from '@althar/domain'
import type { Commands, Ledger } from '@althar/persistence-sqlite'
import { Context, type Crypto, Duration, Effect, Layer, Option, Queue, Schema, Semaphore } from 'effect'
import { SqlClient } from 'effect/sql'

import { definitionOf, partsOf } from './automated'
import { RuntimeConfig } from './Config'
import { Connections } from './Connections'
import { envelope } from './envelope'
import { NotFound } from './errors'
import { contained, keptGoing } from './Failures'
import { Instance } from './Instance'
import { Limits } from './Limits'
import { Plans } from './Plans'
import { Projects } from './Projects'
import { failureWords } from './pullRequestList'
import { change, fact, timestamp } from './records'
import { ReviewRefused, Reviews } from './Reviews'
import type { PlanStep } from './Runs'
import { instantOf, lastCome, localOf, localZone, nextToCome, type Slot, staggerOf, windowOf } from './slots'
import { Tasks } from './Tasks'
import { addItem, updateItem } from './threads'

/*
 * Automations (docs/plans/automations.md): work Althar starts by itself on a
 * schedule, on this computer, while Althar runs. An automation is a kept request
 * and a schedule; each time its schedule says, Althar keeps an occurrence,
 * once for each slot whoever reads the clock, and starts an ordinary task for
 * it: a task from its prompt, or a review of each new pull request. Nothing
 * here runs agents: it only decides when the tasks Althar knows how to run
 * start, and keeps how each went.
 *
 * A slot the computer slept through runs once when it wakes, within its window,
 * never as a backlog; one past its window is missed, and says so. A run
 * waits after the person's own work, one automation's task at a time
 * (`Busy.ts`), works at most its minutes, and three failures in a row pause
 * its automation, which says why. Its task allows everything where its
 * automation says, short of pushing to the default branch (`Permissions.ts`),
 * and what it posts is signed with its name.
 */

/** Runs a day, across every automation, at most: past that, a slot is skipped. */
export const RUNS_A_DAY = 24

/** An automation's pull requests open at once, at most, as Dependabot keeps its: past that, a run is skipped. */
export const OPEN_AT_ONCE = 5

/** Pull requests one run reviews at most: the rest wait for its next run. */
export const REVIEWS_A_RUN = 5

/** Listings of a repository's open pull requests one run reads back through, at most: past them, the oldest aren't looked at, and its run says so. */
const PAGES = 5

/** Failures in a row that pause an automation. */
export const FAILURES = 3

/** The setting every automation is paused by. */
const ALL_PAUSED = 'automations_paused'

/** A task's title at most, as every screen shows one. */
const TITLE_LENGTH = 60

/** How far past its time, and its stagger, a run counts as late: one the computer slept through, or Althar was closed for. */
const LATE = Duration.minutes(5)

/** A refusal in words the person or the coordinator reads: why an automation can't do that now. */
export class AutomationRefused extends Schema.TaggedError<AutomationRefused>()('AutomationRefused', { message: Schema.String }) {}

type Store =
  | SqlClient.SqlClient
  | Instance
  | Ledger
  | Crypto.Crypto
  | Commands
  | RuntimeConfig
  | Projects
  | Plans
  | Reviews
  | Tasks
  | Connections
  | Limits

/** An automation as its row and its current definition hold it. */
interface Row {
  readonly id: string
  readonly projectId: ProjectId
  readonly deviceId: string
  readonly state: 'proposed' | 'on' | 'paused' | 'deleted'
  readonly pausedBy: 'person' | 'itself' | null
  readonly pauseReason: string | null
  readonly definition: number
  readonly postsReviews: number
  readonly since: string | null
  readonly name: string
  readonly prompt: string
  readonly parts: string
}

/** An occurrence as the history reads it. */
interface OccurrenceRow {
  readonly id: string
  readonly cause: 'schedule' | 'now'
  readonly slot: string
  readonly subject: string
  readonly subjectTitle: string | null
  readonly state: AutomationRun['state']
  readonly reason: string | null
  readonly dueAt: string
  readonly firedAt: string
  readonly taskId: string | null
  readonly threadId: string | null
  readonly title: string | null
}

/** What an automation's run found to do: a pull request to review, as its listing gave it, and how a review names it. */
interface Subject {
  readonly key: string
  readonly url: string
  readonly title: string
  /** Its number, where the project's one repository on a host that reviews is where it is; else its link. */
  readonly named: string
}

/** A command id made from an occurrence's, so asking again for the same occurrence is the same command. */
const commandOf = (occurrenceId: string) => `cmd_${occurrenceId.slice(occurrenceId.indexOf('_') + 1)}`

/** A time of day where the computer is: 9:00. */
const clockOf = (at: number, zone: string) => timeWords(localOf(at, zone).slice(11))

/** A day as a title says it: 23 Oct. */
const dayOf = (at: number, zone: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: zone }).format(new Date(at))

/** A run's task's title: the automation's name and the day, cut at a word to the length a title has. */
export const titleOf = (name: string, at: number, zone: string) => {
  const day = dayOf(at, zone)
  const room = TITLE_LENGTH - day.length - 2
  const cut = name.length <= room ? name : `${name.slice(0, room - 1).replace(/\s+\S*$/, '')}…`
  return `${cut}, ${day}`
}

/**
 * What a run's lead is told beside the prompt: whose run it is, when it was
 * due and when it started, that nobody watches, and what it may do.
 */
export const briefOf = (definition: AutomationDefinition, due: number, at: number, zone: string) =>
  [
    definition.prompt.trim(),
    '---',
    `This is a run of the automation “${definition.name}”, which runs ${scheduleInLine(definition.schedule)} on the person's computer. It was due at ${clockOf(due, zone)}${at - due > Duration.toMillis(LATE) ? `; it is ${clockOf(at, zone)}, since the computer was asleep or Althar was closed` : ''}.`,
    definition.allowEverything
      ? 'Nobody is watching it run: decide what you can yourself rather than asking. Its task allows everything but pushing to the default branch, which is never allowed.'
      : 'Nobody is watching it run: decide what you can yourself rather than asking, since what you ask waits for the person. Pushing to the default branch is never allowed.',
    'If there is nothing to do, say so in your report and change nothing.',
  ].join('\n\n')

/** Whether a change to a definition reaches further than before, so it needs the person to turn it on again: anything but a shorter time. */
export const widens = (before: AutomationDefinition, after: AutomationDefinition) => {
  const { minutes: was, ...rest } = before
  const { minutes: now, ...next } = after
  return now > was || JSON.stringify(rest) !== JSON.stringify(next)
}

/** Where a run's outcome leaves its slot, of the occurrences that slot has: made something where any did, failed only where all did. */
const slotOutcome = (states: ReadonlyArray<AutomationRun['state']>): 'made' | 'nothing' | 'failed' | null => {
  const ended = states.filter((state) => state === 'made' || state === 'nothing' || state === 'failed')
  if (ended.length === 0 || ended.length < states.filter((state) => state !== 'skipped' && state !== 'missed').length) return null
  if (ended.includes('made')) return 'made'
  if (ended.every((state) => state === 'failed')) return 'failed'
  return 'nothing'
}

export class Automations extends Context.Service<
  Automations,
  {
    /** Makes an automation on this computer: proposed, waiting for the person to turn it on, unless `on`. Its id. */
    make(input: {
      readonly projectId: string
      readonly definition: AutomationDefinition
      readonly on?: boolean
      readonly actorId: ActorId
    }): Effect.Effect<string, unknown>
    /**
     * The coordinator proposes an automation in its thread: made, proposed,
     * with its card there for the person to turn on.
     */
    propose(input: {
      readonly projectId: ProjectId
      readonly threadId: string
      readonly definition: AutomationDefinition
      readonly actorId: ActorId
    }): Effect.Effect<string, unknown>
    /** The person changes an automation: it holds from its next run, and stays on where it is. */
    change(automationId: string, definition: AutomationDefinition, actorId: ActorId): Effect.Effect<void, unknown>
    /**
     * The coordinator changes an automation, its card saying what it was: a
     * change that reaches further needs the person to turn it on again.
     * Whether it does.
     */
    changeFor(input: {
      readonly automationId: string
      readonly threadId: string
      readonly definition: AutomationDefinition
      readonly actorId: ActorId
    }): Effect.Effect<{ readonly again: boolean }, unknown>
    /** Turns an automation on, or back on: no slot before now counts. `itemId`, the card it was asked on. */
    turnOn(automationId: string, actorId: ActorId, itemId?: string): Effect.Effect<void, unknown>
    /** Pauses an automation: nothing of it starts until it is turned on again. A run under way finishes. */
    pause(automationId: string, actorId: ActorId): Effect.Effect<void, unknown>
    /** Runs an automation once now, with every limit a run has, whether it is on or not yet. */
    runNow(automationId: string, actorId: ActorId, itemId?: string): Effect.Effect<void, unknown>
    /** Deletes an automation: nothing of it starts again; the tasks its runs made stay. */
    remove(automationId: string, actorId: ActorId): Effect.Effect<void, unknown>
    /** Puts back what the coordinator changed an automation from, as its card shows it. */
    undo(itemId: string, actorId: ActorId): Effect.Effect<void, unknown>
    /** Whether an automation's reviews post themselves once drafted. */
    setPostsReviews(automationId: string, on: boolean, actorId: ActorId): Effect.Effect<void, unknown>
    /** The coordinator asks the person to resume an automation, or run it now: a small card in its thread. */
    ask(input: { readonly automationId: string; readonly threadId: string; readonly what: 'resume' | 'run' }): Effect.Effect<void, unknown>
    /** Whether every automation is paused. */
    readonly allPaused: Effect.Effect<boolean, unknown>
    /** Pauses every automation, or lets them run again. */
    setAllPaused(paused: boolean): Effect.Effect<void, unknown>
    /** A project's automations, for its Automations tab. */
    list(projectId: string): Effect.Effect<ReadonlyArray<AutomationSummary>, unknown>
    /** One automation, for its page. */
    read(automationId: string): Effect.Effect<AutomationView, unknown>
    /** An automation by its id or its name in a project, as the coordinator names one. */
    find(projectId: string, named: string): Effect.Effect<AutomationView, unknown>
  }
>()('@althar/runtime/Automations') {
  static readonly layer: Layer.Layer<Automations, never, Store> = Layer.effect(
    Automations,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const provide = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)
      const instance = yield* Instance
      const projects = yield* Projects
      const plans = yield* Plans
      const reviews = yield* Reviews
      const tasks = yield* Tasks
      const connections = yield* Connections
      const limits = yield* Limits
      const options = (yield* RuntimeConfig).automations ?? {}
      const nowOf = options.now ?? (() => Date.now())
      const zoneOf = options.zone ?? localZone
      const tick = Duration.toMillis(options.tick ?? Duration.seconds(30))
      const settle = Duration.toMillis(options.settle ?? Duration.minutes(2))
      const staggered = options.stagger ?? true
      const listedAtOnce = options.listed ?? 100
      /**
       * Starting a run, from its limits checked to its task under way, one at
       * a time: a slot that came, Run now pressed in two windows, and a run
       * picked up after a restart never both pass the limits before either
       * is kept. One runtime holds the store.
       */
      const admitting = Semaphore.makeUnsafe(1)
      const admitted = <A, E, R>(effect: Effect.Effect<A, E, R>) => admitting.withPermits(1)(effect)
      /** Wakes the clock when an automation changes. */
      const wake = yield* Queue.sliding<void>(1)
      /** Now, for an automation's rows: the clock its schedule is read by, so what was turned on and what came compare. */
      const stamp = Effect.sync(() => new Date(nowOf()).toISOString())

      const refused = (message: string) => new AutomationRefused({ message })

      const load = (automationId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [row] = yield* sql<Row>`
            SELECT a.id, a.project_id, a.device_id, a.state, a.paused_by, a.pause_reason, a.definition, a.posts_reviews, a.since,
              d.name, d.prompt, d.parts
            FROM automations a JOIN automation_definitions d ON d.automation_id = a.id AND d.number = a.definition
            JOIN projects p ON p.id = a.project_id AND p.archived_at IS NULL
            WHERE a.id = ${automationId} AND a.state <> 'deleted'`
          return row === undefined ? yield* new NotFound({ kind: 'automation', id: automationId }) : row
        })

      const definitionIn = (row: Row) =>
        Option.match(definitionOf(row), {
          onNone: () => Effect.fail(refused(`“${row.name}” can't be read; make it again.`)),
          onSome: Effect.succeed,
        })

      const allPaused = Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const [row] = yield* sql<{ value: string }>`SELECT value FROM settings WHERE key = ${ALL_PAUSED}`
        return row?.value === 'on'
      })

      /** When it runs next: its next slot's time and stagger, where it is on and nothing stops it; or, proposed, when it would first. */
      const nextAtOf = (row: Row, definition: AutomationDefinition, paused: boolean) => {
        if ((row.state !== 'on' && row.state !== 'proposed') || paused) return null
        const at = nowOf()
        const stagger = staggered ? staggerOf(row.id) : 0
        return new Date(instantOf(nextToCome(definition.schedule, at, zoneOf(), stagger), zoneOf()) + stagger).toISOString()
      }

      /* ---- Cards in the coordinator's thread ---- */

      /** An automation's cards, rewritten with where it stands now; one showing a change keeps it, and each what it asked. */
      const refreshCards = (automationId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const items = yield* sql<{ id: string; projectId: ProjectId; content: string }>`
            SELECT id, project_id, content FROM thread_items WHERE kind = 'automation' AND json_extract(content, '$.automationId') = ${automationId}`
          if (items.length === 0) return
          const [row] = yield* sql<Row>`
            SELECT a.id, a.project_id, a.device_id, a.state, a.paused_by, a.pause_reason, a.definition, a.posts_reviews, a.since,
              d.name, d.prompt, d.parts
            FROM automations a JOIN automation_definitions d ON d.automation_id = a.id AND d.number = a.definition
            WHERE a.id = ${automationId}`
          if (row === undefined) return
          const definition = Option.getOrNull(definitionOf(row))
          const paused = yield* allPaused
          for (const item of items) {
            const content = JSON.parse(item.content) as AutomationCard & Record<string, unknown>
            yield* updateItem(item.projectId, item.id, {
              ...content,
              // A card showing what the coordinator changed keeps it; any other shows the automation as it is now.
              ...(content.was === null && definition !== null ? { definition } : {}),
              state: row.state,
              nextAt: definition === null ? null : nextAtOf(row, definition, paused),
            })
          }
        })

      const cardIn = (input: {
        readonly projectId: ProjectId
        readonly threadId: string
        readonly automationId: string
        readonly definition: AutomationDefinition
        readonly was?: AutomationDefinition
        readonly wasState?: Row['state']
        readonly ask?: 'resume' | 'run'
      }) =>
        addItem({ projectId: input.projectId, threadId: input.threadId }, 'automation', {
          automationId: input.automationId,
          definition: input.definition,
          was: input.was ?? null,
          ask: input.ask === undefined ? null : { what: input.ask, done: false },
          state: 'proposed',
          nextAt: null,
          // What it stood at before the coordinator's change, for Undo; the window doesn't read it.
          ...(input.wasState === undefined ? {} : { wasState: input.wasState }),
        })

      /** Marks the card the person answered as done. */
      const answered = (itemId: string | undefined) =>
        Effect.gen(function* () {
          if (itemId === undefined) return
          const sql = yield* SqlClient.SqlClient
          const [item] = yield* sql<{ projectId: ProjectId; content: string }>`
            SELECT project_id, content FROM thread_items WHERE id = ${itemId} AND kind = 'automation'`
          if (item === undefined) return
          const content = JSON.parse(item.content) as Record<string, unknown> & { ask: AutomationCard['ask'] }
          if (content.ask === null) return
          yield* updateItem(item.projectId, itemId, { ...content, ask: { ...content.ask, done: true } })
        })

      /* ---- Making and changing ---- */

      /** Writes a new definition and makes it the automation's, with how it now stands. */
      const define = (
        row: Row,
        definition: AutomationDefinition,
        actorId: ActorId,
        type: string,
        set: Readonly<Record<string, unknown>> = {},
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const at = yield* stamp
          const number = row.definition + 1
          yield* sql.withTransaction(
            Effect.gen(function* () {
              yield* sql`INSERT INTO automation_definitions ${sql.insert({
                automationId: row.id,
                projectId: row.projectId,
                number,
                name: definition.name,
                prompt: definition.prompt,
                parts: partsOf(definition),
                madeByActorId: actorId,
                madeAt: at,
              })}`
              const revision = yield* change('automations', row.id, { definition: number, updatedAt: at, ...set })
              yield* fact({
                projectId: row.projectId,
                aggregateType: 'automation',
                aggregateId: row.id,
                revision,
                type,
                payload: { definition: number, ...set },
                actorId,
              })
            }),
          )
          yield* refreshCards(row.id)
          yield* Queue.offer(wake, undefined)
        })

      const make = (input: {
        readonly projectId: string
        readonly definition: AutomationDefinition
        readonly on?: boolean
        readonly actorId: ActorId
      }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [project] = yield* sql<{ id: ProjectId }>`SELECT id FROM projects WHERE id = ${input.projectId} AND archived_at IS NULL`
          if (project === undefined) return yield* new NotFound({ kind: 'project', id: input.projectId })
          const automationId = yield* newId(Ids.automation)
          const at = yield* stamp
          const on = input.on === true
          yield* sql.withTransaction(
            Effect.gen(function* () {
              yield* sql`INSERT INTO automations ${sql.insert({
                id: automationId,
                projectId: project.id,
                deviceId: instance.deviceId,
                state: on ? 'on' : 'proposed',
                definition: 1,
                since: on ? at : null,
                madeByActorId: input.actorId,
                createdAt: at,
                updatedAt: at,
              })}`
              yield* sql`INSERT INTO automation_definitions ${sql.insert({
                automationId,
                projectId: project.id,
                number: 1,
                name: input.definition.name,
                prompt: input.definition.prompt,
                parts: partsOf(input.definition),
                madeByActorId: input.actorId,
                madeAt: at,
              })}`
              yield* fact({
                projectId: project.id,
                aggregateType: 'automation',
                aggregateId: automationId,
                revision: 1,
                type: 'automation.made',
                payload: { name: input.definition.name, on },
                actorId: input.actorId,
              })
            }),
          )
          yield* Queue.offer(wake, undefined)
          return automationId
        })

      /** Moves an automation to where it stands now, if it still stands as `when` needs. */
      const stand = (
        automationId: string,
        when: (row: Row) => boolean,
        set: Readonly<Record<string, unknown>>,
        type: string,
        actorId: ActorId,
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const moved = yield* sql.withTransaction(
            Effect.gen(function* () {
              const row = yield* load(automationId)
              if (!when(row)) return false
              const revision = yield* change('automations', automationId, { ...set, updatedAt: yield* stamp })
              yield* fact({ projectId: row.projectId, aggregateType: 'automation', aggregateId: automationId, revision, type, actorId })
              return true
            }),
          )
          if (!moved) return false
          yield* refreshCards(automationId)
          yield* Queue.offer(wake, undefined)
          return true
        })

      const turnOn = (automationId: string, actorId: ActorId, itemId?: string) =>
        Effect.gen(function* () {
          yield* stand(
            automationId,
            (row) => row.state !== 'on',
            { state: 'on', since: yield* stamp, pausedBy: null, pauseReason: null },
            'automation.turned_on',
            actorId,
          )
          yield* answered(itemId)
        })

      const pauseBy = (automationId: string, actorId: ActorId, by: 'person' | 'itself', reason: string | null) =>
        stand(
          automationId,
          (row) => row.state === 'on' || (row.state === 'paused' && by === 'person'),
          { state: 'paused', pausedBy: by, pauseReason: by === 'itself' ? reason : null },
          by === 'itself' ? 'automation.paused_itself' : 'automation.paused',
          actorId,
        )

      /* ---- Running ---- */

      /**
       * Why a run's lead or reviewer can't run unwatched: none of its accounts
       * is on a plan, as its agent's status says; null where one is. Each
       * session of the run is held to the same (`Limits.pick`).
       */
      const offPlan = (agentId: string, projectId: string) =>
        limits.pick({ agentId, projectId, planOnly: true }).pipe(
          Effect.as(null),
          Effect.catchTag('PlanOnly', (error) => Effect.succeed(error.message)),
          // An agent with no account at all is the run's to fail on, where its thread says why.
          Effect.catchTag('NotFound', () => Effect.succeed(null)),
        )

      /** Why a run can't start now, in a sentence; null where it can. */
      const blocked = (row: Row, definition: AutomationDefinition, cause: 'schedule' | 'now') =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [going] = yield* sql<{ one: number }>`
            SELECT 1 AS one FROM automation_occurrences WHERE automation_id = ${row.id} AND state IN ('starting', 'running') LIMIT 1`
          if (going !== undefined) return 'Its last run was still going.'
          if (cause === 'schedule' && (yield* allPaused)) return 'Every automation was paused.'
          if (definition.work.kind === 'task' && definition.work.end !== null) {
            const [open] = yield* sql<{ count: number }>`
              SELECT count(DISTINCT x.id) AS count FROM automation_occurrences o
              JOIN tasks k ON k.id = o.task_id JOIN external_links x ON x.task_id = k.id AND x.kind = 'change'
              WHERE o.automation_id = ${row.id} AND k.state = 'open' AND json_extract(x.snapshot, '$.state') = 'open'`
            if ((open?.count ?? 0) >= OPEN_AT_ONCE) return `${OPEN_AT_ONCE} of its pull requests were open.`
          }
          const midnight = new Date(instantOf(`${localOf(nowOf(), zoneOf()).slice(0, 10)}T00:00`, zoneOf())).toISOString()
          const [today] = yield* sql<{ count: number }>`
            SELECT count(*) AS count FROM automation_occurrences
            WHERE subject = '' AND fired_at >= ${midnight} AND state NOT IN ('skipped', 'missed')`
          if ((today?.count ?? 0) >= RUNS_A_DAY) return `Automations had run ${RUNS_A_DAY} times today.`
          for (const step of [
            definition.lead,
            ...(definition.work.kind === 'task' && definition.work.review !== null ? [definition.work.review] : []),
          ]) {
            const why = yield* offPlan(step.agentId, row.projectId)
            if (why !== null) return why
          }
          return null
        })

      /** Ends an occurrence: how it went, and why, in a sentence. */
      const end = (occurrenceId: string, state: 'made' | 'nothing' | 'failed' | 'skipped' | 'missed', reason: string | null) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const ended = yield* sql.withTransaction(
            Effect.gen(function* () {
              const [row] = yield* sql<{ projectId: ProjectId; automationId: string; state: string }>`
                SELECT project_id, automation_id, state FROM automation_occurrences WHERE id = ${occurrenceId}`
              if (row === undefined || (row.state !== 'starting' && row.state !== 'running')) return undefined
              const revision = yield* change('automation_occurrences', occurrenceId, { state, reason, endedAt: yield* stamp })
              yield* fact({
                projectId: row.projectId,
                aggregateType: 'automation_occurrence',
                aggregateId: occurrenceId,
                revision,
                type: 'automation_occurrence.ended',
                payload: { state },
                actorId: instance.systemId,
              })
              return row.automationId
            }),
          )
          if (ended !== undefined && state === 'failed') yield* pauseIfFailing(ended)
        })

      /** Three failures in a row pause it, saying why; made something or nothing to do ends the streak, skipped and missed leave it. */
      const pauseIfFailing = (automationId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const rows = yield* sql<{ slot: string; subject: string; state: AutomationRun['state']; reason: string | null }>`
            SELECT slot, subject, state, reason FROM automation_occurrences WHERE automation_id = ${automationId}
            ORDER BY fired_at DESC, rowid DESC LIMIT 60`
          // A slot that found pull requests goes by its reviews, not by the listing that found them.
          const slots = new Map<string, Array<{ readonly subject: string; readonly state: AutomationRun['state'] }>>()
          for (const row of rows) slots.set(row.slot, [...(slots.get(row.slot) ?? []), row])
          const outcomes = [...slots.values()]
            .map((all) => {
              const subjects = all.filter((one) => one.subject !== '')
              return slotOutcome((subjects.length > 0 ? subjects : all).map((one) => one.state))
            })
            .filter((outcome) => outcome !== null)
          if (outcomes.length < FAILURES || !outcomes.slice(0, FAILURES).every((outcome) => outcome === 'failed')) return
          const last = rows.find((row) => row.state === 'failed')?.reason
          yield* pauseBy(
            automationId,
            instance.systemId,
            'itself',
            `Its last ${FAILURES} runs failed${last === null || last === undefined ? '.' : `. The last: ${last}`}`,
          )
        })

      /** Records an occurrence, unless its slot and subject have one already: the store refuses a second. Its id, or null. */
      const record = (input: {
        readonly row: Row
        readonly cause: 'schedule' | 'now'
        readonly slot: string
        readonly subject?: Subject
        readonly dueAt: number
        readonly state: 'starting' | 'skipped' | 'missed'
        readonly reason?: string | null
        readonly id?: string
      }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const id = input.id ?? (yield* newId(Ids.automationOccurrence))
          const at = yield* stamp
          const ended = input.state !== 'starting'
          return yield* sql.withTransaction(
            Effect.gen(function* () {
              const [taken] = yield* sql<{ id: string }>`
                SELECT id FROM automation_occurrences
                WHERE automation_id = ${input.row.id} AND slot = ${input.slot} AND subject = ${input.subject?.key ?? ''}`
              if (taken !== undefined) return null
              yield* sql`INSERT INTO automation_occurrences ${sql.insert({
                id,
                projectId: input.row.projectId,
                automationId: input.row.id,
                definition: input.row.definition,
                cause: input.cause,
                slot: input.slot,
                subject: input.subject?.key ?? '',
                subjectTitle: input.subject?.title ?? null,
                state: input.state,
                reason: input.reason ?? null,
                dueAt: new Date(input.dueAt).toISOString(),
                firedAt: at,
                endedAt: ended ? at : null,
              })}`
              yield* fact({
                projectId: input.row.projectId,
                aggregateType: 'automation_occurrence',
                aggregateId: id,
                revision: 1,
                type: `automation_occurrence.${input.state === 'starting' ? 'fired' : input.state}`,
                payload: {
                  automationId: input.row.id,
                  slot: input.slot,
                  ...(input.subject === undefined ? {} : { subject: input.subject.key }),
                },
                actorId: instance.systemId,
              })
              return id
            }),
          )
        })

      /** A run's lead and reviewer as its plan names them. */
      const stepsOf = (definition: AutomationDefinition): ReadonlyArray<PlanStep> => {
        const step = (key: PlanStep['key'], one: AutomationDefinition['lead']): PlanStep => ({
          key,
          agentId: one.agentId,
          model: one.model,
          ...(one.effort === undefined || one.effort === null ? {} : { effort: one.effort }),
          skipped: false,
        })
        return [
          step('implement', definition.lead),
          ...(definition.work.kind === 'task' && definition.work.review !== null ? [step('review', definition.work.review)] : []),
        ]
      }

      /** Starts a task from the prompt for an occurrence: drafted, its plan held, then started, so it waits its place. */
      const startTask = (row: Row, definition: AutomationDefinition, occurrenceId: string, due: number) =>
        Effect.gen(function* () {
          if (definition.work.kind !== 'task') return
          const at = nowOf()
          const created = yield* projects.createTask({
            envelope: yield* envelope('task.create', { occurrence: occurrenceId }, commandOf(occurrenceId), instance.systemId),
            projectId: row.projectId,
            title: titleOf(definition.name, due, zoneOf()),
            description: briefOf(definition, due, at, zoneOf()),
            draft: true,
            request: definition.prompt,
            ...(definition.work.end === null ? { plain: true } : {}),
            occurrence: occurrenceId,
          })
          yield* planned(row.projectId, created.taskId, definition)
        })

      /**
       * A run's task, planned and started: once, however often it is asked.
       * One whose plan was kept, held, but Althar stopped before it started,
       * or before its run was made, starts that plan.
       */
      const planned = (projectId: ProjectId, taskId: string, definition: AutomationDefinition) =>
        Effect.gen(function* () {
          if (definition.work.kind !== 'task') return
          const sql = yield* SqlClient.SqlClient
          const [task] = yield* sql<{ state: string; planId: string | null; planState: string | null }>`
            SELECT k.state, p.id AS plan_id, p.state AS plan_state FROM tasks k
            LEFT JOIN task_plans p ON p.id = (SELECT id FROM task_plans WHERE task_id = k.id ORDER BY proposed_at DESC, rowid DESC LIMIT 1)
            WHERE k.id = ${taskId}`
          if (task === undefined || task.state !== 'draft') return
          if (task.planId !== null) {
            if (task.planState === 'proposed' || task.planState === 'accepted') yield* plans.start(task.planId, instance.systemId)
            return
          }
          const planId = yield* plans.propose({
            projectId,
            taskId,
            steps: stepsOf(definition),
            reason: null,
            actorId: instance.systemId,
            end: definition.work.end,
            held: true,
            ...(definition.work.end === null ? { here: true } : {}),
          })
          yield* plans.start(planId, instance.systemId)
        })

      /**
       * The pull requests a review automation's run reviews: each open one
       * ready for review in the project's repositories, by anyone but the
       * person, that no task of Althar's reviews or reviewed, and this
       * automation hasn't had before; the oldest first, a few a run. A
       * listing that has more reads on from the last it gave, a few times;
       * a repository it couldn't read to its end is said, as is what stopped
       * one being listed.
       */
      const subjectsOf = (
        row: Row,
      ): Effect.Effect<
        | { readonly failed: string }
        | {
            readonly subjects: ReadonlyArray<Subject>
            readonly left: number
            readonly failed: ReadonlyArray<string>
            /** The repositories whose oldest open pull requests weren't looked at, with how many were. */
            readonly short: ReadonlyArray<{ readonly name: string; readonly read: number }>
          },
        unknown,
        Store
      > =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const bindings = yield* sql<{ name: string; remotes: string }>`
            SELECT display_name AS name, remote_fingerprints AS remotes FROM repository_bindings
            WHERE project_id = ${row.projectId} AND detached_at IS NULL ORDER BY created_at, rowid`
          const known = new Set(
            (yield* sql<{ url: string }>`
              SELECT lower(url) AS url FROM external_links WHERE project_id = ${row.projectId} AND kind IN ('review', 'change')`).map(
              (link) => link.url,
            ),
          )
          const had = new Set(
            (yield* sql<{ subject: string }>`
              SELECT DISTINCT subject FROM automation_occurrences WHERE automation_id = ${row.id} AND subject <> ''`).map(
              (one) => one.subject,
            ),
          )
          const found: Array<Omit<Subject, 'named'> & { readonly number: number; readonly updatedAt: string }> = []
          const failed: Array<string> = []
          const short: Array<{ readonly name: string; readonly read: number }> = []
          let reviewable = 0
          for (const binding of bindings) {
            const remotes = Option.getOrElse(
              Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Schema.String)))(binding.remotes),
              () => [],
            )
            const place = yield* connections.hostOf(remotes)
            if (place === null || !place.host.capabilities.reviews) continue
            reviewable += 1
            const listed = yield* Effect.gen(function* () {
              const me = (yield* connections.adapters(place.connectionId)).info.account.login.toLowerCase()
              const repository = yield* place.host.repository(place.path)
              // Newest first: each listing after the first goes on from the last the one before gave.
              const read = new Map<string, ListedChange>()
              let whole = false
              let until: string | undefined
              for (let page = 0; page < PAGES && !whole; page += 1) {
                const list = yield* place.host.listChanges(repository, {
                  state: 'open',
                  draft: false,
                  limit: listedAtOnce,
                  ...(until === undefined ? {} : { updatedUntil: until }),
                })
                const before = read.size
                for (const one of list.changes) read.set(one.id, one)
                // All of them, or a listing that brought nothing new, as from a host that can't read on.
                if (!list.more) whole = true
                else if (read.size === before) break
                until = list.changes.at(-1)?.updatedAt
              }
              if (!whole) short.push({ name: binding.name, read: read.size })
              return [...read.values()].filter((one) => one.author !== null && one.author.login.toLowerCase() !== me)
            }).pipe(
              Effect.catch((error) =>
                Effect.succeed(
                  error instanceof ConnectorFailed ? failureWords(error, place.host.words.noun) : `${binding.name} couldn't be listed.`,
                ),
              ),
            )
            if (typeof listed === 'string') {
              failed.push(listed)
              continue
            }
            for (const one of listed) {
              const key = `${place.connectionId}:${one.id}`
              if (known.has(one.url.toLowerCase()) || had.has(key)) continue
              found.push({
                key,
                url: one.url,
                number: one.number,
                title: `${place.host.words.prefix}${one.number} ${one.title}`,
                updatedAt: one.updatedAt,
              })
            }
          }
          if (reviewable === 0) return { failed: 'None of the project’s repositories is on GitHub, where Althar reviews pull requests.' }
          if (found.length === 0 && failed.length > 0) return { failed: failed.join(' ') }
          const oldest = found
            .toSorted((a, b) => a.updatedAt.localeCompare(b.updatedAt))
            .map(({ number, updatedAt: _updatedAt, ...one }) => ({ ...one, named: reviewable === 1 ? `#${number}` : one.url }))
          return { subjects: oldest.slice(0, REVIEWS_A_RUN), left: Math.max(0, oldest.length - REVIEWS_A_RUN), failed, short }
        })

      /** What a run says of the repositories it couldn't read to their end: their oldest open pull requests weren't looked at. */
      const shortWords = (short: ReadonlyArray<{ readonly name: string; readonly read: number }>) =>
        short.map((one) => ` Only the ${one.read} latest open pull requests of ${one.name} were looked at; older ones weren’t.`).join('')

      /** Starts a review of each new pull request for an occurrence, an occurrence each; the slot's says what it found. */
      const startReviews = (
        row: Row,
        definition: AutomationDefinition,
        occurrenceId: string,
        cause: 'schedule' | 'now',
        slot: string,
        due: number,
      ) =>
        Effect.gen(function* () {
          const listed = yield* subjectsOf(row)
          if (!('subjects' in listed)) return yield* end(occurrenceId, 'failed', listed.failed)
          if (listed.subjects.length === 0)
            return yield* end(
              occurrenceId,
              'nothing',
              listed.short.length === 0
                ? 'No new pull requests to review.'
                : `No new pull requests among those looked at.${shortWords(listed.short)}`,
            )
          // Its reviews say what it found; the slot says only what they don't: those left for later, and what it couldn't read.
          const count = listed.subjects.length
          yield* end(
            occurrenceId,
            'made',
            listed.left === 0 && listed.short.length === 0
              ? null
              : `Found ${count} new pull request${count === 1 ? '' : 's'}${listed.left > 0 ? `; ${listed.left} more wait for its next run` : ''}.${shortWords(listed.short)}`,
          )
          for (const subject of listed.subjects) {
            const id = yield* record({ row, cause, slot, subject, dueAt: due, state: 'starting' })
            if (id === null) continue
            yield* startReview(row, definition, id, subject).pipe(
              Effect.catch((error) => end(id, 'failed', error instanceof AutomationRefused ? error.message : 'Its review couldn’t start.')),
            )
          }
        })

      /** Starts the review of one pull request for its occurrence. */
      const startReview = (row: Row, definition: AutomationDefinition, occurrenceId: string, subject: Subject) =>
        Effect.gen(function* () {
          const started = yield* reviews
            .start({
              envelope: yield* envelope('task.review', { occurrence: occurrenceId }, commandOf(occurrenceId), instance.systemId),
              projectId: row.projectId,
              pullRequest: subject.named,
              lead: {
                agentId: definition.lead.agentId,
                model: definition.lead.model,
                ...(definition.lead.effort === undefined || definition.lead.effort === null ? {} : { effort: definition.lead.effort }),
              },
              request: definition.prompt,
              occurrence: occurrenceId,
            })
            .pipe(Effect.mapError((error) => (error instanceof ReviewRefused ? refused(error.message) : error)))
          if (started.already) return yield* end(occurrenceId, 'skipped', 'A task reviews it already.')
          if (!started.leading) return yield* end(occurrenceId, 'failed', 'Its lead couldn’t start; its task’s thread says why.')
        })

      /**
       * Fires an occurrence of a slot: recorded once, skipped where something
       * stops it, else its work started. `refuse` says why it can't, to the
       * person who asked, rather than recording a skip.
       */
      const fire = (row: Row, definition: AutomationDefinition, cause: 'schedule' | 'now', slot: string | null, due: number) =>
        admitted(
          Effect.gen(function* () {
            const why = yield* blocked(row, definition, cause)
            if (why !== null && cause === 'now') return yield* refused(why)
            const id = yield* newId(Ids.automationOccurrence)
            const at = slot ?? `now:${id}`
            const recorded = yield* record({
              row,
              cause,
              slot: at,
              dueAt: due,
              state: why === null ? 'starting' : 'skipped',
              reason: why,
              id,
            })
            if (recorded === null || why !== null) return
            yield* work(row, definition, id, cause, at, due)
            // Its cards' next time has moved on.
            yield* refreshCards(row.id)
          }),
        )

      /** An occurrence's work, started; where it fails, the occurrence says why. */
      const work = (
        row: Row,
        definition: AutomationDefinition,
        occurrenceId: string,
        cause: 'schedule' | 'now',
        slot: string,
        due: number,
      ) =>
        (definition.work.kind === 'review'
          ? startReviews(row, definition, occurrenceId, cause, slot, due)
          : startTask(row, definition, occurrenceId, due)
        ).pipe(
          contained('Automations.start', () => 'failed' as const),
          Effect.flatMap((outcome) =>
            outcome === 'failed' ? end(occurrenceId, 'failed', 'Althar couldn’t start its task.') : Effect.void,
          ),
        )

      const runNow = (automationId: string, _actorId: ActorId, itemId?: string) =>
        Effect.gen(function* () {
          const row = yield* load(automationId)
          const definition = yield* definitionIn(row)
          yield* fire(row, definition, 'now', null, nowOf())
          yield* answered(itemId)
          yield* refreshCards(automationId)
        })

      /* ---- The clock ---- */

      /** When the clock last looked, to tell a computer that slept; and until when a run that came while it did waits. */
      let lookedAt = nowOf()
      let settledAt = nowOf() + settle

      /**
       * Looks at every automation on, on this computer: a slot that came starts,
       * once; one the computer slept through starts once it has settled, if its
       * window is still open, or is missed. When the clock should look again.
       */
      const look = Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const at = nowOf()
        // Asleep, the clock didn't look: what came meanwhile waits for the computer to settle.
        if (at - lookedAt > 3 * tick + 60_000) settledAt = at + settle
        lookedAt = at
        const zone = zoneOf()
        const rows = yield* sql<Row>`
          SELECT a.id, a.project_id, a.device_id, a.state, a.paused_by, a.pause_reason, a.definition, a.posts_reviews, a.since,
            d.name, d.prompt, d.parts
          FROM automations a JOIN automation_definitions d ON d.automation_id = a.id AND d.number = a.definition
          JOIN projects p ON p.id = a.project_id AND p.archived_at IS NULL
          WHERE a.state = 'on' AND a.device_id = ${instance.deviceId}
          ORDER BY a.created_at, a.rowid`
        let next = at + tick
        for (const row of rows) {
          const due = yield* Effect.gen(function* () {
            const definition = Option.getOrUndefined(definitionOf(row))
            if (definition === undefined || row.since === null) return at + tick
            const stagger = staggered ? staggerOf(row.id) : 0
            const slot: Slot = lastCome(definition.schedule, at, zone, stagger)
            const time = instantOf(slot, zone)
            const coming = instantOf(nextToCome(definition.schedule, at, zone, stagger), zone) + stagger
            if (time < Date.parse(row.since)) return coming
            const [had] = yield* sql<{ one: number }>`
              SELECT 1 AS one FROM automation_occurrences WHERE automation_id = ${row.id} AND slot = ${slot} AND subject = ''`
            if (had !== undefined) return coming
            const late = at - (time + stagger) > Duration.toMillis(LATE)
            if (at > time + windowOf(definition.schedule, slot, zone) || (late && definition.late === 'skip')) {
              yield* record({
                row,
                cause: 'schedule',
                slot,
                dueAt: time,
                state: 'missed',
                reason: `Missed: the computer was asleep, or Althar closed, at ${clockOf(time, zone)}.`,
              })
              return coming
            }
            // Come while the computer slept: it waits for the computer to settle, then runs once.
            if (late && at < settledAt) return settledAt
            yield* fire(row, definition, 'schedule', slot, time)
            return coming
          }).pipe(contained('Automations.look', () => at + tick))
          next = Math.min(next, due)
        }
        return next
      })

      /**
       * Looks at every run under way: one whose task ended says how it went;
       * one that has worked its minutes is stopped. A run of the review kind
       * made something once its review is drafted, and failed where its lead
       * went before drafting one: stopped, gone, or its last turn failed or
       * was stopped from the composer, with nothing since for as long as the
       * run may work. Nothing else would finish it, since a review has no run
       * of steps.
       */
      const watch = Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        // Turns are stamped by the runtime's own clock, so how long a run worked is read by it too.
        const at = yield* timestamp
        const running = yield* sql<{
          id: string
          automationId: string
          taskId: string
          taskState: string
          runState: string | null
          drafts: number
          reviewing: number
          leadState: string | null
          turnState: string | null
          turnEnded: number | null
          queued: number
          worked: number | null
          parts: string
          name: string
          prompt: string
        }>`
          SELECT o.id, o.automation_id, o.task_id, k.state AS task_state,
            (SELECT r.state FROM runs r WHERE r.task_id = k.id ORDER BY r.created_at DESC, r.rowid DESC LIMIT 1) AS run_state,
            (SELECT count(*) FROM review_drafts d WHERE d.task_id = k.id) AS drafts,
            (SELECT count(*) FROM external_links x WHERE x.task_id = k.id AND x.kind = 'review') AS reviewing,
            (SELECT s.state FROM provider_sessions s JOIN threads h ON h.id = s.thread_id
              WHERE h.task_id = k.id AND h.kind = 'task' ORDER BY s.started_at DESC, s.rowid DESC LIMIT 1) AS lead_state,
            (SELECT t.state FROM turn_deliveries t JOIN threads h ON h.id = t.thread_id
              WHERE h.task_id = k.id AND h.kind = 'task' ORDER BY t.requested_at DESC, t.rowid DESC LIMIT 1) AS turn_state,
            (SELECT (julianday(${at}) - julianday(t.ended_at)) * 86400000 FROM turn_deliveries t JOIN threads h ON h.id = t.thread_id
              WHERE h.task_id = k.id AND h.kind = 'task' ORDER BY t.requested_at DESC, t.rowid DESC LIMIT 1) AS turn_ended,
            (SELECT count(*) FROM user_inputs i JOIN threads h ON h.id = i.thread_id
              WHERE h.task_id = k.id AND h.kind = 'task' AND i.state = 'queued') AS queued,
            (SELECT sum((julianday(coalesce(t.ended_at, ${at})) - julianday(t.delivered_at)) * 86400000)
              FROM turn_deliveries t JOIN threads h ON h.id = t.thread_id WHERE h.task_id = k.id AND t.delivered_at IS NOT NULL) AS worked,
            d.parts, d.name, d.prompt
          FROM automation_occurrences o JOIN tasks k ON k.id = o.task_id
          JOIN automation_definitions d ON d.automation_id = o.automation_id AND d.number = o.definition
          WHERE o.state = 'running'`
        for (const one of running)
          yield* Effect.gen(function* () {
            if (one.taskState === 'abandoned') return yield* end(one.id, 'failed', 'Its task was abandoned.')
            if (one.reviewing > 0) {
              if (one.drafts > 0) return yield* end(one.id, 'made', null)
              if (one.taskState === 'done') return yield* end(one.id, 'nothing', 'Its lead drafted no review.')
              // Its lead went before drafting one: stopped (by the person, or Althar closing), or its agent ended.
              if (one.leadState === 'completed' || one.leadState === 'cancelled')
                return yield* end(one.id, 'failed', 'Its review was stopped before its lead drafted one.')
              if (one.leadState === 'lost' || one.leadState === 'failed')
                return yield* end(one.id, 'failed', 'Its lead stopped before it drafted a review; its task’s thread says why.')
              // A turn that failed may be taken over, as after a usage limit, and one the person stopped from the composer is
              // theirs to carry on: only one left so, with nothing waiting, for as long as the run may work ends it.
              const allowed = (Option.getOrUndefined(definitionOf(one))?.minutes ?? 45) * 60_000
              const quiet = one.queued === 0 && (one.turnEnded ?? 0) > allowed
              if (quiet && one.turnState === 'failed')
                return yield* end(one.id, 'failed', 'Its lead’s last turn failed before it drafted a review; its task’s thread says why.')
              if (quiet && one.turnState === 'interrupted')
                return yield* end(one.id, 'failed', 'Its review was stopped before its lead drafted one.')
            } else {
              if (one.runState === 'succeeded') return yield* end(one.id, 'made', null)
              if (one.runState === 'failed') return yield* end(one.id, 'failed', 'Its task failed; its thread says why.')
              if (one.runState === 'cancelled' || one.runState === 'suspended') return yield* end(one.id, 'failed', 'Its task was stopped.')
              if (one.runState === null && one.taskState === 'draft') {
                // Made, but stopped before its plan started: it starts now.
                const definition = Option.getOrUndefined(definitionOf(one))
                const [task] = yield* sql<{ projectId: ProjectId }>`SELECT project_id FROM tasks WHERE id = ${one.taskId}`
                if (definition !== undefined && task !== undefined) yield* admitted(planned(task.projectId, one.taskId, definition))
                return
              }
            }
            const definition = Option.getOrUndefined(definitionOf(one))
            const minutes = definition?.minutes ?? 45
            if ((one.worked ?? 0) > minutes * 60_000) {
              yield* tasks
                .stop({ envelope: yield* envelope('task.stop', { taskId: one.taskId }, undefined, instance.systemId), taskId: one.taskId })
                .pipe(Effect.ignore)
              yield* end(one.id, 'failed', `Stopped after ${minutes} minutes of work.`)
            }
          }).pipe(contained('Automations.watch', () => undefined))
      })

      /** What an earlier launch left starting: started again where its automation is still on, else failed. */
      const recover = Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const left = yield* sql<{
          id: string
          automationId: string
          cause: 'schedule' | 'now'
          slot: string
          dueAt: string
          subject: string
          url: string | null
        }>`
          SELECT o.id, o.automation_id, o.cause, o.slot, o.due_at, o.subject, NULL AS url
          FROM automation_occurrences o WHERE o.state = 'starting' AND o.task_id IS NULL`
        for (const one of left)
          yield* Effect.gen(function* () {
            const row = yield* load(one.automationId).pipe(Effect.option)
            if (Option.isNone(row) || row.value.state !== 'on' || one.subject !== '')
              return yield* end(one.id, 'failed', 'Althar stopped before its task started.')
            const definition = yield* definitionIn(row.value)
            yield* admitted(work(row.value, definition, one.id, one.cause, one.slot, Date.parse(one.dueAt)))
          }).pipe(contained('Automations.recover', () => undefined))
      })

      const clock = Effect.gen(function* () {
        yield* recover
        for (;;) {
          const next = yield* look
          yield* watch
          const wait = Math.max(1_000, Math.min(next - nowOf(), tick))
          yield* Effect.raceFirst(Queue.take(wake), Effect.sleep(Duration.millis(wait)))
        }
      })
      yield* Effect.forkScoped(provide(keptGoing('Automations.clock', clock)))

      /* ---- Reading ---- */

      const runOf = (row: OccurrenceRow): AutomationRun => ({
        id: row.id,
        cause: row.cause,
        state: row.state,
        dueAt: row.dueAt,
        at: row.firedAt,
        subject: row.subjectTitle,
        reason: row.reason,
        task: row.taskId === null || row.threadId === null ? null : { id: row.taskId, threadId: row.threadId, title: row.title ?? '' },
      })

      /** An automation's runs, newest first: a slot that started reviews shows its reviews, and itself only where it has more to say. */
      const runsOf = (automationId: string, count: number) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const rows = yield* sql<OccurrenceRow>`
            SELECT o.id, o.cause, o.slot, o.subject, o.subject_title, o.state, o.reason, o.due_at, o.fired_at, o.task_id,
              h.id AS thread_id, k.title
            FROM automation_occurrences o
            LEFT JOIN tasks k ON k.id = o.task_id LEFT JOIN threads h ON h.task_id = o.task_id AND h.kind = 'task'
            WHERE o.automation_id = ${automationId}
              AND NOT (o.subject = '' AND o.state = 'made' AND o.reason IS NULL
                AND EXISTS (SELECT 1 FROM automation_occurrences s WHERE s.automation_id = o.automation_id AND s.slot = o.slot AND s.subject <> ''))
            ORDER BY o.fired_at DESC, o.rowid DESC LIMIT ${count}`
          return rows.map(runOf)
        })

      const summaryOf = (
        row: Row,
        definition: AutomationDefinition,
        paused: boolean,
        latest: ReadonlyArray<AutomationRun>,
      ): AutomationSummary => ({
        id: row.id,
        projectId: row.projectId,
        name: definition.name,
        prompt: definition.prompt,
        schedule: definition.schedule,
        work: definition.work.kind,
        state: row.state,
        pausedBy: row.state === 'paused' ? row.pausedBy : null,
        pauseReason: row.state === 'paused' ? row.pauseReason : null,
        nextAt: nextAtOf(row, definition, paused),
        latest,
      })

      const list = (projectId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const rows = yield* sql<Row>`
            SELECT a.id, a.project_id, a.device_id, a.state, a.paused_by, a.pause_reason, a.definition, a.posts_reviews, a.since,
              d.name, d.prompt, d.parts
            FROM automations a JOIN automation_definitions d ON d.automation_id = a.id AND d.number = a.definition
            WHERE a.project_id = ${projectId} AND a.state <> 'deleted' AND a.device_id = ${instance.deviceId}
            ORDER BY a.created_at, a.rowid`
          const paused = yield* allPaused
          const summaries: Array<AutomationSummary> = []
          for (const row of rows) {
            const definition = Option.getOrUndefined(definitionOf(row))
            if (definition === undefined) continue
            summaries.push(summaryOf(row, definition, paused, yield* runsOf(row.id, 7)))
          }
          return summaries
        })

      const read = (automationId: string) =>
        Effect.gen(function* () {
          const row = yield* load(automationId)
          const definition = yield* definitionIn(row)
          const paused = yield* allPaused
          const runs = yield* runsOf(row.id, 50)
          return {
            ...summaryOf(row, definition, paused, runs.slice(0, 7)),
            definition,
            postsReviews: row.postsReviews === 1,
            runs,
            allPaused: paused,
          } satisfies AutomationView
        })

      const find = (projectId: string, named: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const wanted = named.trim()
          const [found] = yield* sql<{ id: string }>`
            SELECT a.id FROM automations a JOIN automation_definitions d ON d.automation_id = a.id AND d.number = a.definition
            WHERE a.project_id = ${projectId} AND a.state <> 'deleted' AND (a.id = ${wanted} OR lower(d.name) = lower(${wanted}))
            ORDER BY a.created_at DESC LIMIT 1`
          if (found === undefined) return yield* refused(`The project has no automation called ${wanted}. list_automations lists them.`)
          return yield* read(found.id)
        })

      return Automations.of({
        make: (input) => provide(make(input)),
        propose: (input) =>
          provide(
            Effect.gen(function* () {
              const automationId = yield* make({ projectId: input.projectId, definition: input.definition, actorId: input.actorId })
              yield* cardIn({ projectId: input.projectId, threadId: input.threadId, automationId, definition: input.definition })
              // Its card says when it would first run.
              yield* refreshCards(automationId)
              return automationId
            }),
          ),
        change: (automationId, definition, actorId) =>
          provide(
            Effect.gen(function* () {
              const row = yield* load(automationId)
              yield* define(row, definition, actorId, 'automation.changed')
            }),
          ),
        changeFor: (input) =>
          provide(
            Effect.gen(function* () {
              const row = yield* load(input.automationId)
              const was = yield* definitionIn(row)
              // What reaches further needs the person to turn it on again; a shorter time doesn't.
              const again = row.state !== 'proposed' && widens(was, input.definition)
              yield* define(
                row,
                input.definition,
                input.actorId,
                'automation.changed',
                again ? { state: 'proposed', since: null, pausedBy: null, pauseReason: null } : {},
              )
              yield* cardIn({
                projectId: row.projectId,
                threadId: input.threadId,
                automationId: row.id,
                definition: input.definition,
                was,
                wasState: row.state,
              })
              yield* refreshCards(row.id)
              return { again }
            }),
          ),
        turnOn: (automationId, actorId, itemId) => provide(turnOn(automationId, actorId, itemId)),
        pause: (automationId, actorId) => provide(Effect.asVoid(pauseBy(automationId, actorId, 'person', null))),
        runNow: (automationId, actorId, itemId) => provide(runNow(automationId, actorId, itemId)),
        remove: (automationId, actorId) =>
          provide(
            Effect.asVoid(
              stand(automationId, () => true, { state: 'deleted', pausedBy: null, pauseReason: null }, 'automation.deleted', actorId),
            ),
          ),
        undo: (itemId, actorId) =>
          provide(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient
              const [item] = yield* sql<{ content: string }>`SELECT content FROM thread_items WHERE id = ${itemId} AND kind = 'automation'`
              if (item === undefined) return yield* new NotFound({ kind: 'thread item', id: itemId })
              const card = JSON.parse(item.content) as AutomationCard & { readonly wasState?: Row['state'] }
              if (card.was === null) return
              const row = yield* load(card.automationId)
              // Back to what it was, and where it stood: the person had turned that one on.
              const stood = card.wasState === 'on' || card.wasState === 'paused' ? card.wasState : row.state
              yield* define(
                row,
                card.was,
                actorId,
                'automation.changed',
                stood === row.state
                  ? {}
                  : stood === 'on'
                    ? { state: 'on', since: yield* stamp, pausedBy: null, pauseReason: null }
                    : { state: 'paused', pausedBy: 'person', pauseReason: null },
              )
            }),
          ),
        setPostsReviews: (automationId, on, actorId) =>
          provide(
            Effect.asVoid(
              stand(
                automationId,
                (row) => (row.postsReviews === 1) !== on,
                { postsReviews: on ? 1 : 0 },
                'automation.posts_reviews_set',
                actorId,
              ),
            ),
          ),
        ask: (input) =>
          provide(
            Effect.gen(function* () {
              const row = yield* load(input.automationId)
              const definition = yield* definitionIn(row)
              yield* cardIn({ projectId: row.projectId, threadId: input.threadId, automationId: row.id, definition, ask: input.what })
              yield* refreshCards(row.id)
            }),
          ),
        allPaused: provide(allPaused),
        setAllPaused: (paused) =>
          provide(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient
              if (!paused) yield* sql`DELETE FROM settings WHERE key = ${ALL_PAUSED}`
              else
                yield* sql`
                  INSERT INTO settings ${sql.insert({ key: ALL_PAUSED, value: 'on', updatedAt: yield* stamp })}
                  ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
              // Every card's next time changes with it.
              const all = yield* sql<{ id: string }>`SELECT id FROM automations WHERE state = 'on'`
              for (const one of all) yield* refreshCards(one.id)
              yield* Queue.offer(wake, undefined)
            }),
          ),
        list: (projectId) => provide(list(projectId)),
        read: (automationId) => provide(read(automationId)),
        find: (projectId, named) => provide(find(projectId, named)),
      })
    }),
  )
}
