import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import { Ids } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Exit, Layer, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { NoChangeToOpen } from '../src/errors'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Runs } from '../src/Runs'
import { timestamp } from '../src/records'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { fakeConnectors, HOST, hosted, runtime, until } from './support'

const git = (cwd: string, ...args: Array<string>) => execFileSync('git', args, { cwd }).toString().trim()
const as = ['-c', 'user.name=Test', '-c', 'user.email=test@althar.test']

const runtimeWith = (github: FakeService) =>
  Queries.layer.pipe(
    Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }), listenEvery: Duration.hours(1) })),
  )

const interrupted = (working: string, bare: string, github: FakeService, later = false) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const changes = yield* Changes
    const instance = yield* Instance
    yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    const coordinator = yield* Coordinator
    const threadId = yield* coordinator.thread(project.projectId)
    const body = 'Add a retry. [coordinator:plan] [lead:finish] [lead:edit] [review:pass]'
    yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
    const queries = yield* Queries
    const cards = Effect.map(queries.coordinator(project.projectId), (snapshot) =>
      snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : [])),
    )
    const [card] = yield* until(cards, (all) => all[0]?.phase === 'ready' && all[0].change !== null)
    assert.isDefined(card)
    const sessions = yield* Sessions
    yield* until(
      sql<{ state: string }>`SELECT state FROM runs WHERE task_id = ${card!.taskId} ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      (rows) => rows[0]?.state === 'succeeded',
    )
    yield* until(sessions.busy(card!.threadId), (busy) => !busy)
    const [workspace] = yield* sql<{ id: string; path: string; branch: string }>`
      SELECT id, path, branch FROM workspaces WHERE task_id = ${card!.taskId}`
    const [run] = yield* sql<{ id: string }>`SELECT id FROM runs WHERE task_id = ${card!.taskId} ORDER BY created_at, rowid LIMIT 1`
    assert.isDefined(workspace)
    assert.isDefined(run)
    const { id, path, branch } = workspace!

    // The old pull request was squash-merged, so its follow-up must cherry-pick onto the host's new main.
    const clone = mkdtempSync(join(tmpdir(), 'althar-ship-merge-'))
    git(working, 'clone', '-q', bare, clone)
    git(clone, ...as, 'merge', '-q', '--squash', `origin/${branch}`)
    git(clone, ...as, 'commit', '-q', '-m', 'Merge the first pull request')
    git(clone, 'push', '-q', 'origin', 'main')
    github.mergeByHand(1)
    yield* changes.refresh(card!.taskId)
    yield* until(cards, (all) => all[0]?.phase === 'settled')

    // A real crash leaves no old live branch follower. Keep the synthetic move and its recovery publication under
    // the same task lock, so a delayed original-turn callback cannot mistake this injected switch for the lead's.
    const move = Effect.gen(function* () {
      const previous = git(path, 'rev-parse', 'HEAD')
      writeFileSync(join(path, 'accepted.txt'), 'The code accepted for this Ship.\n')
      git(path, 'add', 'accepted.txt')
      git(path, ...as, 'commit', '-q', '-m', 'Accepted change')
      const accepted = git(path, 'rev-parse', 'HEAD')
      writeFileSync(join(path, 'later.txt'), 'Newer work waiting for the next Ship.\n')
      git(path, 'add', 'later.txt')
      git(path, ...as, 'commit', '-q', '-m', 'Later change')
      const original = git(path, 'rev-parse', 'HEAD')
      const incomplete = `${branch}-2`

      // Model the durable crash window: intent saved, git moved, workspace transaction not committed.
      yield* sql`UPDATE runs SET parameters = json_set(parameters, '$.ships', json(${JSON.stringify({
        from: { [path]: previous },
        heads: { [id]: accepted },
        rebranching: { [id]: { fromBranch: branch, fromHead: original, branch: incomplete } },
      })})) WHERE id = ${run!.id}`
      yield* sql`UPDATE workspaces SET held_at = ${yield* timestamp} WHERE id = ${id}`
      yield* sql`UPDATE tasks SET state = 'open' WHERE id = ${card!.taskId}`
      git(path, 'fetch', '-q', bare, 'main')
      const onto = git(path, 'rev-parse', 'FETCH_HEAD')
      git(path, 'checkout', '-q', '-b', incomplete, 'FETCH_HEAD')
      git(path, ...as, 'cherry-pick', accepted, original)
      if (later) {
        writeFileSync(join(path, 'after-interruption.txt'), 'Committed on the new task branch after its switch.\n')
        git(path, 'add', 'after-interruption.txt')
        git(path, ...as, 'commit', '-q', '-m', 'Work after interrupted switch')
      }
      const incompleteHead = git(path, 'rev-parse', 'HEAD')
      const input = {
        projectId: Schema.decodeUnknownSync(Ids.project.schema)(project.projectId),
        taskId: card!.taskId,
        runId: run!.id,
        end: 'draft' as const,
        again: true,
        ships: true,
        heads: { [id]: accepted },
      }
      return { changes, input, id, path, branch, accepted, original, incomplete, incompleteHead, onto }
    })
    return { changes, taskId: card!.taskId, move }
  })

const inCrashWindow = <A, E, R>(
  fixture: Effect.Success<ReturnType<typeof interrupted>>,
  use: (task: Effect.Success<Effect.Success<ReturnType<typeof interrupted>>['move']>) => Effect.Effect<A, E, R>,
) => fixture.changes.exclusive(fixture.taskId, Effect.flatMap(fixture.move, use))

describe('an interrupted Ship branch move', () => {
  it.live.each(['legacy', 'preserved source'] as const)(
    'restores complete work after a %s replacement intent crashed before checkout',
    (journal) => {
      const { working, bare } = hosted()
      const github = makeFakeService({ pushUrl: () => bare })
      github.addRepository(['meridian', 'api'])
      return Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const fixture = yield* interrupted(working, bare, github, true)
        return yield* inCrashWindow(fixture, (task) =>
          Effect.gen(function* () {
            const absent = `${task.branch}-3`
            // Recovery saved the next destination, then stopped before creating it. The complete tail is still on -2.
            yield* sql`UPDATE runs SET parameters = json_set(parameters, ${`$.ships.rebranching."${task.id}"`}, json(${JSON.stringify({
              fromBranch: task.branch,
              fromHead: task.original,
              branch: absent,
              onto: task.onto,
              copies: [task.accepted, task.original, task.incompleteHead],
              carry: [task.incompleteHead],
              ...(journal === 'preserved source' ? { recoveryBranch: task.incomplete } : {}),
            })})) WHERE id = ${task.input.runId}`
            git(task.path, 'checkout', '-q', task.branch)
            const clone = mkdtempSync(join(tmpdir(), 'althar-conflicting-main-'))
            git(working, 'clone', '-q', bare, clone)
            writeFileSync(join(clone, 'accepted.txt'), 'A conflicting change from elsewhere.\n')
            git(clone, 'add', 'accepted.txt')
            git(clone, ...as, 'commit', '-q', '-m', 'Main changed meanwhile')
            git(clone, 'push', '-q', 'origin', 'main')
            const failure = yield* Effect.flip(task.changes.publish(task.input))
            assert.instanceOf(failure, NoChangeToOpen)
            assert.strictEqual((failure as NoChangeToOpen).why, 'conflicts')
            assert.strictEqual(git(task.path, 'symbolic-ref', '--short', 'HEAD'), task.incomplete)
            assert.strictEqual(git(task.path, 'status', '--porcelain'), '')
            assert.strictEqual(
              readFileSync(join(task.path, 'after-interruption.txt'), 'utf8'),
              'Committed on the new task branch after its switch.\n',
            )
            assert.strictEqual(readFileSync(join(task.path, 'later.txt'), 'utf8'), 'Newer work waiting for the next Ship.\n')
            assert.lengthOf(github.changes, 1)
            const [saved] = yield* sql<{ branch: string; recoveryBranch: string }>`
            SELECT json_extract(parameters, ${`$.ships.rebranching."${task.id}".branch`}) AS branch,
              json_extract(parameters, ${`$.ships.rebranching."${task.id}".recoveryBranch`}) AS recovery_branch
            FROM runs WHERE id = ${task.input.runId}`
            assert.deepStrictEqual([saved?.branch, saved?.recoveryBranch], [task.incomplete, task.incomplete])

            // Once the conflicting main change is removed, the same saved request can finish without losing or publishing its tail.
            git(clone, 'rm', '-q', 'accepted.txt')
            git(clone, ...as, 'commit', '-q', '-m', 'Resolve the conflicting main change')
            git(clone, 'push', '-q', 'origin', 'main')
            yield* task.changes.publish(task.input)
            assert.strictEqual(
              readFileSync(join(task.path, 'after-interruption.txt'), 'utf8'),
              'Committed on the new task branch after its switch.\n',
            )
            assert.notInclude(git(bare, 'ls-tree', '--name-only', github.changes[1]!.source), 'after-interruption.txt')
            assert.strictEqual((yield* task.changes.aheadOfOpen(task.input.taskId))[0]?.count, 2)
          }),
        )
      }).pipe(Effect.provide(runtimeWith(github)))
    },
  )

  it.live.each(['legacy', 'journalled'] as const)('preserves a later revert and reapplication after a %s branch move', (journal) => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const fixture = yield* interrupted(working, bare, github)
      return yield* inCrashWindow(fixture, (task) =>
        Effect.gen(function* () {
          git(task.path, ...as, 'revert', '--no-edit', task.accepted)
          git(task.path, ...as, 'cherry-pick', task.accepted)
          const before = git(task.path, 'rev-parse', 'HEAD^{tree}')
          if (journal === 'journalled') {
            const sql = yield* SqlClient.SqlClient
            yield* sql`UPDATE runs SET parameters = json_set(parameters, ${`$.ships.rebranching."${task.id}".onto`}, ${task.onto},
              ${`$.ships.rebranching."${task.id}".copies`}, json(${JSON.stringify([task.accepted, task.original])})) WHERE id = ${task.input.runId}`
          }
          yield* task.changes.publish(task.input)
          assert.strictEqual(git(task.path, 'rev-parse', 'HEAD^{tree}'), before)
          assert.strictEqual(readFileSync(join(task.path, 'accepted.txt'), 'utf8'), 'The code accepted for this Ship.\n')
          assert.strictEqual(readFileSync(join(task.path, 'later.txt'), 'utf8'), 'Newer work waiting for the next Ship.\n')
          const next = github.changes[1]
          assert.isDefined(next)
          assert.strictEqual(git(bare, 'show', `${next!.source}:accepted.txt`), 'The code accepted for this Ship.')
          assert.notInclude(git(bare, 'ls-tree', '--name-only', next!.source), 'later.txt')
          assert.strictEqual((yield* task.changes.aheadOfOpen(task.input.taskId))[0]?.count, 3)
        }),
      )
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live.each(['legacy', 'journalled before another interruption'] as const)('keeps %s later work active for the next Ship', (journal) => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const fixture = yield* interrupted(working, bare, github, true)
      const task = yield* inCrashWindow(fixture, (task) =>
        Effect.gen(function* () {
          if (journal !== 'legacy') {
            // Another interruption after the recovered tail was saved, but before a replacement branch was made.
            yield* sql`UPDATE runs SET parameters = json_set(parameters, ${`$.ships.rebranching."${task.id}".onto`}, ${task.onto},
              ${`$.ships.rebranching."${task.id}".copies`}, json(${JSON.stringify([task.accepted, task.original])}),
              ${`$.ships.rebranching."${task.id}".carry`}, json(${JSON.stringify([task.incompleteHead])})) WHERE id = ${task.input.runId}`
            git(task.path, 'checkout', '-q', task.branch)
          }
          yield* task.changes.publish(task.input)
          return task
        }),
      )
      const next = github.changes[1]
      assert.isDefined(next)
      assert.strictEqual(next!.source, `${task.branch}-3`)
      assert.strictEqual(
        readFileSync(join(task.path, 'after-interruption.txt'), 'utf8'),
        'Committed on the new task branch after its switch.\n',
      )
      assert.strictEqual(readFileSync(join(task.path, 'later.txt'), 'utf8'), 'Newer work waiting for the next Ship.\n')
      assert.notInclude(git(bare, 'ls-tree', '--name-only', next!.source), 'after-interruption.txt')
      assert.notInclude(git(bare, 'ls-tree', '--name-only', next!.source), 'later.txt')
      assert.strictEqual(git(task.path, 'rev-parse', task.branch), task.original)
      assert.strictEqual(git(task.path, 'rev-parse', task.incomplete), task.incompleteHead)
      const [saved] = yield* sql<{ head: string }>`
        SELECT json_extract(parameters, ${`$.ships.heads."${task.id}"`}) AS head FROM runs WHERE id = ${task.input.runId}`
      yield* task.changes.releaseHolds(task.input.taskId, 'shipped', undefined, { [task.id]: saved!.head })
      assert.strictEqual((yield* task.changes.aheadOfOpen(task.input.taskId))[0]?.count, 2)
      assert.lengthOf(yield* task.changes.holds(task.input.taskId), 1)

      // Discoverable on the active branch, the recovered work ships only on a fresh request, with the original later work.
      yield* (yield* Runs).ship({ envelope: yield* Runtime.envelope('task.ship', {}), taskId: task.input.taskId })
      yield* until(task.changes.aheadOfOpen(task.input.taskId), (waiting) => waiting.length === 0)
      assert.strictEqual(git(bare, 'show', `${next!.source}:after-interruption.txt`), 'Committed on the new task branch after its switch.')
      assert.strictEqual(git(bare, 'show', `${next!.source}:later.txt`), 'Newer work waiting for the next Ship.')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('retries from its saved source without publishing the newer local tail or deleting either recovery branch', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const fixture = yield* interrupted(working, bare, github)
      return yield* inCrashWindow(fixture, (task) =>
        Effect.gen(function* () {
          yield* task.changes.publish(task.input)
          const next = github.changes[1]
          assert.isDefined(next)
          assert.strictEqual(next!.source, `${task.branch}-3`)
          assert.strictEqual(git(bare, 'show', `${next!.source}:accepted.txt`), 'The code accepted for this Ship.')
          assert.notInclude(git(bare, 'ls-tree', '--name-only', next!.source), 'later.txt')
          assert.strictEqual(readFileSync(join(task.path, 'later.txt'), 'utf8'), 'Newer work waiting for the next Ship.\n')
          assert.strictEqual(git(task.path, 'rev-parse', task.branch), task.original)
          assert.strictEqual(git(task.path, 'rev-parse', task.incomplete), task.incompleteHead)
          const [saved] = yield* sql<{ branch: string; intent: string | null; head: string }>`
            SELECT w.branch, json_extract(r.parameters, ${`$.ships.rebranching."${task.id}"`}) AS intent,
              json_extract(r.parameters, ${`$.ships.heads."${task.id}"`}) AS head
            FROM workspaces w JOIN runs r ON r.id = ${task.input.runId} WHERE w.id = ${task.id}`
          assert.strictEqual(saved?.branch, next!.source)
          assert.isNull(saved?.intent)
          assert.strictEqual(git(task.path, 'rev-parse', `${saved!.head}^{tree}`), git(bare, 'rev-parse', `${next!.source}^{tree}`))
        }),
      )
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('refuses a dirty interrupted worktree while preserving its intent and every local edit', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const fixture = yield* interrupted(working, bare, github)
      return yield* inCrashWindow(fixture, (task) =>
        Effect.gen(function* () {
          writeFileSync(join(task.path, 'accepted.txt'), 'An edit made after the interruption.\n')
          const result = yield* Effect.exit(task.changes.publish(task.input))
          assert.isTrue(Exit.isFailure(result))
          if (Exit.isFailure(result)) assert.include(String(result.cause), 'NoChangeToOpen')
          assert.lengthOf(github.changes, 1)
          assert.strictEqual(git(task.path, 'symbolic-ref', '--short', 'HEAD'), task.incomplete)
          assert.strictEqual(readFileSync(join(task.path, 'accepted.txt'), 'utf8'), 'An edit made after the interruption.\n')
          assert.strictEqual(git(task.path, 'rev-parse', task.branch), task.original)
          const [saved] = yield* sql<{ intent: string | null }>`
            SELECT json_extract(parameters, ${`$.ships.rebranching."${task.id}"`}) AS intent FROM runs WHERE id = ${task.input.runId}`
          assert.isNotNull(saved?.intent)
        }),
      )
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})
