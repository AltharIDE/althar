import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AutomationCard, AutomationDefinition } from '@althar/contracts'
import { makeFakeService } from '@althar/connectors/testing'
import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Clock, Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Accounts } from '../src/Accounts'
import { AutomationRefused, Automations } from '../src/Automations'
import type { AutomationOptions } from '../src/Config'
import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Limits } from '../src/Limits'
import { Plans } from '../src/Plans'
import { Policies } from '../src/Policies'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Reviews } from '../src/Reviews'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { Tasks } from '../src/Tasks'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, fakeConnectors, HOST, hosted, repository, runtime, until } from './support'

/*
 * Automations (docs/plans/automations.md): work that starts by itself on a
 * schedule, on this computer. Each slot runs once, as an ordinary task; one the
 * computer slept through runs once on waking, within its window, or is missed;
 * one that can't start now is skipped and says why; three failures in a row
 * pause it. The clock here is the test's, in London.
 */

const LONDON = 'Europe/London'

/**
 * A clock the test moves, which the runtime reads (`on`): real time, put forward to where the test sets it, so what the
 * runtime waits for meanwhile still comes. The automations read by it are looked at often, with no wait after waking and
 * no stagger.
 */
const clockAt = (iso: string) => {
  let ahead = Date.parse(iso) - Date.now()
  const now = () => Date.now() + ahead
  const layer = Layer.effect(
    Clock.Clock,
    Clock.clockWith((live) =>
      Effect.succeed<Clock.Clock>({
        currentTimeMillisUnsafe: now,
        currentTimeMillis: Effect.sync(now),
        currentTimeNanosUnsafe: () => BigInt(now()) * 1_000_000n,
        currentTimeNanos: Effect.sync(() => BigInt(now()) * 1_000_000n),
        monotonicTimeNanosUnsafe: () => live.monotonicTimeNanosUnsafe(),
        monotonicTimeNanos: live.monotonicTimeNanos,
        sleep: (duration) => live.sleep(duration),
      }),
    ),
  )
  const options: AutomationOptions = {
    zone: () => LONDON,
    tick: Duration.millis(100),
    settle: Duration.zero,
    stagger: false,
  }
  return {
    now,
    options,
    set: (to: string) => void (ahead = Date.parse(to) - Date.now()),
    /** The runtime, and the test, on this clock. */
    on: <A, E, R>(runtime: Layer.Layer<A, E, R>) => runtime.pipe(Layer.provideMerge(layer)),
  }
}

/** Release notes every weekday at 9:00: a report, nothing outside this computer. */
const NOTES: AutomationDefinition = {
  name: 'Release notes',
  prompt: 'Write release notes from what merged this week. [lead:finish] [lead:terse]',
  schedule: { every: 'week', days: [1, 2, 3, 4, 5], at: '09:00' },
  zone: LONDON,
  lead: { agentId: 'codex', model: null },
  work: { kind: 'task', review: null, end: null },
  allowEverything: true,
  minutes: 45,
  late: 'once',
}

/** Every morning at 9:00, a review of each new pull request, on an agent held to reading. */
const REVIEW: AutomationDefinition = {
  ...NOTES,
  name: 'Morning review',
  prompt: 'Review the new pull requests.',
  lead: { agentId: 'claude-code', model: null },
  work: { kind: 'review' },
}

/** A repository on the fake GitHub, with one pull request by a teammate, #1, whose head is there to review. */
const withOneToReview = () => {
  const at = hosted()
  const github = makeFakeService({ pushUrl: () => at.bare })
  github.addRepository(['meridian', 'api'])
  const git = (...args: Array<string>) =>
    execFileSync('git', ['-c', 'user.name=Nine', '-c', 'user.email=nine@althar.test', ...args], { cwd: at.working })
      .toString()
      .trim()
  /** Another pull request by the teammate, its head there to review too. */
  const byTeammate = (title: string, file: string, text: string) => {
    git('checkout', '-q', '--detach', 'main')
    writeFileSync(join(at.working, file), text)
    git('add', '.')
    git('commit', '-q', '-m', title)
    const head = git('rev-parse', 'HEAD')
    git('checkout', '-q', 'main')
    const opened = github.addPullRequest({ path: ['meridian', 'api'], title, author: 'ninemate', body: '', headSha: head })
    git('push', '-q', at.bare, `${head}:refs/pull/${opened.number}/head`)
  }
  byTeammate('Send back', 'send.ts', 'export const sendBack = () => 1\n')
  return { at, github, byTeammate }
}

/** The project on that repository, with GitHub connected. */
const openedOn = (working: string) =>
  Effect.gen(function* () {
    const instance = yield* Instance
    yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const projects = yield* Projects
    return (yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })).projectId as ProjectId
  })

const opened = Effect.gen(function* () {
  const projects = yield* Projects
  const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
  return project.projectId as ProjectId
})

const occurrencesOf = (automationId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{
      cause: string
      slot: string
      subject: string
      subjectTitle: string | null
      state: string
      reason: string | null
      taskId: string | null
    }>`
      SELECT cause, slot, subject, subject_title, state, reason, task_id FROM automation_occurrences
      WHERE automation_id = ${automationId} ORDER BY fired_at, rowid`
  })

/** Once a run's task has its lead at work: a session on its thread. */
const leadStarted = (taskId: string) =>
  until(
    Effect.flatMap(
      SqlClient.SqlClient,
      (sql) => sql<{ state: string }>`
        SELECT s.state FROM provider_sessions s JOIN threads h ON h.id = s.thread_id WHERE h.task_id = ${taskId} AND h.kind = 'task'`,
    ),
    (sessions) => sessions.length > 0,
  )

const automationRow = (automationId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ state: string; pausedBy: string | null; pauseReason: string | null; definition: number }>`
      SELECT state, paused_by, pause_reason, definition FROM automations WHERE id = ${automationId}`
    return row
  })

