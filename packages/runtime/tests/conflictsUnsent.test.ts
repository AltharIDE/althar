import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import type { Conflict } from '../src/conflicts'
import { Instance } from '../src/Instance'
import { Policies } from '../src/Policies'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { hosted, notices, repository, runtime, until } from './support'
import {
  asked,
  ask,
  cards,
  git,
  hostOf,
  moveHostMainOn,
  moveMainOn,
  opened,
  PASSED,
  rounds,
  runtimeWith,
  taskSays,
  titled,
  worktreeOf,
} from './conflictsSupport'

/*
 * A conflict is never skipped without a word (ADR-030): found here as the
 * default branch moves, whatever the pull request's host says; asked of the
 * lead though its run ended otherwise than succeeded; tried again once the
 * branch moves after a round the lead couldn't resolve, and after Althar
 * stopped mid-round; and where it isn't asked, its card says why, beside
 * Resolve now, which asks anyway.
 */

/**
 * A GitHub that never says the pull request conflicts: `false` as from
 * before main moved, or nothing, as while it works it out. Where `url` says,
 * it is fetched from there instead, as from a host that can't be reached.
 */
const silentHost = (bare: string, says: false | undefined, url: () => string = () => bare) => {
  const github = makeFakeService({
    pushUrl: url,
    headOf: () => {
      try {
        return git(bare, 'rev-parse', 'althar/add-a-retry')
      } catch {
        return null
      }
    },
    conflictsOf: () => says,
    checksFor: () => PASSED,
  })
  github.addRepository(['meridian', 'api'])
  return github
}

/** The task's card: why its conflict wasn't asked of its lead, if it says. */
const unsentOf = (projectId: string) => Effect.map(cards(projectId), ([card]) => card?.conflictUnsent ?? null)

/** The task's card: why Althar couldn't look for a conflict, if it says. */
const uncheckedOf = (projectId: string) =>
  until(
    Effect.map(cards(projectId), ([card]) => [card?.conflictUnchecked ?? null]),
    ([one]) => one !== null,
    Duration.seconds(20),
  ).pipe(Effect.map(([one]) => one))

const runIs = (taskId: string, state: string) =>
  Effect.flatMap(SqlClient.SqlClient, (sql) => sql`UPDATE runs SET state = ${state} WHERE task_id = ${taskId}`)

describe('a pull request whose default branch moved while it didn’t', () => {
  for (const [says, how] of [
    [false, 'its host still says it merges cleanly'],
    [undefined, 'its host hasn’t worked out whether it conflicts'],
  ] as const)
    it.live(`is found to conflict here, and resolved by the lead, though ${how}`, () => {
      const { working, bare } = hosted()
      const github = silentHost(bare, says)
      return Effect.gen(function* () {
        const { taskId, threadId } = yield* opened(working, '[lead:resolve]')
        const pushed = git(bare, 'rev-parse', 'althar/add-a-retry')
        moveHostMainOn(working, bare)
        // Nothing was pushed to the pull request: only main moved.
        assert.strictEqual(git(bare, 'rev-parse', 'althar/add-a-retry'), pushed)
        yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and Althar pushed the merge to PR #1.')
        assert.strictEqual((yield* asked(threadId)).length, 1)
        assert.strictEqual((yield* rounds(taskId))[0]?.url, 'https://github.com/meridian/api/pull/1')
      }).pipe(Effect.provide(runtimeWith({ github })))
    })
})

