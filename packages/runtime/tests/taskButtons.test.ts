import { makeFakeService } from '@althar/connectors/testing'
import { Ids, newId, type ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Coordinator } from '../src/Coordinator'
import { CantMerge, PushRefused } from '../src/errors'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { cantMerge, pushRefused, quoted, TaskActions, type TaskAskContent } from '../src/TaskActions'
import { addItem } from '../src/threads'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, HOST, hosted, notices, repository, runtime, until } from './support'

import { ask, cards, connect, git, pushByHand, runtimeWith, tipOf } from './changesSupport'

/*
 * The buttons of a task's Change card and menu, as tools (ADR-097, "Matching the window"): the coordinator, or a lead,
 * pushes, opens, follows and resolves as the person's buttons do, at once, with a line in both threads, and where a
 * button would do nothing, says why in the window's words.
 */

const titles = (threadId: string) => Effect.map(notices(threadId), (rows) => rows.map((row) => row['title'] ?? ''))

/** A task with its draft pull request open on the fake host, its pushes waiting on the person's press. */
const opened = () => {
  const { working, bare } = hosted()
  const tip = tipOf(bare)
  const github = makeFakeService({ pushUrl: () => bare, headOf: () => tip() })
  github.addRepository(['meridian', 'api'])
  git(working, 'config', 'user.name', 'Fake')
  git(working, 'config', 'user.email', 'fake@althar.test')
  const ready = Effect.gen(function* () {
    yield* connect('github', HOST)
    const projectId = yield* ask(
      working,
      'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]',
      pushByHand,
    )
    const [card] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready' && all[0]?.change != null)
    const sql = yield* SqlClient.SqlClient
    const [task] = yield* sql<{ id: string; slug: string; title: string; threadId: string; path: string; branch: string }>`
      SELECT k.id, k.slug, k.title, t.id AS thread_id, w.path, w.branch
      FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task' JOIN workspaces w ON w.task_id = k.id
      WHERE k.id = ${card?.taskId ?? ''}`
    if (task === undefined) return assert.fail('no task')
    const coordinatorThread = yield* (yield* Coordinator).thread(projectId)
    const coordinator: ToolAccess = { role: 'coordinator', projectId, threadId: coordinatorThread, taskId: null, sessionId: 'none' }
    const lead: ToolAccess = { role: 'lead', projectId, threadId: task.threadId, taskId: task.id, sessionId: 'none' }
    return { projectId, task, coordinator, lead, url: card?.change?.url ?? '' }
  })
  return { bare, github, ready }
}