describe('automations', () => {
  it.live('fire a slot once at its time, as a task that says when it was due, which made something once it is done', () => {
    const clock = clockAt('2026-10-21T07:59:00Z')
    return Effect.gen(function* () {
      const automations = yield* Automations
      const instance = yield* Instance
      const sql = yield* SqlClient.SqlClient
      const projectId = yield* opened
      const automationId = yield* automations.make({ projectId, definition: NOTES, on: true, actorId: instance.personId })
      // Before its time, nothing.
      yield* Effect.sleep('300 millis')
      assert.deepStrictEqual(yield* occurrencesOf(automationId), [])
      assert.strictEqual((yield* automations.read(automationId)).nextAt, '2026-10-21T08:00:00.000Z')

      clock.set('2026-10-21T08:00:05Z')
      const [ran] = yield* until(occurrencesOf(automationId), (rows) => rows[0]?.state === 'made')
      assert.deepInclude(ran, { cause: 'schedule', slot: '2026-10-21T09:00', subject: '' })
      const [task] = yield* sql<{ title: string; description: string; request: string }>`
        SELECT title, description, request FROM tasks WHERE id = ${ran?.taskId ?? ''}`
      assert.strictEqual(task?.title, 'Release notes, 21 Oct')
      assert.include(task?.description, 'This is a run of the automation “Release notes”, which runs every weekday at 9:00')
      assert.include(task?.description, 'It was due at 9:00.')
      assert.strictEqual(task?.request, NOTES.prompt)
      // Looked at again, the slot has its one occurrence.
      yield* Effect.sleep('400 millis')
      assert.strictEqual((yield* occurrencesOf(automationId)).length, 1)
      const view = yield* automations.read(automationId)
      assert.strictEqual(view.nextAt, '2026-10-22T08:00:00.000Z')
      assert.deepInclude(view.runs[0], { state: 'made', cause: 'schedule' })
      assert.strictEqual(view.runs[0]?.task?.title, 'Release notes, 21 Oct')
      // Its task's card says which automation it came from.
      const queries = yield* Queries
      const card = (yield* queries.board(projectId)).tasks.find((one) => one.taskId === ran?.taskId)
      assert.deepStrictEqual(card?.automation, { id: automationId, name: 'Release notes' })
    }).pipe(Effect.provide(clock.on(Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { automations: clock.options }))))))
  })

  it.live('run a slot the computer slept through once on waking, within its window, and miss one past it; never every slot', () => {
    const clock = clockAt('2026-10-20T07:00:00Z')
    return Effect.gen(function* () {
      const automations = yield* Automations
      const instance = yield* Instance
      const sql = yield* SqlClient.SqlClient
      const projectId = yield* opened
      const automationId = yield* automations.make({ projectId, definition: NOTES, on: true, actorId: instance.personId })
      // Asleep from Tuesday 8:00 to Wednesday 13:00: Wednesday's 9:00 runs once, Tuesday's never.
      clock.set('2026-10-21T12:00:00Z')
      const [ran] = yield* until(occurrencesOf(automationId), (rows) => rows[0]?.state === 'made')
      assert.strictEqual(ran?.slot, '2026-10-21T09:00')
      const [task] = yield* sql<{ description: string }>`SELECT description FROM tasks WHERE id = ${ran?.taskId ?? ''}`
      assert.include(task?.description, 'It was due at 9:00; it is 13:00, since the computer was asleep or Althar was closed.')
      // Asleep until Thursday 21:30: Thursday's 9:00 is past its window, so it is missed, and says so.
      clock.set('2026-10-22T20:30:00Z')
      const rows = yield* until(occurrencesOf(automationId), (all) => all.length === 2)
      assert.deepInclude(rows[1], {
        slot: '2026-10-22T09:00',
        state: 'missed',
        reason: 'Missed: the computer was asleep, or Althar closed, at 9:00.',
        taskId: null,
      })
      // One that skips what the computer slept through skips it.
      yield* automations.change(automationId, { ...NOTES, late: 'skip' }, instance.personId)
      clock.set('2026-10-23T09:30:00Z')
      const later = yield* until(occurrencesOf(automationId), (all) => all.length === 3)
      assert.deepInclude(later[2], { slot: '2026-10-23T09:00', state: 'missed' })
    }).pipe(Effect.provide(clock.on(runtime(':memory:', {}, { automations: clock.options }))))
  })

  it.live('count no slot from before they were turned on, and run none while they are off', () => {
    const clock = clockAt('2026-10-21T08:30:00Z')
    return Effect.gen(function* () {
      const automations = yield* Automations
      const instance = yield* Instance
      const projectId = yield* opened
      const on = yield* automations.make({ projectId, definition: NOTES, on: true, actorId: instance.personId })
      const proposed = yield* automations.make({ projectId, definition: NOTES, actorId: instance.personId })
      yield* Effect.sleep('400 millis')
      // Wednesday's 9:00 came before it was turned on at 9:30.
      assert.deepStrictEqual(yield* occurrencesOf(on), [])
      clock.set('2026-10-22T08:00:05Z')
      yield* until(occurrencesOf(on), (rows) => rows.length === 1)
      yield* Effect.sleep('300 millis')
      assert.deepStrictEqual(yield* occurrencesOf(proposed), [])
      // Not on yet, it says when it would first run.
      assert.strictEqual((yield* automations.read(proposed)).nextAt, '2026-10-23T08:00:00.000Z')
    }).pipe(Effect.provide(clock.on(runtime(':memory:', {}, { automations: clock.options }))))
  })

  it.live('skip a slot while their last run still goes, or while every automation is paused; Run now still runs, once at a time', () => {
    const clock = clockAt('2026-10-21T07:59:00Z')
    // A lead that never reports: its run goes on.
    const going: AutomationDefinition = { ...NOTES, prompt: 'Write release notes.' }
    return Effect.gen(function* () {
      const automations = yield* Automations
      const instance = yield* Instance
      const sql = yield* SqlClient.SqlClient
      const projectId = yield* opened
      const automationId = yield* automations.make({ projectId, definition: going, on: true, actorId: instance.personId })
      clock.set('2026-10-21T08:00:05Z')
      yield* until(occurrencesOf(automationId), (rows) => rows[0]?.state === 'running')
      // Thursday's comes while Wednesday's still goes.
      clock.set('2026-10-22T08:00:05Z')
      const rows = yield* until(occurrencesOf(automationId), (all) => all.length === 2)
      assert.deepInclude(rows[1], { slot: '2026-10-22T09:00', state: 'skipped', reason: 'Its last run was still going.' })
      // Run now says so, rather than skipping.
      const refused = yield* Effect.flip(automations.runNow(automationId, instance.personId))
      assert.instanceOf(refused, AutomationRefused)
      assert.strictEqual((refused as AutomationRefused).message, 'Its last run was still going.')

      // Done with it, and every automation paused: Friday's is skipped, saying so; Run now runs it.
      yield* sql`UPDATE automation_occurrences SET state = 'failed', ended_at = ${new Date(clock.now()).toISOString()}, reason = 'Stopped.' WHERE automation_id = ${automationId} AND state = 'running'`
      yield* automations.setAllPaused(true)
      assert.isTrue(yield* automations.allPaused)
      assert.isNull((yield* automations.read(automationId)).nextAt)
      clock.set('2026-10-23T08:00:05Z')
      const paused = yield* until(occurrencesOf(automationId), (all) => all.length === 3)
      assert.deepInclude(paused[2], { state: 'skipped', reason: 'Every automation was paused.' })
      yield* automations.runNow(automationId, instance.personId)
      const now = yield* until(occurrencesOf(automationId), (all) => all.length === 4)
      assert.strictEqual(now[3]?.cause, 'now')
      assert.match(now[3]?.slot ?? '', /^now:occ_/)
      yield* automations.setAllPaused(false)
      assert.isFalse(yield* automations.allPaused)
    }).pipe(Effect.provide(clock.on(runtime(':memory:', {}, { automations: clock.options }))))
  })

  it.live('pause themselves after three failures in a row, saying why, and run again once turned back on', () => {
    const clock = clockAt('2026-10-19T08:00:05Z')
    return Effect.gen(function* () {
      const automations = yield* Automations
      const instance = yield* Instance
      const sql = yield* SqlClient.SqlClient
      const projectId = yield* opened
      // Its tasks can't be made.
      yield* sql.unsafe(
        "CREATE TRIGGER no_notes BEFORE INSERT ON tasks WHEN NEW.title LIKE 'Release notes%' BEGIN SELECT RAISE(ABORT, 'No notes'); END",
      )
      const automationId = yield* automations.make({ projectId, definition: NOTES, on: true, actorId: instance.personId })
      yield* sql`UPDATE automations SET since = '2026-10-19T07:00:00.000Z' WHERE id = ${automationId}`
      for (const [day, count] of [
        ['2026-10-19', 1],
        ['2026-10-20', 2],
        ['2026-10-21', 3],
      ] as const) {
        clock.set(`${day}T08:00:05Z`)
        yield* until(occurrencesOf(automationId), (rows) => rows.length === count && rows.every((row) => row.state === 'failed'))
      }
      const row = yield* until(
        Effect.map(automationRow(automationId), (one) => (one === undefined ? [] : [one])),
        (rows) => rows[0]?.state === 'paused',
      )
      assert.deepInclude(row[0], {
        pausedBy: 'itself',
        pauseReason: 'Its last 3 runs failed. The last: Althar couldn’t start its task.',
      })
      const view = yield* automations.read(automationId)
      assert.strictEqual(view.pausedBy, 'itself')
      assert.isNull(view.nextAt)
      // Paused, Thursday's doesn't come; turned on again, Friday's does.
      clock.set('2026-10-22T08:00:05Z')
      yield* Effect.sleep('300 millis')
      assert.strictEqual((yield* occurrencesOf(automationId)).length, 3)
      yield* sql.unsafe('DROP TRIGGER no_notes')
      yield* automations.turnOn(automationId, instance.personId)
      assert.deepInclude(yield* automationRow(automationId), { state: 'on', pausedBy: null, pauseReason: null })
      clock.set('2026-10-23T08:00:05Z')
      yield* until(occurrencesOf(automationId), (rows) => rows.length === 4 && rows[3]?.state === 'made')
    }).pipe(Effect.provide(clock.on(runtime(':memory:', {}, { automations: clock.options }))))
  })

  it.live(
    'are proposed by the coordinator on a card the person turns on; a change that reaches further waits for them, and Undo puts it back',
    () => {
      const clock = clockAt('2026-10-21T10:00:00Z')
      return Effect.gen(function* () {
        const automations = yield* Automations
        const instance = yield* Instance
        const queries = yield* Queries
        const projectId = yield* opened
        const threadId = yield* (yield* Coordinator).thread(projectId)
        const coordinator: ToolAccess = { role: 'coordinator', projectId, threadId, sessionId: 'none', taskId: null }
        const cards = Effect.map(queries.coordinator(projectId), (snapshot) =>
          snapshot.items.flatMap((item): ReadonlyArray<AutomationCard & { readonly itemId: string }> =>
            item.kind === 'automation' ? [{ ...item.content, itemId: item.id }] : [],
          ),
        )

        const proposed = yield* callTool(coordinator, 'propose_automation', {
          name: 'Release notes',
          prompt: 'Write release notes from what merged this week.',
          when: { days: ['friday'], at: '16:00' },
          lead: { agent: 'codex' },
          ends_in: 'nothing',
        })
        assert.match(
          proposed,
          /^Proposed the automation “Release notes”, every Friday at 16:00\. Nothing runs until the person turns it on/,
        )
        const [card] = yield* cards
        assert.deepInclude(card, { state: 'proposed', was: null, ask: null, nextAt: '2026-10-23T15:00:00.000Z' })
        assert.deepInclude(card?.definition, {
          name: 'Release notes',
          schedule: { every: 'week', days: [5], at: '16:00' },
          allowEverything: true,
          minutes: 45,
        })
        const automationId = card?.automationId ?? ''
        assert.match(
          yield* callTool(coordinator, 'list_automations'),
          /“Release notes” \(auto_[0-9a-f]+\): every Friday at 16:00, a task from its prompt; waiting for the person to turn it on/,
        )

        // Changed by the person on its card before it is on, the card shows it as changed.
        yield* automations.change(automationId, { ...(card?.definition ?? NOTES), minutes: 30 }, instance.personId)
        assert.strictEqual((yield* cards)[0]?.definition.minutes, 30)
        yield* automations.turnOn(automationId, instance.personId)
        assert.deepInclude((yield* cards)[0], { state: 'on', nextAt: '2026-10-23T15:00:00.000Z' })

        // A shorter time holds as it is; another day reaches further, so it waits for the person, its card saying what it was.
        assert.match(
          yield* callTool(coordinator, 'change_automation', { automation: 'release notes', minutes: 20 }),
          /holds from its next run/,
        )
        assert.strictEqual((yield* automationRow(automationId))?.state, 'on')
        assert.match(
          yield* callTool(coordinator, 'change_automation', { automation: automationId, when: { days: ['monday'], at: '09:00' } }),
          /waits for the person to turn it on again/,
        )
        assert.strictEqual((yield* automationRow(automationId))?.state, 'proposed')
        const changed = (yield* cards).at(-1)
        assert.deepStrictEqual(changed?.was?.schedule, { every: 'week', days: [5], at: '16:00' })
        assert.deepStrictEqual(changed?.definition.schedule, { every: 'week', days: [1], at: '09:00' })
        yield* automations.undo(changed?.itemId ?? '', instance.personId)
        const back = yield* automations.read(automationId)
        assert.deepStrictEqual(back.definition.schedule, { every: 'week', days: [5], at: '16:00' })
        assert.strictEqual(back.state, 'on')

        // Paused in words; resumed and run now only on a card the person presses.
        assert.match(yield* callTool(coordinator, 'pause_automation', { automation: 'Release notes' }), /^Paused “Release notes”/)
        assert.match(yield* callTool(coordinator, 'resume_automation', { automation: 'Release notes' }), /on a card/)
        const asked = (yield* cards).at(-1)
        assert.deepStrictEqual(asked?.ask, { what: 'resume', done: false })
        assert.strictEqual((yield* automationRow(automationId))?.state, 'paused')
        yield* automations.turnOn(automationId, instance.personId, asked?.itemId)
        assert.deepStrictEqual((yield* cards).at(-1)?.ask, { what: 'resume', done: true })
        assert.strictEqual((yield* automationRow(automationId))?.state, 'on')
        assert.match(yield* callTool(coordinator, 'run_automation_now', { automation: 'Release notes' }), /on a card/)
        assert.deepStrictEqual((yield* cards).at(-1)?.ask, { what: 'run', done: false })

        // What it can't read is said to it.
        assert.match(yield* callTool(coordinator, 'pause_automation', { automation: 'Nothing' }), /no automation called Nothing/)
        assert.match(
          yield* callTool(coordinator, 'propose_automation', {
            name: 'Bad',
            prompt: 'x',
            when: { at: '9am' },
            lead: { agent: 'codex' },
            ends_in: 'nothing',
          }),
          /Say when as days and a time/,
        )
        // A review is led only by an agent held to reading.
        assert.match(
          yield* callTool(coordinator, 'propose_automation', {
            name: 'Morning review',
            prompt: 'Review the new pull requests.',
            when: { at: '09:00' },
            lead: { agent: 'codex' },
            ends_in: 'reviews',
          }),
          /can't be held to reading only/,
        )
        yield* automations.remove(automationId, instance.personId)
        assert.strictEqual((yield* automations.list(projectId)).length, 0)
        assert.deepInclude((yield* cards)[0], { state: 'deleted' })
      }).pipe(Effect.provide(clock.on(Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { automations: clock.options }))))))
    },
  )

  it.live('run on a plan only for now: one whose agent pays per use is refused, and skipped on its schedule', () => {
    const clock = clockAt('2026-10-21T07:59:00Z')
    return Effect.gen(function* () {
      const automations = yield* Automations
      const instance = yield* Instance
      const projectId = yield* opened
      const automationId = yield* automations.make({ projectId, definition: NOTES, on: true, actorId: instance.personId })
      const refused = yield* Effect.flip(automations.runNow(automationId, instance.personId))
      assert.strictEqual((refused as AutomationRefused).message, 'Its agent pays per use, and automations run on a plan only for now.')
      clock.set('2026-10-21T08:00:05Z')
      const [skipped] = yield* until(occurrencesOf(automationId), (rows) => rows.length === 1)
      assert.deepInclude(skipped, { state: 'skipped', reason: 'Its agent pays per use, and automations run on a plan only for now.' })
    }).pipe(Effect.provide(clock.on(runtime(':memory:', {}, { automations: clock.options, perUse: ['codex'] }))))
  })

  it.live('stop a run that has worked its minutes, which failed saying so', () => {
    const clock = clockAt('2026-10-21T07:59:00Z')
    // A lead that never reports, kept to five minutes.
    const going: AutomationDefinition = { ...NOTES, prompt: 'Write release notes.', minutes: 5 }
    return Effect.gen(function* () {
      const automations = yield* Automations
      const instance = yield* Instance
      const sql = yield* SqlClient.SqlClient
      const projectId = yield* opened
      const automationId = yield* automations.make({ projectId, definition: going, on: true, actorId: instance.personId })
      clock.set('2026-10-21T08:00:05Z')
      const [running] = yield* until(occurrencesOf(automationId), (rows) => rows[0]?.state === 'running')
      yield* until(
        sql<{ n: number }>`
          SELECT count(*) AS n FROM turn_deliveries t JOIN threads h ON h.id = t.thread_id
          WHERE h.task_id = ${running?.taskId ?? ''} AND t.delivered_at IS NOT NULL`,
        (rows) => (rows[0]?.n ?? 0) > 0,
      )
      // Its turns, as if they had gone on for ten minutes.
      yield* sql`
        UPDATE turn_deliveries SET delivered_at = ${new Date(clock.now() - 10 * 60_000).toISOString()}
        WHERE thread_id IN (SELECT id FROM threads WHERE task_id = ${running?.taskId ?? ''})`
      const [stopped] = yield* until(occurrencesOf(automationId), (rows) => rows[0]?.state === 'failed')
      assert.strictEqual(stopped?.reason, 'Stopped after 5 minutes of work.')
      yield* until(
        sql<{ state: string }>`SELECT state FROM runs WHERE task_id = ${running?.taskId ?? ''}`,
        (rows) => rows[0]?.state === 'suspended',
      )
      // Its card says Althar stopped it, and when: as the run stopped, not as a turn its lead was sent after without the run
      // carried on (as the board's Carry on once did) ended.
      const cardOf = Effect.map(Effect.orDie((yield* Queries).coordinator(projectId)), (snapshot) =>
        snapshot.items.flatMap((item) => (item.kind === 'task' && item.content.taskId === running?.taskId ? [item.content] : [])),
      )
      const [attempt] = yield* sql<{ endedAt: string }>`
        SELECT a.ended_at AS ended_at FROM run_attempts a JOIN runs r ON r.id = a.run_id WHERE r.task_id = ${running?.taskId ?? ''}`
      const [card] = yield* until(cardOf, (cards) => cards[0]?.phase === 'stopped')
      assert.deepStrictEqual(card?.stopped, { by: 'althar', at: attempt?.endedAt ?? '' })
      const [thread] = yield* sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${running?.taskId ?? ''} AND kind = 'task'`
      const sessions = yield* Sessions
      yield* sessions.send({
        envelope: yield* Runtime.envelope('thread.send', {}),
        threadId: thread?.id ?? '',
        body: 'Carry on. [lead:finish]',
      })
      yield* sessions.startLast(thread?.id ?? '')
      yield* until(
        sql<{ n: number }>`
          SELECT count(*) AS n FROM turn_deliveries WHERE thread_id = ${thread?.id ?? ''} AND state = 'completed' AND requested_at > ${attempt?.endedAt ?? ''}`,
        (rows) => (rows[0]?.n ?? 0) > 0,
      )
      const [after] = yield* until(cardOf, (cards) => cards[0]?.phase === 'stopped')
      assert.deepStrictEqual(after?.stopped, { by: 'althar', at: attempt?.endedAt ?? '' })
    }).pipe(Effect.provide(clock.on(Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { automations: clock.options }))))))
  })

  it.live('start a run Althar stopped before its task was made, once it is back, and fail one whose automation is off by then', () => {
    const clock = clockAt('2026-10-21T10:00:00Z')
    const database = join(mkdtempSync(join(tmpdir(), 'althar-automations-')), 'althar.sqlite')
    const left = (automationId: string, slot: string) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const [row] = yield* sql<{ projectId: string }>`SELECT project_id FROM automations WHERE id = ${automationId}`
        yield* sql`INSERT INTO automation_occurrences ${sql.insert({
          id: `occ_${'0'.repeat(31)}${slot === '2026-10-21T09:00' ? '1' : '2'}`,
          projectId: row?.projectId ?? '',
          automationId,
          definition: 1,
          cause: 'schedule',
          slot,
          state: 'starting',
          dueAt: '2026-10-21T08:00:00.000Z',
          firedAt: '2026-10-21T08:00:01.000Z',
        })}`
      })
    return Effect.gen(function* () {
      const made = yield* Effect.gen(function* () {
        const automations = yield* Automations
        const instance = yield* Instance
        const projectId = yield* opened
        const on = yield* automations.make({ projectId, definition: NOTES, on: true, actorId: instance.personId })
        const off = yield* automations.make({ projectId, definition: NOTES, actorId: instance.personId })
        yield* left(on, '2026-10-21T09:00')
        yield* left(off, 'now:occ_0')
        return { on, off }
      }).pipe(Effect.provide(clock.on(runtime(database, {}, { automations: clock.options }))))
      yield* Effect.gen(function* () {
        yield* until(occurrencesOf(made.on), (rows) => rows[0]?.state === 'made')
        const [failed] = yield* until(occurrencesOf(made.off), (rows) => rows[0]?.state === 'failed')
        assert.strictEqual(failed?.reason, 'Althar stopped before its task started.')
      }).pipe(Effect.provide(clock.on(runtime(database, {}, { automations: clock.options }))))
    })
  })

  it.live(
    'review each new pull request not by the person, one task each; the first waits, and once let post, they are signed with its name',
    () => {
      const clock = clockAt('2026-10-21T07:59:00Z')
      const { at, github } = withOneToReview()
      return Effect.gen(function* () {
        const automations = yield* Automations
        const instance = yield* Instance
        const reviews = yield* Reviews
        const sql = yield* SqlClient.SqlClient
        const projectId = yield* openedOn(at.working)
        const automationId = yield* automations.make({ projectId, definition: REVIEW, on: true, actorId: instance.personId })
        clock.set('2026-10-21T08:00:05Z')
        const rows = yield* until(occurrencesOf(automationId), (all) => all.length === 2 && all[1]?.taskId !== null)
        // Its review says what it found, so the listing says nothing of its own.
        assert.deepInclude(rows[0], { subject: '', state: 'made', reason: null })
        assert.deepInclude(rows[1], { slot: '2026-10-21T09:00', state: 'running', subjectTitle: '#1 Send back' })
        const taskId = rows[1]?.taskId ?? ''
        const [thread] = yield* sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${taskId} AND kind = 'task'`
        const lead: ToolAccess = { role: 'lead', projectId, threadId: thread?.id ?? '', sessionId: 'none', taskId }
        // Its first review waits for the person.
        assert.match(yield* callTool(lead, 'draft_review', { verdict: 'comment', summary: 'Fine.' }), /^Drafted your review/)
        assert.strictEqual(github.reviewsPosted.length, 0)
        const [draft] = yield* sql<{ id: string }>`SELECT id FROM review_drafts WHERE task_id = ${taskId}`
        yield* until(occurrencesOf(automationId), (all) => all[1]?.state === 'made')
        // Let its reviews post: this one goes, signed with its name.
        yield* automations.setPostsReviews(automationId, true, instance.personId)
        const posted = yield* reviews.post(draft?.id ?? '', instance.personId)
        assert.strictEqual(posted.state, 'posted')
        assert.deepStrictEqual(posted.automation, { id: automationId, name: 'Morning review', postsReviews: true })
        // Signed with its name, then the agent that wrote it where Althar can tell.
        assert.match(github.reviewsPosted[0]?.review.body ?? '', /^Fine\.\n\n<sub>From Althar’s morning review(, by [^<]+)?\.<\/sub>$/)
        // The next morning, nothing new: nothing to do, and no task.
        clock.set('2026-10-22T08:00:05Z')
        const next = yield* until(occurrencesOf(automationId), (all) => all.length === 3)
        assert.deepInclude(next[2], { slot: '2026-10-22T09:00', state: 'nothing', reason: 'No new pull requests to review.', taskId: null })
        // Its history shows the review it started, not the listing that found it, and the quiet morning.
        const view = yield* automations.read(automationId)
        assert.deepStrictEqual(
          view.runs.map((one) => [one.state, one.subject]),
          [
            ['nothing', null],
            ['made', '#1 Send back'],
          ],
        )
      }).pipe(Effect.provide(clock.on(runtime(':memory:', {}, { automations: clock.options, connectors: fakeConnectors({ github }) }))))
    },
  )

  it.live('run on a plan only where the agent’s status says so: one that can’t tell is refused, and skipped on its schedule', () => {
    const clock = clockAt('2026-10-21T07:59:00Z')
    const unsure = 'Althar can’t tell that its agent is on a plan, and automations run on a plan only for now.'
    return Effect.gen(function* () {
      const automations = yield* Automations
      const instance = yield* Instance
      const projectId = yield* opened
      const automationId = yield* automations.make({ projectId, definition: NOTES, on: true, actorId: instance.personId })
      const refused = yield* Effect.flip(automations.runNow(automationId, instance.personId))
      assert.strictEqual((refused as AutomationRefused).message, unsure)
      clock.set('2026-10-21T08:00:05Z')
      const [skipped] = yield* until(occurrencesOf(automationId), (rows) => rows.length === 1)
      assert.deepInclude(skipped, { state: 'skipped', reason: unsure })
    }).pipe(Effect.provide(clock.on(runtime(':memory:', {}, { automations: clock.options, unsure: ['codex'] }))))
  })

  it.live('keep a run on a plan when its account runs out: another agent on a plan takes it over, never the account paid per use', () => {
    const clock = clockAt('2026-10-21T07:59:00Z')
    const back = Date.now() + 60 * 60 * 1000
    const work = join(mkdtempSync(join(tmpdir(), 'althar-home-')), 'work')
    mkdirSync(work)
    return Effect.gen(function* () {
      const automations = yield* Automations
      const instance = yield* Instance
      const accounts = yield* Accounts
      const limits = yield* Limits
      const sql = yield* SqlClient.SqlClient
      const projectId = yield* opened
      const [usual] = yield* accounts.of('codex')
      const key = yield* accounts.add({ agentId: 'codex', name: 'work', folder: work })
      // The project moves work on to an agent's next account, which here pays per use.
      yield* (yield* Policies).setAccounts(projectId, { rotate: true }, instance.personId)
      const automationId = yield* automations.make({ projectId, definition: NOTES, on: true, actorId: instance.personId })
      clock.set('2026-10-21T08:00:05Z')
      const [ran] = yield* until(occurrencesOf(automationId), (rows) => rows[0]?.state === 'made')
      const [thread] = yield* sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${ran?.taskId ?? ''} AND kind = 'task'`
      const sessions = yield* sql<{ agentId: string; accountId: string }>`
        SELECT agent_id, account_id FROM provider_sessions WHERE thread_id = ${thread?.id ?? ''} ORDER BY started_at`
      assert.deepStrictEqual(
        sessions.map((one) => one.agentId),
        ['codex', 'claude-code'],
      )
      assert.strictEqual(sessions[0]?.accountId, usual?.id)
      assert.notInclude(
        sessions.map((one) => one.accountId),
        key.id,
      )
      // Nor does a session of its run start on that account when it is named.
      const refused = yield* Effect.flip(limits.pick({ agentId: 'codex', projectId, threadId: thread?.id ?? '', accountId: key.id }))
      assert.deepInclude(refused, { _tag: 'PlanOnly', message: 'Its agent pays per use, and automations run on a plan only for now.' })
      // Outside an automation's run, the project's work still moves to it.
      assert.strictEqual((yield* limits.pick({ agentId: 'codex', projectId })).id, key.id)
    }).pipe(
      Effect.provide(
        clock.on(
          runtime(':memory:', {}, { automations: clock.options, each: { 'codex@usual': { outOfUsage: { until: back } } }, perUse: [work] }),
        ),
      ),
    )
  })

  it.live('start one run of Run now pressed twice at once: the other is refused, its run still going', () => {
    const clock = clockAt('2026-10-21T10:00:00Z')
    // A lead that never reports: its run goes on.
    const going: AutomationDefinition = { ...NOTES, prompt: 'Write release notes.' }
    return Effect.gen(function* () {
      const automations = yield* Automations
      const instance = yield* Instance
      const projectId = yield* opened
      const automationId = yield* automations.make({ projectId, definition: going, on: true, actorId: instance.personId })
      const press = automations.runNow(automationId, instance.personId).pipe(
        Effect.as('ran'),
        Effect.catch((error) => Effect.succeed(error instanceof AutomationRefused ? error.message : 'failed')),
      )
      const pressed = yield* Effect.all([press, press], { concurrency: 'unbounded' })
      assert.deepStrictEqual(pressed.toSorted(), ['Its last run was still going.', 'ran'])
      const rows = yield* occurrencesOf(automationId)
      assert.strictEqual(rows.length, 1)
      assert.strictEqual(rows[0]?.cause, 'now')
    }).pipe(Effect.provide(clock.on(runtime(':memory:', {}, { automations: clock.options }))))
  })

  it.live('start a run’s plan Althar kept, held, but stopped before starting, once it is back: once', () => {
    const clock = clockAt('2026-10-21T10:00:00Z')
    const database = join(mkdtempSync(join(tmpdir(), 'althar-automations-')), 'althar.sqlite')
    const occurrenceId = `occ_${'0'.repeat(31)}3`
    return Effect.gen(function* () {
      const taskId = yield* Effect.gen(function* () {
        const automations = yield* Automations
        const instance = yield* Instance
        const sql = yield* SqlClient.SqlClient
        const projectId = yield* opened
        const automationId = yield* automations.make({ projectId, definition: NOTES, actorId: instance.personId })
        // The clock has looked since it was made, and won't again before Althar stops.
        yield* Effect.sleep('300 millis')
        yield* sql`INSERT INTO automation_occurrences ${sql.insert({
          id: occurrenceId,
          projectId,
          automationId,
          definition: 1,
          cause: 'now',
          slot: `now:${occurrenceId}`,
          state: 'starting',
          dueAt: '2026-10-21T09:00:00.000Z',
          firedAt: '2026-10-21T09:00:01.000Z',
        })}`
        // Its task made, and its plan kept, held, as a run does before starting it; then Althar stops.
        const created = yield* (yield* Projects).createTask({
          envelope: yield* Runtime.envelope('task.create', {}),
          projectId,
          title: 'Release notes, 21 Oct',
          description: NOTES.prompt,
          draft: true,
          request: NOTES.prompt,
          plain: true,
          occurrence: occurrenceId,
        })
        yield* (yield* Plans).propose({
          projectId,
          taskId: created.taskId,
          steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
          reason: null,
          actorId: instance.systemId,
          end: null,
          held: true,
          here: true,
        })
        return created.taskId
      }).pipe(Effect.provide(clock.on(runtime(database, {}, { automations: { ...clock.options, tick: Duration.hours(1) } }))))
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const [made] = yield* until(
          sql<{ state: string; taskId: string | null }>`SELECT state, task_id FROM automation_occurrences WHERE id = ${occurrenceId}`,
          (rows) => rows[0]?.state === 'made',
        )
        assert.strictEqual(made?.taskId, taskId)
        const kept = yield* sql<{ state: string }>`SELECT state FROM task_plans WHERE task_id = ${taskId}`
        assert.deepStrictEqual(
          kept.map((plan) => plan.state),
          ['accepted'],
        )
      }).pipe(Effect.provide(clock.on(runtime(database, {}, { automations: clock.options }))))
    })
  })

  it.live('end a review stopped before its lead drafted one, as failed, so the next run isn’t held up by it', () => {
    const clock = clockAt('2026-10-21T07:59:00Z')
    const { at, github } = withOneToReview()
    return Effect.gen(function* () {
      const automations = yield* Automations
      const instance = yield* Instance
      const projectId = yield* openedOn(at.working)
      const automationId = yield* automations.make({ projectId, definition: REVIEW, on: true, actorId: instance.personId })
      clock.set('2026-10-21T08:00:05Z')
      const rows = yield* until(occurrencesOf(automationId), (all) => all[1]?.state === 'running')
      const taskId = rows[1]?.taskId ?? ''
      // Its lead is at it, and the person stops it before it drafts anything.
      yield* leadStarted(taskId)
      yield* (yield* Tasks).stop({ envelope: yield* Runtime.envelope('task.stop', { taskId }), taskId })
      const stopped = yield* until(occurrencesOf(automationId), (all) => all[1]?.state === 'failed')
      assert.strictEqual(stopped[1]?.reason, 'Its review was stopped before its lead drafted one.')
      // Run now isn't refused as if it still went: it finds nothing new, since a task has had that pull request.
      yield* automations.runNow(automationId, instance.personId)
      const now = yield* until(occurrencesOf(automationId), (all) => all.length === 3 && all[2]?.state !== 'starting')
      assert.deepInclude(now[2], { cause: 'now', state: 'nothing', reason: 'No new pull requests to review.' })
    }).pipe(Effect.provide(clock.on(runtime(':memory:', {}, { automations: clock.options, connectors: fakeConnectors({ github }) }))))
  })

  it.live('end a review whose lead the person stopped from the composer, once nothing has come of it for as long as it may work', () => {
    const clock = clockAt('2026-10-21T07:59:00Z')
    const { at, github } = withOneToReview()
    // A lead that works on until it is stopped, kept to five minutes.
    const review: AutomationDefinition = { ...REVIEW, prompt: 'Review the new pull requests. [lead:hang-once]', minutes: 5 }
    return Effect.gen(function* () {
      const automations = yield* Automations
      const instance = yield* Instance
      const sql = yield* SqlClient.SqlClient
      const projectId = yield* openedOn(at.working)
      const automationId = yield* automations.make({ projectId, definition: review, on: true, actorId: instance.personId })
      clock.set('2026-10-21T08:00:05Z')
      const rows = yield* until(occurrencesOf(automationId), (all) => all[1]?.state === 'running')
      const taskId = rows[1]?.taskId ?? ''
      const [thread] = yield* sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${taskId} AND kind = 'task'`
      const threadId = thread?.id ?? ''
      const lastTurn = sql<{ state: string }>`
        SELECT state FROM turn_deliveries WHERE thread_id = ${threadId} ORDER BY requested_at DESC, rowid DESC LIMIT 1`
      yield* until(lastTurn, (turns) => turns[0]?.state === 'delivered')
      // The composer's Stop: its turn ends, and its session waits for what the person says next.
      yield* (yield* Sessions).interrupt(threadId)
      yield* until(lastTurn, (turns) => turns[0]?.state === 'interrupted')
      // Theirs to carry on for now: its run still goes.
      yield* Effect.sleep('500 millis')
      assert.strictEqual((yield* occurrencesOf(automationId))[1]?.state, 'running')
      // Nothing said since, as if for ten minutes: its run is over, and failed.
      yield* sql`
        UPDATE turn_deliveries SET ended_at = ${new Date(clock.now() - 10 * 60_000).toISOString()} WHERE thread_id = ${threadId}`
      const stopped = yield* until(occurrencesOf(automationId), (all) => all[1]?.state === 'failed')
      assert.strictEqual(stopped[1]?.reason, 'Its review was stopped before its lead drafted one.')
      // Run now isn't refused as if it still went.
      yield* automations.runNow(automationId, instance.personId)
      const now = yield* until(occurrencesOf(automationId), (all) => all.length === 3 && all[2]?.state !== 'starting')
      assert.deepInclude(now[2], { cause: 'now', state: 'nothing', reason: 'No new pull requests to review.' })
    }).pipe(Effect.provide(clock.on(runtime(':memory:', {}, { automations: clock.options, connectors: fakeConnectors({ github }) }))))
  })

  it.live('read on past a listing that had more, to find the oldest a teammate opened; and say when it couldn’t read to the end', () => {
    const clock = clockAt('2026-10-21T07:59:00Z')
    const { at, github, byTeammate } = withOneToReview()
    // Newer than the teammate's #1, three of the person's own: a listing of two at a time doesn't reach #1 at first.
    for (const title of ['Mine two', 'Mine three', 'Mine four'])
      github.addPullRequest({ path: ['meridian', 'api'], title, author: 'you', body: '' })
    return Effect.gen(function* () {
      const automations = yield* Automations
      const instance = yield* Instance
      const projectId = yield* openedOn(at.working)
      const automationId = yield* automations.make({ projectId, definition: REVIEW, on: true, actorId: instance.personId })
      clock.set('2026-10-21T08:00:05Z')
      const rows = yield* until(occurrencesOf(automationId), (all) => all.length === 2 && all[1]?.taskId !== null)
      // It read them all, and its review says what it found: the listing says nothing of its own.
      assert.deepInclude(rows[0], { subject: '', state: 'made', reason: null })
      assert.strictEqual(rows[1]?.subjectTitle, '#1 Send back')
      // That review stopped, its run is over.
      const taskId = rows[1]?.taskId ?? ''
      yield* leadStarted(taskId)
      yield* (yield* Tasks).stop({ envelope: yield* Runtime.envelope('task.stop', { taskId }), taskId })
      yield* until(occurrencesOf(automationId), (all) => all[1]?.state === 'failed')
      // Four more of the person's: five listings of two read back only so far, and the run says so.
      for (const title of ['Mine five', 'Mine six', 'Mine seven', 'Mine eight'])
        github.addPullRequest({ path: ['meridian', 'api'], title, author: 'you', body: '' })
      clock.set('2026-10-22T08:00:05Z')
      const next = yield* until(occurrencesOf(automationId), (all) => all.length === 3)
      assert.strictEqual(next[2]?.state, 'nothing')
      assert.match(
        next[2]?.reason ?? '',
        /^No new pull requests among those looked at\. Only the 6 latest open pull requests of \S+ were looked at; older ones weren’t\.$/,
      )
      // A new one by the teammate, the newest: a run that starts its review still says what it couldn't read.
      byTeammate('Their nine', 'nine.ts', 'export const nine = 9\n')
      clock.set('2026-10-23T08:00:05Z')
      const third = yield* until(occurrencesOf(automationId), (all) => all.length === 5 && all[4]?.taskId !== null)
      const short = /^Found 1 new pull request\. Only the 6 latest open pull requests of \S+ were looked at; older ones weren’t\.$/
      assert.match(third[3]?.reason ?? '', short)
      // Its history shows that listing beside the review it started; the first morning's, which had nothing to add, it doesn't.
      const view = yield* automations.read(automationId)
      assert.deepStrictEqual(
        view.runs.map((one) => [one.state, one.subject]),
        [
          ['running', '#9 Their nine'],
          ['made', null],
          ['nothing', null],
          ['failed', '#1 Send back'],
        ],
      )
      assert.match(view.runs[1]?.reason ?? '', short)
    }).pipe(
      Effect.provide(
        clock.on(runtime(':memory:', {}, { automations: { ...clock.options, listed: 2 }, connectors: fakeConnectors({ github }) })),
      ),
    )
  })
})
