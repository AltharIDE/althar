import { execFileSync } from 'node:child_process'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { fakeConnectors, HOST, hosted, runtime, until } from './support'

/*
 * A fix after a review is checked only where it needs it (a task is a
 * conversation plus parts, "Fixes are checked by the same reviewer, only
 * where they need it"), never by another whole review: a tiny one (ten lines
 * or fewer, all in the files its findings named) isn't read again, and the
 * pull request names it, its seal kept; a bigger one gets one short check by
 * the same reviewer, of the fixes alone; and a finding that check reopened
 * goes back to the lead once, that second fix not read again.
 */

const runtimeWith = (github: FakeService) =>
  Queries.layer.pipe(
    Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }), listenEvery: Duration.hours(1) })),
  )

const git = (cwd: string, ...args: Array<string>) => execFileSync('git', args, { cwd }).toString().trim()

const onGitHub = () => {
  const { working, bare } = hosted()
  const github = makeFakeService({ pushUrl: () => bare })
  github.addRepository(['meridian', 'api'])
  git(working, 'config', 'user.name', 'Fake')
  git(working, 'config', 'user.email', 'fake@althar.test')
  return { working, github }
}

const cards = (projectId: string) =>
  Effect.gen(function* () {
    const snapshot = yield* Effect.orDie((yield* Queries).coordinator(projectId))
    return snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : []))
  })

const graphOf = (threadId: string) =>
  Effect.gen(function* () {
    const snapshot = yield* Effect.orDie((yield* Queries).thread(threadId))
    return snapshot.task.graph ?? []
  })

const shape = (
  rounds: ReadonlyArray<{ readonly steps: ReadonlyArray<{ readonly key: string; readonly iteration: number; readonly state: string }> }>,
) => rounds.map((round) => round.steps.map((step) => `${step.key}${step.iteration}:${step.state}`))

/** A planned task, reviewed as `markers` say, whose draft pull request opened: ready. */
const reviewed = (working: string, markers: string) =>
  Effect.gen(function* () {
    const instance = yield* Instance
    yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    const coordinator = yield* Coordinator
    const threadId = yield* coordinator.thread(project.projectId)
    const body = `Add a retry. [coordinator:plan] [lead:finish] [lead:edit] ${markers}`
    yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
    const [ready] = yield* until(cards(project.projectId), (all) => all[0]?.phase === 'ready' && all[0].change !== null)
    return ready ?? assert.fail('no card')
  })

/** What a reviewer was told, on the task's review thread, in order. */
const toldReviewer = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return (yield* sql<{ body: string }>`
      SELECT i.body FROM user_inputs i JOIN threads t ON t.id = i.thread_id
      WHERE t.task_id = ${taskId} AND t.kind = 'step' AND t.node_key = 'review' ORDER BY i.sequence`).map((row) => row.body)
  })

describe('checking a fix after a review', () => {
  it.live('reads a tiny fix in the file its finding named no more: the task goes on to its end, sealed, the fix named', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const card = yield* reviewed(working, '[review:findings] [lead:fix-tiny]')
      const [round] = yield* graphOf(card.threadId)
      assert.deepStrictEqual(shape(round === undefined ? [] : [round]), [
        ['implement0:done', 'review0:done', 'settle0:done', 'publish0:done'],
      ])
      assert.isFalse((yield* toldReviewer(card.taskId)).some((body) => body.startsWith('A check of the fixes')))
      // Its pull request keeps the seal the review gave, and its folded review names the fix no one read again.
      const body = github.changes[0]?.body ?? ''
      assert.include(body, '<picture>')
      assert.include(body, '**Fixed after it, too small to read again**')
      assert.include(body, '<code>README.md</code>')
      assert.notInclude(body, 'the last fixes weren’t reviewed')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('checks a tiny fix that left a finding open, and leaves what is still open to the person', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const instance = yield* Instance
      yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
      const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      const coordinator = yield* Coordinator
      const threadId = yield* coordinator.thread(project.projectId)
      // Two findings, one in README.md; its lead fixes a line of README.md and settles only the first.
      const body = 'Add a retry. [coordinator:plan] [lead:finish] [lead:edit] [review:always] [lead:fix-tiny] [lead:leave-open]'
      yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
      const [card] = yield* until(cards(project.projectId), (all) => all[0]?.phase === 'waiting')
      const [round] = yield* graphOf(card?.threadId ?? '')
      assert.deepStrictEqual(shape(round === undefined ? [] : [round]), [
        ['implement0:done', 'review0:done', 'settle0:done', 'review1:done', 'settle1:done', 'publish0:next'],
      ])
      assert.isTrue((yield* toldReviewer(card?.taskId ?? '')).some((body) => body.startsWith('A check of the fixes')))
      // Nothing published: a finding still open is the person's.
      assert.lengthOf(github.changes, 0)
      const sql = yield* SqlClient.SqlClient
      const [stuck] = yield* sql<{ payload: string }>`SELECT payload FROM attention_requests WHERE kind = 'stuck'`
      assert.isAbove(Number((JSON.parse(stuck?.payload ?? '{}') as { open?: number }).open), 0)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('checks a tiny fix that set its finding aside with no reason, and names no fix as too small to read', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const card = yield* reviewed(working, '[review:findings] [lead:fix-tiny] [lead:decline-quietly]')
      const [round] = yield* graphOf(card.threadId)
      assert.deepStrictEqual(shape(round === undefined ? [] : [round]), [
        ['implement0:done', 'review0:done', 'settle0:done', 'review1:done', 'publish0:done'],
      ])
      // The check read it, so its pull request says nothing went unread.
      assert.isTrue((yield* toldReviewer(card.taskId)).some((body) => body.startsWith('A check of the fixes')))
      assert.notInclude(github.changes[0]?.body ?? '', 'too small to read again')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('checks a bigger fix once, by the same reviewer, reading the fixes alone', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const card = yield* reviewed(working, '[review:findings]')
      const [round] = yield* graphOf(card.threadId)
      assert.deepStrictEqual(shape(round === undefined ? [] : [round]), [
        ['implement0:done', 'review0:done', 'settle0:done', 'review1:done', 'publish0:done'],
      ])
      const who = new Map(round?.steps.map((step) => [`${step.key}${step.iteration}`, step.agentId]))
      assert.strictEqual(who.get('review1'), who.get('review0'))
      // Told it checks the fixes against its findings, from the copy it read before.
      const check = (yield* toldReviewer(card.taskId)).find((body) => body.startsWith('A check of the fixes, not another review.'))
      assert.isDefined(check)
      assert.match(check ?? '', /what the fixes changed is `git diff [0-9a-f]{12}` in it/)
      assert.include(check, "Don't review the rest of the change again.")
      assert.notInclude(github.changes[0]?.body ?? '', 'the last fixes weren’t reviewed')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('gives a finding the check reopened back to its lead once, and reads that fix no more', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      // Its reviewer finds something every time it looks.
      const card = yield* reviewed(working, '[review:always]')
      const [round] = yield* graphOf(card.threadId)
      assert.deepStrictEqual(shape(round === undefined ? [] : [round]), [
        ['implement0:done', 'review0:done', 'settle0:done', 'review1:done', 'settle1:done', 'publish0:done'],
      ])
      // The second fix went out as it was: the pull request says no pass read it.
      assert.include(github.changes[0]?.body ?? '', 'the last fixes weren’t reviewed')
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})