describe('a task’s buttons, as tools', () => {
  it.live('push, open, follow and skip its review as the Change card does, with a line in both threads', () => {
    const { bare, github, ready } = opened()
    return Effect.gen(function* () {
      const { projectId, task, coordinator, url } = yield* ready
      assert.match(yield* callTool(coordinator, 'push_task', { task: task.slug, head: 'nope' }), /head is a commit's hash/)

      // Push: up to the head read, a plain push, said in both threads with the why.
      git(task.path, 'commit', '-q', '--allow-empty', '-m', 'Step 1')
      const [seen] = yield* until(cards(projectId), (all) => all[0]?.change?.unpushed === 1)
      const head = seen?.change?.localHead ?? ''
      assert.match(
        yield* callTool(coordinator, 'push_task', { task: task.slug, head, why: 'the person asked' }),
        new RegExp(`^Pushed ${task.slug}'s branch up to ${head.slice(0, 7)} to ${url}: a plain push, nothing forced`),
      )
      // Credited as every push is, so by its subject: the commit is on the host.
      assert.strictEqual(git(bare, 'log', '-1', '--format=%s', task.branch), 'Step 1')
      assert.include(yield* titles(coordinator.threadId), 'Pushed “Add a retry” to its pull request: the person asked')
      assert.include(yield* titles(task.threadId), 'The coordinator pushed its commits to its pull request: the person asked')

      // What the window would refuse, refused in its words: a tagged error carries no message of its own.
      assert.strictEqual(
        yield* callTool(coordinator, 'open_task_pull_request', { task: task.slug }),
        'Nothing changed for add-a-retry: The task already has its pull request.',
      )
      assert.match(
        yield* callTool(coordinator, 'push_task_branch', { task: task.slug }),
        /^Nothing changed for add-a-retry: Its repositories have no remote to push to/,
      )
      assert.match(yield* callTool(coordinator, 'move_to_front', { task: task.slug }), /^Nothing changed: .* isn't waiting for a place/)
      // Heads named, as read_task shows them: the same, as its branch's work is in its pull request.
      assert.match(
        yield* callTool(coordinator, 'push_task_branch', { task: task.slug, heads: [{ repository: 'api', head: 'abc1234' }] }),
        /^Nothing changed for add-a-retry: Its repositories have no remote to push to/,
      )

      assert.match(yield* callTool(coordinator, 'skip_review', { task: task.slug }), /^Skipped add-a-retry's review/)
      assert.include(yield* titles(task.threadId), 'The coordinator skipped this task’s review')

      assert.match(
        yield* callTool(coordinator, 'stop_following', { task: task.slug, pull_request: url }),
        /no longer follows .*attach_pull_request follows it again/,
      )
      assert.include(yield* titles(task.threadId), `The coordinator stopped following ${url}`)
      assert.include(yield* titles(coordinator.threadId), `“Add a retry” no longer follows ${url}`)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('resolve conflicts now or set how, from its own lead too, and refuse a call they can’t read', () => {
    const { github, ready } = opened()
    return Effect.gen(function* () {
      const { task, coordinator, lead } = yield* ready
      // Its own lead names no task: it is its own, and its line says its lead did it.
      assert.match(
        yield* callTool(lead, 'resolve_conflicts', { automatically: false, why: 'the person resolves them' }),
        /^add-a-retry resolves conflicts only when asked now\. Both threads/,
      )
      assert.include(yield* titles(task.threadId), 'Its lead set this task to resolve conflicts only when asked: the person resolves them')
      assert.match(yield* callTool(lead, 'move_to_front', {}), /^Nothing changed: add-a-retry isn't waiting/)

      const both = yield* callTool(coordinator, 'resolve_conflicts', { task: task.slug, automatically: null, now: true })
      assert.include(both, 'resolves conflicts as its project says now.')
      assert.include(both, 'lead is asked to resolve its conflict')
      assert.match(yield* callTool(coordinator, 'resolve_conflicts', { task: task.slug, automatically: true }), /automatically now/)
      assert.notInclude(yield* callTool(coordinator, 'resolve_conflicts', { task: task.slug, automatically: true }), 'is asked to resolve')
      assert.match(yield* callTool(coordinator, 'resolve_conflicts', { task: task.slug }), /^add-a-retry's lead is asked to resolve/)
      assert.include(yield* titles(coordinator.threadId), 'Asked “Add a retry” to resolve its conflicts')

      // The coordinator names the task; one the project hasn't, and a call missing what it needs, are refused.
      assert.strictEqual(yield* callTool(coordinator, 'move_to_front', {}), 'Name the task, by its slug as list_tasks shows it.')
      assert.match(yield* callTool(coordinator, 'skip_review', { task: 'nope' }), /^This project has no task nope/)
      assert.match(yield* callTool(coordinator, 'stop_following', { task: task.slug }), /^Althar couldn't read that: .*pull_request/s)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})

describe('settle_task, from a lead', () => {
  it.live('settles another task, but a review’s lead settles only its own review, which is done once its draft is posted', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const projects = yield* Projects
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const projectId = project.projectId as ProjectId
      const threadId = yield* (yield* Coordinator).thread(projectId)
      const coordinator: ToolAccess = { role: 'coordinator', projectId, threadId, sessionId: 'none', taskId: null }
      const quick = (title: string) =>
        Effect.gen(function* () {
          yield* callTool(coordinator, 'start_task', { title, description: '[lead:finish]', lead: { agent: 'codex' } })
          const [task] = yield* sql<{ taskId: string; threadId: string; slug: string }>`
            SELECT k.id AS task_id, k.slug, t.id AS thread_id FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
            WHERE k.project_id = ${projectId} AND k.title = ${title}`
          if (task === undefined) return assert.fail('no task')
          return task
        })
      const one = yield* quick('Sketch the settings')
      const other = yield* quick('Read the logs')
      const lead: ToolAccess = { role: 'lead', projectId, threadId: other.threadId, sessionId: 'none', taskId: other.taskId }
      assert.match(
        yield* callTool(lead, 'settle_task', { task: one.slug, how: 'keep', why: 'the person asked' }),
        /^Kept sketch-the-settings for later/,
      )
      assert.include(yield* titles(one.threadId), 'The lead of “Read the logs” kept this task for later: the person asked')

      // Made a review of a pull request: its lead settles only it, and done waits for its draft to be posted.
      const at = new Date().toISOString()
      yield* sql`INSERT INTO external_links ${sql.insert({
        id: 'xlink_a5500000000000000000000000000002',
        projectId,
        taskId: other.taskId,
        connectionId: null,
        product: 'github',
        kind: 'review',
        externalId: 'meridian/api#7',
        ref: 'meridian/api#7',
        key: 'meridian/api#7',
        url: 'https://github.com/meridian/api/pull/7',
        snapshot: '{}',
        createdAt: at,
        updatedAt: at,
      })}`
      assert.strictEqual(
        yield* callTool(lead, 'settle_task', { task: one.slug, how: 'discard' }),
        'A review’s lead settles only its own review.',
      )
      assert.match(
        yield* callTool(coordinator, 'settle_task', { task: other.slug, how: 'done' }),
        /reviews a pull request: it settles once its draft is posted/,
      )
    }).pipe(Effect.provide(runtime())),
  )
})

describe('a coordinator’s card asking to move a task, made before moves went at once', () => {
  /** A card as the coordinator made one, still open in its thread. */
  const card = (
    projectId: ProjectId,
    threadId: string,
    task: { taskId: string; threadId: string; slug: string },
    move: TaskAskContent['move'],
  ) =>
    Effect.gen(function* () {
      const content: TaskAskContent = {
        taskId: task.taskId,
        threadId: task.threadId,
        slug: task.slug,
        title: 'Sketch it',
        move,
        why: null,
        state: 'open',
        said: null,
      }
      const itemId = yield* newId(Ids.threadItem)
      yield* addItem({ projectId, threadId }, 'task_ask', content, { id: itemId })
      return itemId
    })
  const stateOf = (itemId: string) =>
    Effect.gen(function* () {
      const [row] = yield* (yield* SqlClient.SqlClient)<{ content: string }>`SELECT content FROM thread_items WHERE id = ${itemId}`
      return JSON.parse(row?.content ?? '{}') as TaskAskContent
    })

  it.live('does the move on yes, as the person’s press, does nothing on no, and a second press is the first', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const actions = yield* TaskActions
      const { personId } = yield* Instance
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const projectId = project.projectId as ProjectId
      const threadId = yield* (yield* Coordinator).thread(projectId)
      const created = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId,
        title: 'Sketch it',
        description: 'Look.',
        draft: true,
      })
      const [row] = yield* (yield* SqlClient.SqlClient)<{ slug: string }>`SELECT slug FROM tasks WHERE id = ${created.taskId}`
      const task = { taskId: created.taskId, threadId: created.threadId, slug: row?.slug ?? '' }

      const no = yield* card(projectId, threadId, task, 'discard')
      yield* actions.answer(no, false, personId)
      assert.strictEqual((yield* stateOf(no)).state, 'declined')

      const yes = yield* card(projectId, threadId, task, 'discard')
      yield* actions.answer(yes, true, personId)
      assert.deepInclude(yield* stateOf(yes), { state: 'done' })
      assert.include(yield* titles(task.threadId), 'You discarded this task, from the coordinator’s card.')
      // Pressed again, nothing more happens.
      yield* actions.answer(yes, true, personId)
      assert.lengthOf(
        (yield* titles(task.threadId)).filter((title) => title.startsWith('You discarded')),
        1,
      )

      // A move that no longer applies is moot, with why; a card that isn't there is nothing.
      const moot = yield* card(projectId, threadId, task, 'discard')
      yield* actions.answer(moot, true, personId)
      assert.deepInclude(yield* stateOf(moot), { state: 'moot', said: `${task.slug} is discarded already.` })
      yield* actions.answer('item_none', true, personId)
    }).pipe(Effect.provide(runtime())),
  )
})

describe('what an agent is told when a merge or push doesn’t go', () => {
  it('says each reason a branch can’t merge here, and each a push is refused', () => {
    const merge = (why: CantMerge['why'], more: Partial<{ into: string; files: ReadonlyArray<string> }> = {}) =>
      cantMerge('fix-it', new CantMerge({ taskId: 't', why, detail: 'the checkout', ...more }))
    assert.match(merge('pull_request'), /merge_pull_request merges it/)
    assert.strictEqual(merge('settled'), 'fix-it is settled already.')
    assert.match(merge('changed'), /isn’t at the head you read/)
    assert.strictEqual(
      merge('conflicts', { into: 'main', files: ['a.ts', 'b.ts'] }),
      'fix-it conflicts with main (a.ts, b.ts). Its lead can resolve it: tell the person.',
    )
    assert.match(merge('resolving'), /^fix-it conflicts with its default branch, and its lead is resolving it/)
    assert.match(merge('busy', { files: [] }), /^its default branch is checked out in the checkout with changes in the way\./)
    assert.match(merge('untracked', { files: ['x'] }), /changes in the way \(x\)/)
    assert.match(merge('submodule'), /^A submodule the merge moves/)
    assert.strictEqual(merge('unreadable'), 'Althar couldn’t read a checkout: the checkout')
    assert.match(merge('moved'), /moved while it merged: nothing was merged/)
    assert.strictEqual(merge('missing'), 'fix-it has no the checkout here to merge into.')

    assert.match(
      pushRefused(new PushRefused({ taskId: 't', why: 'behind', remote: 'origin/main' })),
      /^origin\/main has commits this Mac doesn’t/,
    )
    assert.strictEqual(
      pushRefused(new PushRefused({ taskId: 't', why: 'refused', remote: 'origin/main', said: 'hook said no' })),
      'origin/main didn’t take the push (refused): hook said no. Nothing is forced.',
    )
    assert.strictEqual(
      pushRefused(new PushRefused({ taskId: 't', why: 'denied', remote: 'origin/main' })),
      'origin/main didn’t take the push (denied). Nothing is forced.',
    )
  })

  it('quotes the person in one line, cut short past 140 characters', () => {
    assert.strictEqual(quoted('  stop\n the   task '), '“stop the task”')
    const long = quoted('a'.repeat(200))
    assert.strictEqual(long.length, 142)
    assert.isTrue(long.endsWith('…”'))
  })
})
