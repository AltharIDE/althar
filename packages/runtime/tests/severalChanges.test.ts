import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Runs } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { callTool, fakeConnectors, HOST, hosted, items, runtime, until } from './support'

/*
 * A task holds as many changes as it needs (a task is a conversation plus
 * parts): another change starts at once, on its own branch, in a worktree of
 * its own beside the task's first; it ships, and opens its pull request, on
 * its own; and a merge ends only its own change: the task settles once all
 * of them are done.
 */

const runtimeWith = (github: FakeService) =>
  Queries.layer.pipe(
    Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }), listenEvery: Duration.hours(1) })),
  )

const git = (cwd: string, ...args: Array<string>) => execFileSync('git', args, { cwd }).toString().trim()

const squashMerge = (bare: string, branch: string) => {
  const clone = mkdtempSync(join(tmpdir(), 'althar-merge-'))
  execFileSync('git', ['clone', '-q', bare, clone])
  const as = ['-c', 'user.name=Host', '-c', 'user.email=host@althar.test']
  git(clone, ...as, 'merge', '-q', '--squash', `origin/${branch}`)
  git(clone, ...as, 'commit', '-q', '-m', `Squashed ${branch}`)
  git(clone, 'push', '-q', 'origin', 'main')
}

const onGitHub = () => {
  const { working, bare } = hosted()
  const github = makeFakeService({ pushUrl: () => bare })
  github.addRepository(['meridian', 'api'])
  git(working, 'config', 'user.name', 'Fake')
  git(working, 'config', 'user.email', 'fake@althar.test')
  return { working, bare, github }
}

const cards = (projectId: string) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    const snapshot = yield* Effect.orDie(queries.coordinator(projectId))
    return snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : []))
  })