describe('a conflicting task whose run didn’t succeed', () => {
  it.live('is asked of its lead where the run failed, as its lead is idle', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, () => PASSED)
    return Effect.gen(function* () {
      const { taskId, threadId } = yield* opened(working, '[lead:resolve]')
      yield* runIs(taskId, 'failed')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and Althar pushed the merge to PR #1.')
      assert.strictEqual((yield* rounds(taskId)).length, 1)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('says why where the person stopped it, and Resolve now asks its lead anyway', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, () => PASSED)
    return Effect.gen(function* () {
      const { projectId, taskId, threadId } = yield* opened(working, '[lead:resolve]')
      yield* runIs(taskId, 'suspended')
      moveHostMainOn(working, bare)
      const [why] = yield* until(
        Effect.map(unsentOf(projectId), (one) => [one]),
        ([one]) => one !== null,
        Duration.seconds(20),
      )
      assert.strictEqual(why, 'It’s stopped, so Althar doesn’t start its lead for a conflict.')
      assert.deepStrictEqual(yield* rounds(taskId), [])
      assert.deepStrictEqual(yield* asked(threadId), [])
      // Resolve now: asked, and the card says nothing more of why not.
      yield* (yield* Changes).resolveNow({ taskId }, true)
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and Althar pushed the merge to PR #1.')
      assert.isNull(yield* unsentOf(projectId))
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})

describe('a stopped task its lead was told to carry on, its run still suspended', () => {
  it.live('isn’t said to be stopped while its lead is at work, nor its conflict put to the person', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, () => PASSED)
    return Effect.gen(function* () {
      const { projectId, taskId, threadId } = yield* opened(working, '[lead:resolve]')
      yield* runIs(taskId, 'suspended')
      // Told to go on, as Carry on did before it resumed the run: its lead works, its run still suspended.
      yield* (yield* Sessions).send({ envelope: yield* Runtime.envelope('thread.send', {}), threadId, body: 'Carry on. [lead:wait]' })
      yield* until(cards(projectId), (all) => all[0]?.phase === 'running', Duration.seconds(10))
      moveHostMainOn(working, bare)
      yield* Effect.sleep('2 seconds')
      const [card] = yield* cards(projectId)
      assert.strictEqual(card?.phase, 'running')
      assert.isNull(card?.conflictUnsent ?? null)
      assert.deepStrictEqual(yield* rounds(taskId), [])
      // Once its lead stops, it is stopped again: why its conflict wasn't asked shows.
      yield* (yield* Sessions).interrupt(threadId)
      const [why] = yield* until(
        Effect.map(unsentOf(projectId), (one) => [one]),
        ([one]) => one !== null,
        Duration.seconds(20),
      )
      assert.strictEqual(why, 'It’s stopped, so Althar doesn’t start its lead for a conflict.')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})

describe('a conflicting task Althar can’t merge here', () => {
  it.live('says its folder isn’t on this computer, where its host says it conflicts', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, () => PASSED)
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { projectId, taskId } = yield* opened(working, '[lead:resolve]')
      yield* sql`UPDATE workspaces SET access = 'read' WHERE task_id = ${taskId}`
      moveHostMainOn(working, bare)
      const [why] = yield* until(
        Effect.map(unsentOf(projectId), (one) => [one]),
        ([one]) => one !== null,
        Duration.seconds(20),
      )
      assert.strictEqual(why, 'Its folder isn’t on this computer, so Althar can’t merge main into it here.')
      assert.deepStrictEqual(yield* rounds(taskId), [])
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})

describe('a task Althar can’t look at here, where its host says it merges cleanly', () => {
  it.live('says its folder isn’t on this computer, though its host’s word may be out of date', () => {
    const { working, bare } = hosted()
    const github = silentHost(bare, false)
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { projectId, taskId } = yield* opened(working, '[lead:resolve]')
      yield* sql`UPDATE workspaces SET access = 'read' WHERE task_id = ${taskId}`
      moveHostMainOn(working, bare)
      assert.strictEqual(yield* uncheckedOf(projectId), 'Its folder isn’t on this computer, so Althar can’t merge main into it here.')
      // Not said to conflict: Althar doesn't know.
      assert.isNull(yield* unsentOf(projectId))
      assert.deepStrictEqual(yield* rounds(taskId), [])
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('says its default branch couldn’t be fetched, and once it can, the conflict is the lead’s', () => {
    const { working, bare } = hosted()
    let url = bare
    const github = silentHost(bare, false, () => url)
    return Effect.gen(function* () {
      const { projectId, taskId, threadId } = yield* opened(working, '[lead:resolve]')
      url = join(tmpdir(), 'althar-nowhere', randomBytes(4).toString('hex'))
      moveHostMainOn(working, bare)
      assert.strictEqual(yield* uncheckedOf(projectId), 'Althar couldn’t fetch main to merge it with the branch here.')
      assert.deepStrictEqual(yield* rounds(taskId), [])
      // Back: Look again fetches anew, finds the conflict, and the card says no more of why.
      url = bare
      yield* (yield* Changes).resolveNow({ taskId }, true)
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and Althar pushed the merge to PR #1.')
      yield* until(cards(projectId), ([card]) => card?.conflictUnchecked == null, Duration.seconds(20))
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('is looked at by Resolve now though it has no folder here, and says why nothing can be merged', () => {
    const { working, bare } = hosted()
    const github = silentHost(bare, false)
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      // The rules leave conflicts to the person: nothing looks at it but Resolve now.
      const { projectId, taskId } = yield* opened(working, '[lead:resolve]', false)
      yield* sql`UPDATE workspaces SET access = 'read' WHERE task_id = ${taskId}`
      moveHostMainOn(working, bare)
      yield* Effect.sleep('1500 millis')
      assert.isNull((yield* cards(projectId))[0]?.conflictUnchecked ?? null)
      yield* (yield* Changes).resolveNow({ taskId }, true)
      assert.strictEqual(yield* uncheckedOf(projectId), 'Its folder isn’t on this computer, so Althar can’t merge main into it here.')
      assert.deepStrictEqual(yield* rounds(taskId), [])
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})

describe('a conflict its lead couldn’t resolve', () => {
  it.live('is the lead’s again by Resolve now, though neither branch moved', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, () => PASSED)
    return Effect.gen(function* () {
      const { projectId, taskId } = yield* opened(working, '[lead:resolve-fails]')
      moveHostMainOn(working, bare)
      yield* until(rounds(taskId), (all) => all[0]?.state === 'failed', Duration.seconds(30))
      yield* until(cards(projectId), (all) => all[0]?.handedBack != null, Duration.seconds(20))
      yield* (yield* Changes).resolveNow({ taskId }, true)
      const all = yield* until(rounds(taskId), (now) => now.length === 2, Duration.seconds(20))
      // The same conflict, against the same main, asked again.
      assert.strictEqual(all[0]?.state, 'failed')
      assert.strictEqual(all[1]?.attempt, 1)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('stays the person’s while main stays, and is the lead’s again once main moves on', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, () => PASSED)
    return Effect.gen(function* () {
      const { projectId, taskId } = yield* opened(working, '[lead:resolve-fails]')
      moveHostMainOn(working, bare)
      yield* until(rounds(taskId), (all) => all[0]?.state === 'failed', Duration.seconds(30))
      yield* until(cards(projectId), (all) => all[0]?.handedBack != null, Duration.seconds(20))
      // Looked at a few turns over, it stays the person's: nothing new to try.
      yield* Effect.sleep('1500 millis')
      assert.strictEqual((yield* rounds(taskId)).length, 1)
      moveHostMainOn(working, bare, 'rate limits, again\n')
      const all = yield* until(rounds(taskId), (now) => now.length === 2, Duration.seconds(20))
      assert.strictEqual(all[0]?.state, 'failed')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})

describe('a conflict whose last round ended as Althar stopped', () => {
  it.live('is the lead’s again, though nothing moved since: Althar’s stop wasn’t the lead failing', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, () => PASSED)
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { projectId, taskId, threadId } = yield* opened(working, '[lead:resolve]')
      yield* taskSays(taskId, false)
      moveHostMainOn(working, bare)
      // As an earlier launch left it: failed for Althar's stop, with the branches where they are now.
      const { slug, path } = yield* worktreeOf(taskId)
      const head = git(path, 'rev-parse', 'HEAD')
      const conflict: Conflict = {
        repository: slug,
        name: slug,
        branch: 'main',
        ref: 'origin/main',
        target: git(bare, 'rev-parse', 'main'),
        from: head,
        files: ['change.txt'],
      }
      const at = new Date().toISOString()
      yield* sql`INSERT INTO conflict_resolutions ${sql.insert({
        id: `cres_${randomBytes(16).toString('hex')}`,
        projectId,
        taskId,
        pullRequestUrl: 'https://github.com/meridian/api/pull/1',
        conflicts: JSON.stringify([conflict]),
        attempt: 1,
        state: 'failed',
        failure: 'Althar stopped while the lead was resolving it. change.txt still conflicts.',
        ended: JSON.stringify([{ repository: slug, head }]),
        createdAt: at,
        updatedAt: at,
        settledAt: at,
      })}`
      yield* taskSays(taskId, null)
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and Althar pushed the merge to PR #1.')
      // Pushed, the round waits for the checks on the merge, which pass once they are read.
      const settled = yield* until(rounds(taskId), (all) => all.at(-1)?.state !== 'checking')
      assert.deepStrictEqual(
        settled.map((round) => round.state),
        ['failed', 'resolved'],
      )
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})

describe('a branch merging here, with no pull request', () => {
  it.live('is resolved by the lead once main moves here, without the person pressing Merge', () => {
    const working = repository()
    return Effect.gen(function* () {
      const projectId = yield* ask(
        working,
        'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit] [lead:resolve]',
        true,
      )
      const [task] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(20))
      moveMainOn(working)
      yield* titled(task?.threadId ?? '', 'The lead resolved the conflict with main, in change.txt')
      assert.deepStrictEqual(
        (yield* rounds(task?.taskId ?? '')).map((round) => [round.state, round.url]),
        [['resolved', null]],
      )
    }).pipe(Effect.provide(runtimeWith()))
  })

  it.live('is left alone where the rules don’t say to resolve conflicts', () => {
    const working = repository()
    return Effect.gen(function* () {
      const projectId = yield* ask(
        working,
        'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit] [lead:resolve]',
        false,
      )
      const [task] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(20))
      moveMainOn(working)
      yield* Effect.sleep('1500 millis')
      assert.deepStrictEqual(yield* rounds(task?.taskId ?? ''), [])
      assert.isNull(yield* unsentOf(projectId))
      // Turned on, it is looked at at once.
      yield* (yield* Policies).set(projectId as never, { resolveConflicts: true }, (yield* Instance).personId)
      yield* (yield* Changes).resolveNow({ projectId })
      yield* titled(task?.threadId ?? '', 'The lead resolved the conflict with main, in change.txt')
    }).pipe(Effect.provide(runtimeWith()))
  })

  it.live('says its folder isn’t on this computer once it is gone, where it said why its conflict wasn’t asked', () => {
    const working = repository()
    return Effect.gen(function* () {
      const projectId = yield* ask(
        working,
        'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit] [lead:resolve]',
        true,
      )
      const [task] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(20))
      const taskId = task?.taskId ?? ''
      yield* runIs(taskId, 'suspended')
      moveMainOn(working)
      yield* until(
        Effect.map(unsentOf(projectId), (one) => [one]),
        ([one]) => one === 'It’s stopped, so Althar doesn’t start its lead for a conflict.',
        Duration.seconds(20),
      )
      // Its folder gone, Resolve now can't merge anything: it says so, and no longer that it conflicts.
      rmSync((yield* worktreeOf(taskId)).path, { recursive: true, force: true })
      yield* (yield* Changes).resolveNow({ taskId }, true)
      assert.strictEqual(yield* uncheckedOf(projectId), 'Its folder isn’t on this computer, so Althar can’t merge main into it here.')
      assert.isNull(yield* unsentOf(projectId))
      assert.deepStrictEqual(yield* rounds(taskId), [])
    }).pipe(Effect.provide(runtimeWith()))
  })

  it.live('says so where its folder was already gone as main moves, and where git can’t merge it', () => {
    const working = repository()
    return Effect.gen(function* () {
      const projectId = yield* ask(
        working,
        'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit] [lead:resolve]',
        true,
      )
      const [task] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(20))
      const taskId = task?.taskId ?? ''
      const { path } = yield* worktreeOf(taskId)
      const kept = join(mkdtempSync(join(tmpdir(), 'althar-kept-')), 'folder')
      git(working, 'worktree', 'move', path, kept)
      moveMainOn(working)
      assert.strictEqual(yield* uncheckedOf(projectId), 'Its folder isn’t on this computer, so Althar can’t merge main into it here.')
      assert.deepStrictEqual(yield* rounds(taskId), [])
      // Back, but with main gone from here: git has nothing to merge it with.
      git(working, 'worktree', 'move', kept, path)
      git(working, 'branch', '-m', 'main', 'elsewhere')
      yield* (yield* Changes).resolveNow({ taskId }, true)
      yield* until(
        Effect.map(cards(projectId), ([card]) => [card?.conflictUnchecked ?? null]),
        ([one]) => one === 'Git couldn’t merge main with the branch here.',
        Duration.seconds(20),
      )
      assert.deepStrictEqual(yield* rounds(taskId), [])
    }).pipe(Effect.provide(runtimeWith()))
  })
})

describe('a round an earlier launch left under way', () => {
  it.live('is asked of the lead again where its branch still conflicts, not handed to the person', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'althar-conflicts-')), 'althar.sqlite')
    const launch = () => Queries.layer.pipe(Layer.provideMerge(runtime(file)))
    const root = repository()
    return Effect.gen(function* () {
      const { taskId, threadId } = yield* Effect.gen(function* () {
        const projects = yield* Projects
        const sql = yield* SqlClient.SqlClient
        const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: root })
        const task = yield* projects.createTask({
          envelope: yield* Runtime.envelope('task.create', {}),
          projectId: project.projectId,
          title: 'Retry',
        })
        yield* until(
          sql<{ state: string }>`SELECT state FROM workspaces WHERE task_id = ${task.taskId}`,
          (rows) => rows[0]?.state === 'ready',
        )
        const { slug, path } = yield* worktreeOf(task.taskId)
        // The task's branch and main each changed the same file: they conflict, and the lead hadn't resolved it when Althar stopped.
        writeFileSync(join(path, 'change.txt'), 'a retry\n')
        git(path, 'add', '.')
        git(path, 'commit', '-q', '-m', 'Retry')
        moveMainOn(root)
        const conflict: Conflict = {
          repository: slug,
          name: slug,
          branch: 'main',
          ref: 'main',
          target: git(root, 'rev-parse', 'main'),
          from: git(path, 'rev-parse', 'HEAD'),
          files: ['change.txt'],
        }
        const at = new Date().toISOString()
        yield* sql`INSERT INTO conflict_resolutions ${sql.insert({
          id: `cres_${randomBytes(16).toString('hex')}`,
          projectId: project.projectId,
          taskId: task.taskId,
          pullRequestUrl: null,
          conflicts: JSON.stringify([conflict]),
          attempt: 1,
          state: 'resolving',
          createdAt: at,
          updatedAt: at,
        })}`
        const [thread] = yield* sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${task.taskId} AND kind = 'task'`
        return { taskId: task.taskId, threadId: thread?.id ?? '' }
      }).pipe(Effect.provide(launch()))

      yield* Effect.gen(function* () {
        // Said in the thread, and its lead asked again: this task has none to start, which is what ends it.
        yield* titled(threadId, 'Althar stopped while the lead was resolving the conflict with main')
        const [said] = (yield* notices(threadId)).filter((one) => one.title?.startsWith('Althar stopped') === true)
        assert.strictEqual(said?.description, 'Althar asks the lead again once an agent is free on this computer.')
        const sql = yield* SqlClient.SqlClient
        const [ended] = yield* until(
          sql<{ state: string; failure: string | null }>`SELECT state, failure FROM conflict_resolutions WHERE task_id = ${taskId}`,
          (rows) => rows.every((row) => row.state !== 'resolving'),
        )
        assert.notInclude(ended?.failure ?? '', 'Althar stopped while the lead was resolving it.')
      }).pipe(Effect.provide(launch()))
    })
  })
})
