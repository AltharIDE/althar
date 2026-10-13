import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

import type { FoundTask } from '@althar/contracts'
import { makeFakeService } from '@althar/connectors/testing'
import type { ProjectId } from '@althar/domain'
import { BUILT } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { backfill, fileOf, findTasks, foundWords, indexTask, matchOf, partsOf, phaseOf } from '../src/Search'
import { Sessions } from '../src/Sessions'
import { Tasks } from '../src/Tasks'
import { addItem } from '../src/threads'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, fakeConnectors, HOST, hosted, repository, runtime, until } from './support'

/*
 * Finding a task by what it was about (ADR-035): its row is written where
 * what it is found by changes, and the index answers by words begun, every
 * one needed, best first.
 */

const none = new Set<string>()

const found = (text: string, projectId?: string) =>
  findTasks({ text, ...(projectId === undefined ? {} : { projectId }) }, none).pipe(Effect.map((tasks) => tasks.map((task) => task.title)))

const project = Effect.gen(function* () {
  const projects = yield* Projects
  return (yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })).projectId
})

const make = (projectId: string, title: string, description?: string) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    return yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', { title }),
      projectId,
      title,
      ...(description === undefined ? {} : { description, request: description }),
    })
  })

const report = (projectId: string, threadId: string, summary: string, built: string | null = null, step = 'implement') =>
  addItem({ projectId: projectId as ProjectId, threadId }, 'step_result', {
    step,
    round: 0,
    summary,
    change: null,
    verdict: null,
    findings: [],
    built,
    evidence: [],
    unverified: null,
    agentId: 'claude-code',
  })

const edit = (projectId: string, threadId: string, id: string, path: string, declined = false) =>
  addItem(
    { projectId: projectId as ProjectId, threadId },
    'tool_call',
    {
      title: `Edit ${path}`,
      toolKind: 'edit',
      status: 'completed',
      command: null,
      locations: [{ path }],
      declined,
      output: null,
      exit: null,
    },
    { toolCallId: id },
  )