/** A planned task whose lead did its part and whose draft pull request opened, with no review. */
const opened = (working: string) =>
  Effect.gen(function* () {
    const connections = yield* Connections
    const instance = yield* Instance
    yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const projects = yield* Projects
    const coordinator = yield* Coordinator
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    const threadId = yield* coordinator.thread(project.projectId)
    const body = 'Add a retry. [coordinator:plan] [coordinator:plan-no-review] [lead:finish] [lead:edit]'
    yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
    const [ready] = yield* until(cards(project.projectId), (all) => all[0]?.phase === 'ready' && all[0].change !== null)
    const card = ready ?? assert.fail('no card')
    yield* until(
      Effect.flatMap(Sessions, (sessions) => sessions.busy(card.threadId)),
      (busy) => !busy,
    )
    const sql = yield* SqlClient.SqlClient
    const [lead] = yield* sql<{ id: string }>`
      SELECT id FROM provider_sessions WHERE thread_id = ${card.threadId} ORDER BY started_at DESC LIMIT 1`
    const [first] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${card.taskId}`
    return {
      projectId: project.projectId,
      taskId: card.taskId,
      threadId: card.threadId,
      path: first?.path ?? '',
      lead: {
        role: 'lead' as const,
        projectId: project.projectId,
        threadId: card.threadId,
        sessionId: lead?.id ?? '',
        taskId: card.taskId,
      },
    }
  })

const workspacesOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ id: string; name: string | null; branch: string; path: string; toward: string | null; state: string }>`
      SELECT id, name, branch, path, toward, state FROM workspaces WHERE task_id = ${taskId} ORDER BY created_at, rowid`
  })

/** What the person says to the task's lead, and its turn ended. */
const say = (threadId: string, body: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    const sql = yield* SqlClient.SqlClient
    const before = (yield* sql<{ n: number }>`SELECT count(*) AS n FROM turn_deliveries WHERE thread_id = ${threadId}`)[0]?.n ?? 0
    yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', { threadId, body }), threadId, body })
    yield* until(
      sql<{ state: string }>`SELECT state FROM turn_deliveries WHERE thread_id = ${threadId}`,
      (rows) => rows.length > before && rows.every((row) => row.state !== 'pending' && row.state !== 'delivered'),
    )
  })

/** A task whose first change has its pull request, with a change stacked on it whose own pull request Ship opened, into its branch. */
const stacked = (working: string, github: FakeService) =>
  Effect.gen(function* () {
    const task = yield* opened(working)
    yield* callTool(task.lead, 'start_change', { name: 'Lane heights', on: 'althar/add-a-retry' })
    const [, above] = yield* workspacesOf(task.taskId)
    const path = above?.path ?? ''
    writeFileSync(join(path, 'lanes.txt'), 'taller\n')
    git(path, 'add', 'lanes.txt')
    git(path, '-c', 'user.name=Fake', '-c', 'user.email=fake@althar.test', 'commit', '-q', '-m', 'Taller lanes')
    yield* (yield* Runs).ship({ envelope: yield* Runtime.envelope('task.ship', { taskId: task.taskId }), taskId: task.taskId })
    yield* until(
      Effect.sync(() => github.changes.length),
      (count) => count === 2,
    )
    return { ...task, above: path, url: github.changes[1]?.url ?? '' }
  })

describe('a task with several changes', () => {
  it.live('starts another change on its own branch and worktree, ships it as its own pull request, and settles once both merge', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working)
      const said = yield* callTool(task.lead, 'start_change', { name: 'Lane heights' })
      assert.match(said, /^Started a change of [^,]+, “Lane heights”: its worktree is /)

      // Its own row, beside the first, on a branch of its own named for it, working toward what the task does.
      const [first, second] = yield* workspacesOf(task.taskId)
      assert.strictEqual(second?.name, 'Lane heights')
      assert.strictEqual(second?.branch, 'althar/lane-heights')
      assert.strictEqual(second?.state, 'ready')
      assert.isTrue(existsSync(second?.path ?? ''))
      assert.notStrictEqual(second?.path, first?.path)
      assert.strictEqual(git(second?.path ?? '', 'rev-parse', '--abbrev-ref', 'HEAD'), 'althar/lane-heights')
      // The thread marks it as a step in the work.
      const step = (yield* items(task.threadId)).findLast((item) => item.kind === 'notice')
      assert.deepStrictEqual((step?.content as { step?: unknown } | undefined)?.step, {
        kind: 'new_change',
        name: 'Lane heights',
        branch: 'althar/lane-heights',
        toward: null,
        by: 'lead',
      })
      // Its card counts them; a second name refused, as is a branch a change has.
      const [card] = yield* until(cards(task.projectId), (all) => all[0]?.changeCount === 2)
      assert.strictEqual(card?.changeCount, 2)
      assert.include(yield* callTool(task.lead, 'start_change', { name: 'lane heights' }), 'already')

      // Its work is committed in its own folder, and Ship opens its pull request, leaving the first's as it was.
      writeFileSync(join(second?.path ?? '', 'lanes.txt'), 'taller\n')
      git(second?.path ?? '', 'add', 'lanes.txt')
      git(second?.path ?? '', 'commit', '-q', '-m', 'Taller lanes')
      const firstHead = git(bare, 'rev-parse', 'althar/add-a-retry')
      yield* (yield* Runs).ship({ envelope: yield* Runtime.envelope('task.ship', { taskId: task.taskId }), taskId: task.taskId })
      yield* until(
        Effect.sync(() => github.changes.length),
        (count) => count === 2,
      )
      assert.deepStrictEqual([github.changes[1]?.source, github.changes[1]?.target], ['althar/lane-heights', 'main'])
      assert.strictEqual(git(bare, 'rev-parse', 'althar/add-a-retry'), firstHead)
      // Each pull request says which change it is.
      const snapshot = yield* (yield* Queries).thread(task.threadId)
      const named = snapshot.task.changes.map((change) => change.change?.name ?? null)
      assert.deepStrictEqual(named, [null, 'Lane heights'])

      // The first merges: the task carries on, its other change open.
      squashMerge(bare, 'althar/add-a-retry')
      github.mergeByHand(1)
      yield* (yield* Changes).refresh(task.taskId)
      const sql = yield* SqlClient.SqlClient
      const [open] = yield* sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${task.taskId}`
      assert.strictEqual(open?.state, 'open')
      // The second merges too: now it settles.
      squashMerge(bare, 'althar/lane-heights')
      github.mergeByHand(2)
      yield* (yield* Changes).refresh(task.taskId)
      yield* until(sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${task.taskId}`, (rows) => rows[0]?.state === 'done')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('stacks a change on another, its pull request going into that one’s branch', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working)
      yield* callTool(task.lead, 'start_change', { name: 'Lane heights' })
      const said = yield* callTool(task.lead, 'start_change', { name: 'Lane colours', on: 'Lane heights' })
      assert.include(said, 'stacked on Lane heights')
      const [, below, above] = yield* workspacesOf(task.taskId)
      assert.strictEqual(above?.toward, below?.branch)
      // It starts from the one below's branch.
      assert.strictEqual(git(above?.path ?? '', 'rev-parse', 'HEAD'), git(below?.path ?? '', 'rev-parse', 'HEAD'))
      assert.include(yield* callTool(task.lead, 'start_change', { name: 'Nowhere', on: 'No such change' }), 'no change “No such change”')
      // Started by the coordinator, its lead is told where it is.
      const sql = yield* SqlClient.SqlClient
      const [coordinatorSession] = yield* sql<{ id: string; threadId: string }>`
        SELECT s.id, s.thread_id FROM provider_sessions s JOIN threads t ON t.id = s.thread_id WHERE t.kind = 'coordinator' LIMIT 1`
      if (coordinatorSession !== undefined) {
        yield* callTool(
          {
            role: 'coordinator',
            projectId: task.projectId,
            threadId: coordinatorSession.threadId,
            sessionId: coordinatorSession.id,
            taskId: null,
          },
          'start_change',
          { task: (yield* sql<{ slug: string }>`SELECT slug FROM tasks WHERE id = ${task.taskId}`)[0]?.slug, name: 'Docs' },
        )
        const told = yield* until(
          sql<{ body: string }>`SELECT body FROM user_inputs WHERE thread_id = ${task.threadId} AND body LIKE 'A new change of this task%'`,
          (rows) => rows.length === 1,
        )
        assert.include(told[0]?.body ?? '', 'Docs')
      }
      assert.isTrue(Option.isSome(Option.some(github)))
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('follows a branch its lead made with git as a change of the task’s, and takes the pull request opened from it', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working)
      const sql = yield* SqlClient.SqlClient
      // The lead makes a branch with git in its folder, and commits there.
      git(task.path, 'switch', '-q', '-c', 'althar/docs-only')
      writeFileSync(join(task.path, 'docs.txt'), 'docs\n')
      git(task.path, 'add', 'docs.txt')
      git(task.path, 'commit', '-q', '-m', 'Docs')
      git(task.path, 'push', '-q', bare, 'althar/docs-only')
      // Someone opens its pull request on the website, outside Althar.
      github.addPullRequest({ path: ['meridian', 'api'], title: 'Docs', author: 'fake', source: 'althar/docs-only', target: 'main' })
      // As the lead's next turn ends, the folder's branch is a change of the task's, and the change it left keeps its own.
      yield* (yield* Sessions).send({
        envelope: yield* Runtime.envelope('thread.send', { threadId: task.threadId }),
        threadId: task.threadId,
        body: 'How is it going?',
      })
      const rows = yield* until(workspacesOf(task.taskId), (all) => all.length === 2 && all[1]?.state === 'ready')
      assert.deepStrictEqual(
        rows.map((row) => [row.branch, row.state, row.path === task.path]),
        [
          ['althar/add-a-retry', 'away', true],
          ['althar/docs-only', 'ready', true],
        ],
      )
      const line = yield* until(
        Effect.map(items(task.threadId), (all) =>
          all.filter((item) => item.kind === 'notice' && (item.content as { step?: unknown }).step !== undefined),
        ),
        (found) => found.length === 1,
      )
      assert.strictEqual((line[0]?.content as { step?: { name?: string } } | undefined)?.step?.name, 'althar/docs-only')
      // Its pull request, found by its own branch and target, is the new change's; the first keeps following its own.
      const [linked] = yield* until(
        sql<{ workspaceId: string | null; url: string }>`
          SELECT c.workspace_id, c.pull_request_url AS url FROM repository_changes c WHERE c.branch = 'althar/docs-only'`,
        (found) => found.length === 1,
      )
      assert.strictEqual(linked?.workspaceId, rows[1]?.id)
      const following = yield* sql<{ n: number }>`
        SELECT count(*) AS n FROM external_links WHERE task_id = ${task.taskId} AND kind = 'change' AND listening = 1`
      assert.strictEqual(following[0]?.n, 2)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('merges a stack with one Merge, from the bottom up, the one above going into main once the one below has', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* stacked(working, github)
      assert.strictEqual(github.changes[1]?.target, 'althar/add-a-retry')
      // Its pull request says which it is stacked on, for Merge to name both.
      const shown = (yield* (yield* Queries).thread(task.threadId)).task.changes.find((one) => one.url === task.url)
      assert.strictEqual(shown?.change?.below, 'PR #1')
      // Merge on the one above merges the one below first, as it stands; then the one above goes into main, and merges.
      const head = github.changes[1]?.headSha ?? ''
      yield* (yield* Changes).merge(task.taskId, head, task.url)
      assert.deepStrictEqual(
        github.merged.map((one) => one.number),
        [1, 2],
      )
      assert.strictEqual(github.changes[1]?.target, 'main')
      const said = (yield* items(task.threadId)).flatMap((item) => (item.kind === 'notice' ? [String(item.content.title)] : []))
      assert.include(said, 'PR #2 goes into main now, as PR #1 merged.')
      const [above] = (yield* workspacesOf(task.taskId)).filter((one) => one.path === task.above)
      assert.strictEqual(above?.toward, null)
      // Both merged, the task settles.
      const sql = yield* SqlClient.SqlClient
      yield* until(sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${task.taskId}`, (rows) => rows[0]?.state === 'done')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('holds a change stacked on one with a tweak waiting, once it carries it, until Ship sends both up from the bottom', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* stacked(working, github)
      const sentAbove = git(bare, 'rev-parse', 'althar/lane-heights')
      // The person's word to the lead commits on the change below: held for Ship.
      yield* say(task.threadId, 'Make it retry twice. [lead:commit]')
      yield* until(
        sql<{ heldAt: string | null }>`SELECT held_at FROM workspaces WHERE path = ${task.path}`,
        (rows) => rows[0]?.heldAt != null,
      )
      const changes = yield* Changes
      // Carried above, it is: no push but Ship's takes it up, the lead's included.
      git(task.above, '-c', 'user.name=Fake', '-c', 'user.email=fake@althar.test', 'merge', '-q', '--no-edit', 'althar/add-a-retry')
      const carried = git(task.above, 'rev-parse', 'HEAD')
      const refused = yield* Effect.exit(changes.push(task.taskId, carried, task.url))
      assert.isTrue(refused._tag === 'Failure' && String(refused.cause).includes('ShipRefused'))
      const told = yield* callTool(task.lead, 'push_to_pull_request', { pull_request: 2 })
      assert.include(told, 'waits for the person')
      assert.strictEqual(git(bare, 'rev-parse', 'althar/lane-heights'), sentAbove)
      // Ship sends both: the one below first.
      yield* (yield* Runs).ship({ envelope: yield* Runtime.envelope('task.ship', { taskId: task.taskId }), taskId: task.taskId })
      // Up to each folder's head, as pushing credits it.
      yield* until(
        Effect.sync(() => git(bare, 'rev-parse', 'althar/lane-heights')),
        (now) => now !== sentAbove && now === git(task.above, 'rev-parse', 'HEAD'),
      )
      assert.strictEqual(git(bare, 'log', '-1', '--format=%s', 'althar/lane-heights'), git(task.above, 'log', '-1', '--format=%s', carried))
      assert.strictEqual(git(bare, 'rev-parse', 'althar/add-a-retry'), git(task.path, 'rev-parse', 'HEAD'))
      const pushes = yield* sql<{ url: string }>`
        SELECT json_extract(payload, '$.url') AS url FROM record_events WHERE type = 'change.pushed' ORDER BY occurred_at, rowid`
      const order = pushes.map((one) => one.url).filter((url) => url !== null)
      if (order.length >= 2) assert.isBelow(order.lastIndexOf(github.changes[0]?.url ?? ''), order.lastIndexOf(task.url))
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('keeps two changes together before either ships, and drops one, its branch staying', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working)
      // The task's first change has its pull request already: two split since are kept together with each other.
      yield* callTool(task.lead, 'start_change', { name: 'Lane colours' })
      yield* callTool(task.lead, 'start_change', { name: 'Lane heights' })
      const [first, colours, second] = yield* workspacesOf(task.taskId)
      writeFileSync(join(second?.path ?? '', 'lanes.txt'), 'taller\n')
      git(second?.path ?? '', 'add', 'lanes.txt')
      git(second?.path ?? '', '-c', 'user.name=Fake', '-c', 'user.email=fake@althar.test', 'commit', '-q', '-m', 'Taller lanes')
      // Its row in the thread says who split it, so Keep them together offers itself.
      const started = (yield* items(task.threadId)).findLast(
        (item) => item.kind === 'notice' && (item.content as { step?: unknown }).step !== undefined,
      )
      assert.strictEqual((started?.content as { step?: { by?: string } } | undefined)?.step?.by, 'lead')
      assert.include(yield* callTool(task.lead, 'join_changes', { change: 'Lane heights' }), 'Kept “Lane heights” together')
      // Its commit is on the change that hadn't shipped's branch; its folder went, its branch stays.
      assert.strictEqual(git(colours?.path ?? '', 'log', '-1', '--format=%s'), 'Taller lanes')
      assert.isFalse(existsSync(second?.path ?? ''))
      assert.include(git(working, 'branch', '--list', 'althar/lane-heights'), 'althar/lane-heights')
      const sql = yield* SqlClient.SqlClient
      const [joined] = yield* sql<{ state: string }>`SELECT state FROM workspaces WHERE id = ${second?.id ?? ''}`
      assert.strictEqual(joined?.state, 'cleaned')

      // Another, dropped: what it hadn't committed is committed first, and its branch stays.
      yield* callTool(task.lead, 'start_change', { name: 'Docs' })
      const docs = (yield* workspacesOf(task.taskId)).find((one) => one.name === 'Docs') ?? assert.fail('no change')
      writeFileSync(join(docs.path, 'docs.md'), 'half\n')
      assert.include(yield* callTool(task.lead, 'remove_part', { part: 'workspace', name: 'Docs', why: 'Not needed.' }), 'Dropped “Docs”')
      assert.isFalse(existsSync(docs.path))
      assert.strictEqual(git(working, 'log', '-1', '--format=%s', 'althar/docs'), 'Work in progress, as its change was dropped')
      // Dropped too, the only change left: removing its worktree moves it down to a copy, its branch keeping its work.
      yield* callTool(task.lead, 'remove_part', { part: 'workspace', name: 'Lane colours', why: 'Done with it.' })
      const branch = first?.branch ?? ''
      const head = git(first?.path ?? '', 'rev-parse', 'HEAD')
      assert.include(yield* callTool(task.lead, 'remove_part', { part: 'workspace', why: 'Only reading now.' }), 'is a copy now')
      assert.strictEqual(git(first?.path ?? '', 'rev-parse', '--abbrev-ref', 'HEAD'), 'HEAD')
      assert.strictEqual(git(working, 'rev-parse', branch), head)
      assert.isTrue(Option.isSome(Option.some(github)))
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('starts a change that waits for another to merge, and brings what merged in once it has', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working)
      const said = yield* callTool(task.lead, 'start_change', { name: 'Release notes', waits_for: 'althar/add-a-retry' })
      assert.include(said, 'Started a change')
      const sql = yield* SqlClient.SqlClient
      const [waiting] = yield* sql<{ waitsFor: string | null; path: string; toward: string | null }>`
        SELECT waits_for, path, toward FROM workspaces WHERE task_id = ${task.taskId} AND name = 'Release notes'`
      assert.isNotNull(waiting?.waitsFor ?? null)
      // Both go into the same branch: it doesn't stack.
      assert.strictEqual(waiting?.toward ?? null, null)
      const step = (yield* items(task.threadId)).findLast(
        (item) => item.kind === 'notice' && (item.content as { step?: unknown }).step !== undefined,
      )
      assert.strictEqual((step?.content as { step?: { waits?: string } } | undefined)?.step?.waits, 'althar/add-a-retry')
      // The first merges: what it merged is brought into the one that waited, which waits no more.
      writeFileSync(join(working, 'main-fix.txt'), 'fixed\n')
      git(working, 'add', 'main-fix.txt')
      git(working, 'commit', '-q', '-m', 'Fix main')
      git(working, 'push', '-q', bare, 'HEAD:main')
      git(waiting?.path ?? '', 'remote', 'set-url', 'origin', bare)
      squashMerge(bare, 'althar/add-a-retry')
      github.mergeByHand(1)
      yield* (yield* Changes).refresh(task.taskId)
      const [over] = yield* until(
        sql<{ waitsFor: string | null }>`SELECT waits_for FROM workspaces WHERE task_id = ${task.taskId} AND name = 'Release notes'`,
        (rows) => rows[0]?.waitsFor === null,
      )
      assert.isNull(over?.waitsFor ?? null)
      yield* until(
        Effect.map(items(task.threadId), (all) => all.flatMap((item) => (item.kind === 'notice' ? [String(item.content.title)] : []))),
        (lines) => lines.some((line) => line.includes('Release notes has main in now, and waits no more.')),
      )
      assert.isTrue(existsSync(join(waiting?.path ?? '', 'main-fix.txt')))
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})
