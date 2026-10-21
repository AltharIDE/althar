import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AutomationCard, AutomationDefinition } from '@althar/contracts'
import { makeFakeService } from '@althar/connectors/testing'
import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { AutomationRefused, Automations } from '../src/Automations'
import type { AutomationOptions } from '../src/Config'
import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Reviews } from '../src/Reviews'
import * as Runtime from '../src/Runtime'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, fakeConnectors, HOST, hosted, repository, runtime, until } from './support'

/*
 * Automations (docs/plans/automations.md): work that starts by itself on a
 * schedule, on this Mac. Each slot runs once, as an ordinary task; one the
 * Mac slept through runs once on waking, within its window, or is missed;
 * one that can't start now is skipped and says why; three failures in a row
 * pause it. The clock here is the test's, in London.
 */

const LONDON = 'Europe/London'

/** A clock the test moves, and the automations read by it, looked at often, with no wait after waking and no stagger. */
const clockAt = (iso: string) => {
  const now = { at: Date.parse(iso) }
  const options: AutomationOptions = {
    now: () => now.at,
    zone: () => LONDON,
    tick: Duration.millis(100),
    settle: Duration.zero,
    stagger: false,
  }
  return { now, options, set: (to: string) => void (now.at = Date.parse(to)) }
}

/** Release notes every weekday at 9:00: a report, nothing outside this Mac. */
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
      const [ran] = yield* until(occurrencesOf(automationId), (rows) => rows[0]?.state === 'made', Duration.seconds(20))
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
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { automations: clock.options })))))
  })

  it.live('run a slot the Mac slept through once on waking, within its window, and miss one past it; never every slot', () => {
    const clock = clockAt('2026-10-20T07:00:00Z')
    return Effect.gen(function* () {
      const automations = yield* Automations
      const instance = yield* Instance
      const sql = yield* SqlClient.SqlClient
      const projectId = yield* opened
      const automationId = yield* automations.make({ projectId, definition: NOTES, on: true, actorId: instance.personId })
      // Asleep from Tuesday 8:00 to Wednesday 13:00: Wednesday's 9:00 runs once, Tuesday's never.
      clock.set('2026-10-21T12:00:00Z')
      const [ran] = yield* until(occurrencesOf(automationId), (rows) => rows[0]?.state === 'made', Duration.seconds(20))
      assert.strictEqual(ran?.slot, '2026-10-21T09:00')
      const [task] = yield* sql<{ description: string }>`SELECT description FROM tasks WHERE id = ${ran?.taskId ?? ''}`
      assert.include(task?.description, 'It was due at 9:00; it is 13:00, since the Mac was asleep or Althar was closed.')
      // Asleep until Thursday 21:30: Thursday's 9:00 is past its window, so it is missed, and says so.
      clock.set('2026-10-22T20:30:00Z')
      const rows = yield* until(occurrencesOf(automationId), (all) => all.length === 2)
      assert.deepInclude(rows[1], {
        slot: '2026-10-22T09:00',
        state: 'missed',
        reason: 'Missed: the Mac was asleep, or Althar closed, at 9:00.',
        taskId: null,
      })
      // One that skips what the Mac slept through skips it.
      yield* automations.change(automationId, { ...NOTES, late: 'skip' }, instance.personId)
      clock.set('2026-10-23T09:30:00Z')
      const later = yield* until(occurrencesOf(automationId), (all) => all.length === 3)
      assert.deepInclude(later[2], { slot: '2026-10-23T09:00', state: 'missed' })
    }).pipe(Effect.provide(runtime(':memory:', {}, { automations: clock.options })))
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
      assert.isNull((yield* automations.read(proposed)).nextAt)
    }).pipe(Effect.provide(runtime(':memory:', {}, { automations: clock.options })))
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
      yield* until(occurrencesOf(automationId), (rows) => rows[0]?.state === 'running', Duration.seconds(20))
      // Thursday's comes while Wednesday's still goes.
      clock.set('2026-10-22T08:00:05Z')
      const rows = yield* until(occurrencesOf(automationId), (all) => all.length === 2)
      assert.deepInclude(rows[1], { slot: '2026-10-22T09:00', state: 'skipped', reason: 'Its last run was still going.' })
      // Run now says so, rather than skipping.
      const refused = yield* Effect.flip(automations.runNow(automationId, instance.personId))
      assert.instanceOf(refused, AutomationRefused)
      assert.strictEqual((refused as AutomationRefused).message, 'Its last run was still going.')

      // Done with it, and every automation paused: Friday's is skipped, saying so; Run now runs it.
      yield* sql`UPDATE automation_occurrences SET state = 'failed', ended_at = ${new Date().toISOString()}, reason = 'Stopped.' WHERE automation_id = ${automationId} AND state = 'running'`
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
    }).pipe(Effect.provide(runtime(':memory:', {}, { automations: clock.options })))
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
      yield* until(occurrencesOf(automationId), (rows) => rows.length === 4 && rows[3]?.state === 'made', Duration.seconds(20))
    }).pipe(Effect.provide(runtime(':memory:', {}, { automations: clock.options })))
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
        assert.deepInclude(card, { state: 'proposed', was: null, ask: null })
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

        yield* automations.turnOn(automationId, instance.personId)
        assert.deepInclude((yield* cards)[0], { state: 'on', nextAt: '2026-10-23T15:00:00.000Z' })

        // A shorter time holds as it is; another day reaches further, so it waits for the person, its card saying what it was.
        assert.match(
          yield* callTool(coordinator, 'change_automation', { automation: 'release notes', minutes: 30 }),
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
      }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { automations: clock.options })))))
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
    }).pipe(Effect.provide(runtime(':memory:', {}, { automations: clock.options, perUse: ['codex'] })))
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
      const [running] = yield* until(occurrencesOf(automationId), (rows) => rows[0]?.state === 'running', Duration.seconds(20))
      yield* until(
        sql<{ n: number }>`
          SELECT count(*) AS n FROM turn_deliveries t JOIN threads h ON h.id = t.thread_id
          WHERE h.task_id = ${running?.taskId ?? ''} AND t.delivered_at IS NOT NULL`,
        (rows) => (rows[0]?.n ?? 0) > 0,
        Duration.seconds(20),
      )
      // Its turns, as if they had gone on for ten minutes.
      yield* sql`
        UPDATE turn_deliveries SET delivered_at = ${new Date(Date.now() - 10 * 60_000).toISOString()}
        WHERE thread_id IN (SELECT id FROM threads WHERE task_id = ${running?.taskId ?? ''})`
      const [stopped] = yield* until(occurrencesOf(automationId), (rows) => rows[0]?.state === 'failed', Duration.seconds(20))
      assert.strictEqual(stopped?.reason, 'Stopped after 5 minutes of work.')
      yield* until(
        sql<{ state: string }>`SELECT state FROM runs WHERE task_id = ${running?.taskId ?? ''}`,
        (rows) => rows[0]?.state === 'suspended',
      )
    }).pipe(Effect.provide(runtime(':memory:', {}, { automations: clock.options })))
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
      }).pipe(Effect.provide(runtime(database, {}, { automations: clock.options })))
      yield* Effect.gen(function* () {
        yield* until(occurrencesOf(made.on), (rows) => rows[0]?.state === 'made', Duration.seconds(20))
        const [failed] = yield* until(occurrencesOf(made.off), (rows) => rows[0]?.state === 'failed')
        assert.strictEqual(failed?.reason, 'Althar stopped before its task started.')
      }).pipe(Effect.provide(runtime(database, {}, { automations: clock.options })))
    })
  })

  it.live(
    'review each new pull request not by the person, one task each; the first waits, and once let post, they are signed with its name',
    () => {
      const clock = clockAt('2026-10-21T07:59:00Z')
      const at = hosted()
      const github = makeFakeService({ pushUrl: () => at.bare })
      github.addRepository(['meridian', 'api'])
      const git = (...args: Array<string>) =>
        execFileSync('git', ['-c', 'user.name=Nine', '-c', 'user.email=nine@althar.test', ...args], { cwd: at.working })
          .toString()
          .trim()
      git('checkout', '-q', '--detach', 'main')
      writeFileSync(join(at.working, 'send.ts'), 'export const sendBack = () => 1\n')
      git('add', '.')
      git('commit', '-q', '-m', 'Send back')
      const head = git('rev-parse', 'HEAD')
      git('checkout', '-q', 'main')
      git('push', '-q', at.bare, `${head}:refs/pull/1/head`)
      github.addPullRequest({ path: ['meridian', 'api'], title: 'Send back', author: 'ninemate', body: '', headSha: head })
      const review: AutomationDefinition = {
        ...NOTES,
        name: 'Morning review',
        prompt: 'Review the new pull requests.',
        lead: { agentId: 'claude-code', model: null },
        work: { kind: 'review' },
      }
      return Effect.gen(function* () {
        const automations = yield* Automations
        const instance = yield* Instance
        const reviews = yield* Reviews
        const sql = yield* SqlClient.SqlClient
        const connections = yield* Connections
        yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
        const projects = yield* Projects
        const projectId = (yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: at.working })).projectId
        const automationId = yield* automations.make({ projectId, definition: review, on: true, actorId: instance.personId })
        clock.set('2026-10-21T08:00:05Z')
        const rows = yield* until(occurrencesOf(automationId), (all) => all.length === 2 && all[1]?.taskId !== null, Duration.seconds(20))
        assert.deepInclude(rows[0], { subject: '', state: 'made', reason: 'Found 1 new pull request.' })
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
      }).pipe(Effect.provide(runtime(':memory:', {}, { automations: clock.options, connectors: fakeConnectors({ github }) })))
    },
  )
})