describe('finding tasks', () => {
  it.live('finds a task by what it was about, kept current as that changes', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const instance = yield* Instance
      const projectId = yield* project
      const created = yield* make(projectId, 'Retry the checkout', 'Payments fail when the card times out')

      // Made, it is found by its title, a word part typed, every word needed, and by what the person asked.
      assert.deepStrictEqual(yield* found('retr'), ['Retry the checkout'])
      assert.deepStrictEqual(yield* found('checkout RETR'), ['Retry the checkout'])
      assert.deepStrictEqual(yield* found('checkout banana'), [])
      const [asked] = yield* findTasks({ text: 'card times' }, none)
      assert.deepStrictEqual(asked?.matched, [
        { text: 'Payments fail when the ', hit: false },
        { text: 'card', hit: true },
        { text: ' ', hit: false },
        { text: 'times', hit: true },
        { text: ' out', hit: false },
      ])
      // Matched in its title alone, it says nothing more.
      assert.isNull((yield* findTasks({ text: 'checkout' }, none))[0]?.matched ?? null)
      // By its branch, as git named it.
      assert.deepStrictEqual(yield* found(created.branch), ['Retry the checkout'])

      // Renamed, by its new title; its branch keeps the old words.
      const tasks = yield* Tasks
      yield* tasks.rename({
        envelope: yield* Runtime.envelope('task.rename', {}),
        taskId: created.taskId,
        title: 'Back off between attempts',
      })
      assert.deepStrictEqual(yield* found('attempts'), ['Back off between attempts'])
      const [byBranch] = yield* findTasks({ text: 'retr' }, none)
      assert.isTrue(byBranch?.matched?.some((part) => part.hit && part.text === 'retry'))

      // What the person writes to its lead, but not what the coordinator passes on.
      const sessions = yield* Sessions
      const send = (body: string, actorId?: typeof instance.personId) =>
        Effect.gen(function* () {
          yield* sessions.send({
            envelope: yield* Runtime.envelope('thread.send', { body }, undefined, actorId),
            threadId: created.threadId,
            body,
            disposition: 'after_current',
          })
        })
      yield* send('Keep the jitter under a second')
      yield* send('Mention the flamingo', instance.coordinatorId)
      assert.deepStrictEqual(yield* found('jitter'), ['Back off between attempts'])
      assert.deepStrictEqual(yield* found('flamingo'), [])

      // What its lead reports, and what it built; not a reviewer's verdict.
      yield* report(projectId, created.threadId, 'Waits longer each time.', 'Exponential backoff in the payments client.')
      yield* report(projectId, created.threadId, 'The pelican looks wrong.', null, 'review')
      assert.deepStrictEqual(yield* found('exponential'), ['Back off between attempts'])
      assert.deepStrictEqual(yield* found('pelican'), [])

      // The files its lead changed, as of its next report: inside its worktree, from there; never one refused, or outside it.
      yield* edit(projectId, created.threadId, 'call-1', join(created.worktree, 'src', 'payments', 'backoff.ts'))
      yield* edit(projectId, created.threadId, 'call-2', join(created.worktree, 'src', 'secret-plan.ts'), true)
      yield* edit(projectId, created.threadId, 'call-3', '/etc/hosts')
      assert.deepStrictEqual(yield* found('backoff.ts'), [], 'not until it reports')
      yield* report(projectId, created.threadId, 'Settled the review.', null, 'settle')
      const [file] = yield* findTasks({ text: 'backoff.ts' }, none)
      assert.deepStrictEqual(file?.matched, [
        { text: 'src/payments/', hit: false },
        { text: 'backoff.ts', hit: true },
      ])
      assert.deepStrictEqual(yield* found('secret'), [])
      assert.deepStrictEqual(yield* found('hosts'), [])

      // Linked to an issue and a pull request, by their keys and numbers.
      yield* sql`INSERT INTO external_links ${sql.insert({
        id: `xlink_${'1'.repeat(32)}`,
        projectId,
        taskId: created.taskId,
        product: 'github',
        kind: 'change',
        externalId: '143',
        ref: 'meridian/api#143',
        key: '#143',
        url: `${HOST}/meridian/api/pull/143`,
        createdAt: '2026-10-14T09:00:00.000Z',
        updatedAt: '2026-10-14T09:00:00.000Z',
      })}`
      yield* indexTask(created.taskId)
      for (const text of ['#143', '143', 'meridian/api#143'])
        assert.deepStrictEqual(yield* found(text), ['Back off between attempts'], text)
      assert.strictEqual((yield* findTasks({ text: '143' }, none))[0]?.pullRequest, '#143')

      // Written again with nothing changed, it stays as it was.
      const before = yield* sql<{ changedAt: string }>`SELECT changed_at FROM task_search_rows WHERE task_id = ${created.taskId}`
      yield* indexTask(created.taskId)
      assert.deepStrictEqual(yield* sql`SELECT changed_at FROM task_search_rows WHERE task_id = ${created.taskId}`, before)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('ranks the title first, recent first among equals, reads what is typed as words, and keeps to live projects', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const projectId = yield* project
      const other = yield* project
      const titled = yield* make(projectId, 'Retry payments')
      const again = yield* make(projectId, 'Retry refunds')
      const mentioned = yield* make(projectId, 'Tidy the logs')
      yield* report(projectId, mentioned.threadId, 'Logs no longer repeat each retry.')
      yield* make(other, 'Retry the queue')

      // Best first: in the title before in a summary; of the two alike, the one changed last.
      const ranked = yield* findTasks({ text: 'retry', projectId }, none)
      assert.deepStrictEqual(
        ranked.map((task) => task.taskId),
        [again.taskId, titled.taskId, mentioned.taskId],
      )
      // Only the project asked about; without one, every project.
      assert.deepStrictEqual((yield* found('retry')).toSorted(), ['Retry payments', 'Retry refunds', 'Retry the queue', 'Tidy the logs'])

      // Nothing typed is the index's own syntax: quotes, stars, operators, columns and parentheses are only words.
      for (const text of [
        '"retry',
        'retry"',
        're*try',
        'NEAR(retry logs)',
        'title:retry',
        '-retry',
        '(',
        'retry OR queue',
        "'; DROP TABLE tasks; --",
      ])
        yield* findTasks({ text, projectId }, none)
      assert.deepStrictEqual((yield* found('"retry')).length, 4)
      assert.deepStrictEqual(yield* found('retry OR queue'), [], 'OR is a word, which no task has')
      assert.deepStrictEqual(yield* found('#'), [], 'no word to find')

      // Nothing typed: the most recently changed.
      assert.deepStrictEqual(
        (yield* findTasks({ text: '  ', projectId }, none)).map((task) => task.taskId),
        [mentioned.taskId, again.taskId, titled.taskId],
      )
      assert.lengthOf(yield* findTasks({ text: '', limit: 1 }, none), 1)

      // A project removed from Althar isn't searched.
      yield* projects.remove(other)
      assert.notInclude(yield* found('retry'), 'Retry the queue')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('indexes the tasks made before search, once', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const projectId = yield* project
      yield* make(projectId, 'Old work')
      yield* make(projectId, 'Older work')
      yield* sql`DELETE FROM task_search_rows`
      assert.deepStrictEqual(yield* found('work'), [])
      yield* backfill
      assert.deepStrictEqual((yield* found('work')).toSorted(), ['Old work', 'Older work'])
      const counted = sql<{ n: number }>`SELECT count(*) AS n FROM task_search_rows`
      const rows = yield* counted
      yield* backfill
      assert.deepStrictEqual(yield* counted, rows)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('tells the coordinator what it found, in lines it can act on', () =>
    Effect.gen(function* () {
      const coordinator = yield* Coordinator
      const projectId = yield* project
      const created = yield* make(projectId, 'Retry the checkout', 'Payments fail when the card times out')
      const access: ToolAccess = {
        role: 'coordinator',
        projectId,
        threadId: yield* coordinator.thread(projectId),
        sessionId: 'none',
        taskId: null,
      }
      assert.strictEqual(
        yield* callTool(access, 'find_tasks', { text: 'card' }),
        `- retry-the-checkout: Retry the checkout (stopped; id ${created.taskId})\n  “Payments fail when the card times out”`,
      )
      assert.strictEqual(yield* callTool(access, 'find_tasks', { text: 'banana' }), 'No task in this project matches “banana”.')
      assert.include(yield* callTool(access, 'find_tasks', { text: ' ' }), 'Say what to look for')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('finds a task by its pull request and what its lead built, once it ran', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    execFileSync('git', ['config', 'user.name', 'Fake'], { cwd: working })
    execFileSync('git', ['config', 'user.email', 'fake@althar.test'], { cwd: working })
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      const projects = yield* Projects
      const coordinator = yield* Coordinator
      const queries = yield* Queries
      yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
      const { projectId } = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      const threadId = yield* coordinator.thread(projectId)
      const body = 'Add a retry. [coordinator:plan] [lead:finish] [lead:edit] [review:pass]'
      yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
      const cards = Effect.map(Effect.orDie(queries.coordinator(projectId)), (snapshot) =>
        snapshot.items.flatMap((item) => (item.kind === 'task' && item.content.change !== null ? [item.content] : [])),
      )
      const [card] = yield* until(cards, (all) => all.length === 1, Duration.seconds(30))
      assert.deepStrictEqual(yield* found('#1', projectId), ['Add a retry'])
      assert.deepStrictEqual(yield* found(BUILT.split(/\s+/).slice(0, 3).join(' '), projectId), ['Add a retry'])
      const [hit] = yield* findTasks({ text: '1', projectId }, new Set([card?.taskId ?? '']))
      assert.deepStrictEqual([hit?.pullRequest, hit?.phase], ['#1', 'running'])
    }).pipe(
      Effect.provide(
        Queries.layer.pipe(
          Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }), listenEvery: Duration.seconds(5) })),
        ),
      ),
    )
  })
})

describe('reading what was typed', () => {
  it('quotes each word, and finds the words each begins', () => {
    assert.strictEqual(matchOf('retr'), '"retr"*')
    assert.strictEqual(matchOf('  fix "the" login  '), '"fix"* """the"""* "login"*')
    assert.strictEqual(matchOf('# - * ()'), null)
    assert.strictEqual(matchOf(''), null)
    assert.strictEqual(matchOf(Array.from({ length: 20 }, (_, n) => `w${n}`).join(' '))?.split(' ').length, 12)
  })

  it('reads what the index marked as parts', () => {
    assert.deepStrictEqual(partsOf('…the \u0002card\u0003 times \u0002out\u0003'), [
      { text: '…the ', hit: false },
      { text: 'card', hit: true },
      { text: ' times ', hit: false },
      { text: 'out', hit: true },
    ])
    assert.deepStrictEqual(partsOf('nothing marked'), [{ text: 'nothing marked', hit: false }])
  })

  it('names a file from where the task is', () => {
    assert.strictEqual(fileOf('/w/meridian/src/a.ts', ['/w/meridian']), 'src/a.ts')
    assert.strictEqual(fileOf('/w/task/api/src/a.ts', ['/w/task/api/', '/w/task/web']), 'api/src/a.ts')
    assert.strictEqual(fileOf('src/a.ts', ['/w/meridian']), 'src/a.ts')
    assert.isNull(fileOf('/elsewhere/a.ts', ['/w/meridian']))
    assert.isNull(fileOf('/w/meridian-old/a.ts', ['/w/meridian']))
  })
})

describe('where a found task stands', () => {
  const task = {
    taskId: 'task_1',
    state: 'open',
    planState: null,
    startsAt: null,
    waiting: 0,
    runState: null,
    held: 0,
  }

  it('reads as its card does, without git', () => {
    assert.strictEqual(phaseOf({ ...task, state: 'abandoned', waiting: 1 }, none), 'settled')
    assert.strictEqual(phaseOf({ ...task, planState: 'proposed', startsAt: '2026-10-14T09:00:00.000Z' }, none), 'planned')
    assert.strictEqual(phaseOf({ ...task, planState: 'proposed' }, none), 'held')
    assert.strictEqual(phaseOf({ ...task, waiting: 2, runState: 'succeeded' }, none), 'waiting')
    assert.strictEqual(phaseOf({ ...task, state: 'done' }, new Set(['task_1'])), 'running')
    assert.strictEqual(phaseOf({ ...task, state: 'done' }, none), 'settled')
    assert.strictEqual(phaseOf({ ...task, runState: 'succeeded' }, none), 'ready')
    assert.strictEqual(phaseOf({ ...task, runState: 'suspended' }, none), 'stopped')
    assert.strictEqual(phaseOf({ ...task, runState: 'running', held: 1 }, none), 'running')
    assert.strictEqual(phaseOf({ ...task, runState: 'running' }, none), 'stopped')
  })

  it('says it to the coordinator in words', () => {
    const one = (phase: FoundTask['phase'], state = 'open'): FoundTask => ({
      taskId: 'task_1',
      threadId: 'thr_1',
      projectId: 'proj_1',
      title: 'Retry',
      slug: 'retry',
      phase,
      state,
      pullRequest: phase === 'ready' ? '!12' : null,
      changedAt: '2026-10-14T09:00:00.000Z',
      matched: null,
    })
    assert.strictEqual(
      foundWords('retry', [
        one('planned'),
        one('held'),
        one('running'),
        one('waiting'),
        one('ready'),
        one('stopped'),
        one('settled', 'done'),
        one('settled', 'abandoned'),
      ]),
      [
        '- retry: Retry (planned, starting soon; id task_1)',
        '- retry: Retry (planned, held; id task_1)',
        '- retry: Retry (running; id task_1)',
        '- retry: Retry (waiting on the person; id task_1)',
        '- retry: Retry (ready, PR !12; id task_1)',
        '- retry: Retry (stopped; id task_1)',
        '- retry: Retry (finished; id task_1)',
        '- retry: Retry (abandoned; id task_1)',
      ].join('\n'),
    )
  })
})
