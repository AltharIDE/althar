import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeFakeService } from '@althar/connectors/testing'
import { Ids, newId, type ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Deferred, Duration, Effect, Fiber, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Errands } from '../src/Errands'
import { Instance } from '../src/Instance'
import { MergeLine } from '../src/MergeLine'
import { Models } from '../src/Models'
import { Plans } from '../src/Plans'
import { setPlansAndReviews } from '../src/plansAndReviews'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { timestamp } from '../src/records'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, callToolAtOnce, fakeConnectors, HOST, hosted, notices, repository as bare, runtime, until, withWork } from './support'

/*
 * The coordinator accepting a task as the person's Accept on its card does
 * (DEV-209): a task with no pull request merges here, up to the head the
 * coordinator read, and settles; a task's pull request merged on their word
 * settles it too; a stuck step's card is answered as its buttons do. Each acts
 * only on the person's own message in the turn; any other turn leaves a card.
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', ...args], { cwd })
    .toString()
    .trim()

/**
 * A repository with an identity of its own, as the person's has: a merge here
 * that isn't a fast-forward makes a commit, which git refuses without one
 * where nothing global gives it (CI).
 */
const repository = () => {
  const root = bare()
  git(root, 'config', 'user.name', 'T')
  git(root, 'config', 'user.email', 't@t.test')
  return root
}

/** Commits a file in a working tree: its head. */
const commit = (cwd: string, file: string, text: string) => {
  writeFileSync(join(cwd, file), text)
  git(cwd, 'add', '.')
  git(cwd, 'commit', '-q', '-m', `Write ${file}`)
  return git(cwd, 'rev-parse', 'HEAD')
}

/** The project at `path`, its coordinator's thread with a session in the store, and a way to start its turns. */
const coordinatorOf = (path: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path })
    const threadId = yield* (yield* Coordinator).thread(project.projectId)
    const sessionId = yield* newId(Ids.providerSession)
    yield* sql`INSERT INTO provider_sessions ${sql.insert({ id: sessionId, projectId: project.projectId, threadId, agentId: 'codex', state: 'active', startedAt: yield* timestamp })}`
    const access: ToolAccess = { role: 'coordinator', projectId: project.projectId, threadId, taskId: null, sessionId }
    /** A live turn with one message in it, the person's from the window or news's: its message's id. */
    const turn = (body: string, origin: 'person' | 'news' = 'person') =>
      Effect.gen(function* () {
        yield* sql`UPDATE turn_deliveries SET state = 'completed', ended_at = ${yield* timestamp} WHERE thread_id = ${threadId} AND state = 'delivered'`
        const accepted = yield* (yield* Sessions).send({
          envelope: yield* Runtime.envelope('thread.send', {}),
          threadId,
          body,
          sender: origin === 'person' ? { kind: 'window' } : { kind: 'internal' },
          origin: origin === 'person' ? 'system' : 'news',
        })
        const turnId = yield* newId(Ids.turnDelivery)
        yield* sql`INSERT INTO turn_deliveries ${sql.insert({ id: turnId, projectId: project.projectId, threadId, providerSessionId: sessionId, controllerGeneration: 1, state: 'delivered', origin, requestedAt: yield* timestamp, deliveredAt: yield* timestamp })}`
        yield* sql`INSERT INTO turn_delivery_inputs ${sql.insert({ projectId: project.projectId, deliveryId: turnId, userInputId: accepted.inputId, position: 1 })}`
        return accepted.inputId
      })
    return { projectId: project.projectId as ProjectId, threadId, access, turn }
  })

/** A task in the project, with its worktree and a commit on its branch: its slug, thread, worktree and head. */
const changed = (projectId: ProjectId, title: string, file: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const created = yield* (yield* Projects).createTask({ envelope: yield* Runtime.envelope('task.create', {}), projectId, title })
    const [task] = yield* sql<{ slug: string; threadId: string }>`
      SELECT k.slug, t.id AS thread_id FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task' WHERE k.id = ${created.taskId}`
    const head = commit(created.worktree, file, `${title}\n`)
    return { taskId: created.taskId, slug: task?.slug ?? '', threadId: task?.threadId ?? '', worktree: created.worktree, head }
  })

/** A task in the project with no commit of its own: its slug, thread, worktree and head, where its branch still is. */
const unchanged = (projectId: ProjectId, title: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const created = yield* (yield* Projects).createTask({ envelope: yield* Runtime.envelope('task.create', {}), projectId, title })
    const [task] = yield* sql<{ slug: string; threadId: string }>`
      SELECT k.slug, t.id AS thread_id FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task' WHERE k.id = ${created.taskId}`
    const head = git(created.worktree, 'rev-parse', 'HEAD')
    return { taskId: created.taskId, slug: task?.slug ?? '', threadId: task?.threadId ?? '', worktree: created.worktree, head }
  })

/**
 * That the task's work is on main here: its branch, as merging credited it to
 * the person (so not the head's own hash), and the file it wrote.
 */
const landed = (root: string, task: { readonly slug: string }, file: string, text: string) => {
  assert.strictEqual(git(root, 'merge-base', '--is-ancestor', `althar/${task.slug}`, 'main'), '')
  assert.strictEqual(git(root, 'show', `main:${file}`), text)
}

const stateOf = (taskId: string) =>
  Effect.map(
    Effect.flatMap(SqlClient.SqlClient, (sql) => sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${taskId}`),
    ([row]) => row?.state,
  )

/** The runtime with the queries screens read, as the API has it. */
const withQueries = (...args: Parameters<typeof runtime>) => Queries.layer.pipe(Layer.provideMerge(runtime(...args)))

/**
 * Holds the task's lock, as a merge or push under way does, until released:
 * what a call asked meanwhile waits for it.
 */
const holding = (taskId: string) =>
  Effect.gen(function* () {
    const held = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const fiber = yield* Effect.forkChild(
      (yield* Changes).exclusive(taskId, Effect.andThen(Deferred.succeed(held, undefined), Deferred.await(release))),
    )
    yield* Deferred.await(held)
    return Effect.andThen(Deferred.succeed(release, undefined), Fiber.join(fiber))
  })

const titles = (threadId: string) => Effect.map(notices(threadId), (rows) => rows.map((row) => row['title'] ?? ''))

/** The coordinator's cards asking to move a task on. */
const asks = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ id: string; content: string }>`
      SELECT id, content FROM thread_items WHERE thread_id = ${threadId} AND kind = 'task_ask' ORDER BY sequence`
    return rows.map((row) => ({ id: row.id, ...(JSON.parse(row.content) as { move: string; state: string; to?: string }) }))
  })

describe('accept_task, for a task with no pull request', () => {
  it.live('merges it here at the head read, on the person’s word, and settles it; several in one turn', () => {
    const root = repository()
    return Effect.gen(function* () {
      const c = yield* coordinatorOf(root)
      const retry = yield* changed(c.projectId, 'Add a retry', 'retry.ts')
      const cap = yield* changed(c.projectId, 'Cap retries', 'cap.ts')
      // read_task names the head its branch is at: what accepting it goes up to.
      assert.include(yield* callTool(c.access, 'read_task', { task: retry.slug }), `at ${retry.head}`)

      const message = yield* c.turn('Accept the green ones')
      // Without the person's message named, or with one that isn't this turn's, nothing is merged.
      assert.match(yield* callTool(c.access, 'accept_task', { task: retry.slug, head: retry.head }), /Name the person's message/)
      assert.match(
        yield* callTool(c.access, 'accept_task', { task: retry.slug, head: retry.head, message: 'input_elsewhere' }),
        /Name the person's message/,
      )
      // Without the head read, it says where the branch is, and merges nothing.
      assert.include(yield* callTool(c.access, 'accept_task', { task: retry.slug, message }), `${retry.slug}`)
      assert.strictEqual(yield* stateOf(retry.taskId), 'open')

      // Both at once, as one turn's parallel calls reach it: each merges into main here, and is done.
      const said = yield* callToolAtOnce(c.access, 'accept_task', [
        { task: retry.slug, head: retry.head, message },
        { task: cap.slug, head: cap.head, message },
      ])
      for (const one of said) assert.match(one, /^Merged .* into main here, and it is done\. Nothing was pushed/)
      landed(root, retry, 'retry.ts', 'Add a retry')
      landed(root, cap, 'cap.ts', 'Cap retries')
      assert.strictEqual(yield* stateOf(retry.taskId), 'done')
      assert.strictEqual(yield* stateOf(cap.taskId), 'done')
      assert.include(yield* titles(c.threadId), 'Accepted “Add a retry”, merging it here, as you asked: “Accept the green ones”')
      assert.include(
        yield* titles(retry.threadId),
        'The coordinator accepted this task, merging it here, as you asked: “Accept the green ones”',
      )
      assert.include(yield* titles(retry.threadId), 'Merged into main here.')
      assert.lengthOf(yield* asks(c.threadId), 0)
      // Accepted already, a second word changes nothing.
      assert.match(
        yield* callTool(c.access, 'accept_task', { task: retry.slug, head: retry.head, message }),
        /^Nothing changed: .* settled/,
      )
      // Pushing is its own step: this repository's main follows no remote, so there is nothing to push, and it says so.
      assert.match(yield* callTool(c.access, 'push_accepted_task', { task: retry.slug, message }), /^Nothing changed: .*no remote/)
    }).pipe(Effect.provide(runtime()))
  })

  it.live('says there is nothing to merge when the branch has no commits ahead, and leaves it open', () => {
    const root = repository()
    return Effect.gen(function* () {
      const c = yield* coordinatorOf(root)
      const task = yield* unchanged(c.projectId, 'Ask first')
      const message = yield* c.turn('Accept it')
      assert.match(
        yield* callTool(c.access, 'accept_task', { task: task.slug, head: task.head, message }),
        /^Nothing changed: .* has nothing to merge: its work is already in main\./,
      )
      assert.strictEqual(yield* stateOf(task.taskId), 'open')
      assert.notInclude(yield* titles(task.threadId), 'Merged into main here.')
      assert.notInclude(yield* callTool(c.access, 'read_task', { task: task.slug }), 'merged locally')
    }).pipe(Effect.provide(runtime()))
  })

  it.live('refuses a head that moved since it was read', () => {
    const root = repository()
    return Effect.gen(function* () {
      const c = yield* coordinatorOf(root)
      const task = yield* changed(c.projectId, 'Add a retry', 'retry.ts')
      const seen = task.head
      // The lead commits again, then rewrites what was read away.
      commit(task.worktree, 'more.ts', 'more\n')
      git(task.worktree, 'reset', '-q', '--hard', 'HEAD~2')
      commit(task.worktree, 'other.ts', 'other\n')
      const message = yield* c.turn('Accept the retry')
      assert.match(
        yield* callTool(c.access, 'accept_task', { task: task.slug, head: seen, message }),
        /^Nothing changed: .* isn’t at the head you read/,
      )
      assert.strictEqual(yield* stateOf(task.taskId), 'open')
      assert.notStrictEqual(git(root, 'rev-parse', 'main'), seen)
    }).pipe(Effect.provide(runtime()))
  })

  it.live('merges nothing where the person’s turn ended while it waited for the task’s lock', () => {
    const root = repository()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const c = yield* coordinatorOf(root)
      const task = yield* changed(c.projectId, 'Add a retry', 'retry.ts')
      const tip = git(root, 'rev-parse', 'main')
      const message = yield* c.turn('Accept the retry')
      // Something else holds the task: the accept, asked in the turn, waits behind it.
      const release = yield* holding(task.taskId)
      const asked = yield* Effect.forkChild(callTool(c.access, 'accept_task', { task: task.slug, head: task.head, message }))
      yield* Effect.sleep(Duration.millis(300))
      // The turn ends before the lock is let go: the word it was asked on is no longer live.
      yield* sql`UPDATE turn_deliveries SET state = 'completed', ended_at = ${yield* timestamp} WHERE thread_id = ${c.threadId} AND state = 'delivered'`
      yield* release
      assert.match(yield* Fiber.join(asked), /runs only during a live turn/)
      assert.strictEqual(git(root, 'rev-parse', 'main'), tip)
      assert.strictEqual(yield* stateOf(task.taskId), 'open')
    }).pipe(Effect.provide(runtime()))
  })

  it.live('acts on no word whose errand was paused, even one paused while it waited for the task’s lock', () => {
    const root = repository()
    return Effect.gen(function* () {
      const errands = yield* Errands
      const c = yield* coordinatorOf(root)
      const task = yield* changed(c.projectId, 'Add a retry', 'retry.ts')
      const tip = git(root, 'rev-parse', 'main')
      const message = yield* c.turn('Accept the retry once its checks pass')
      // The coordinator kept the word as an errand for this task.
      const errand = yield* errands.keep(c.access, message, [
        {
          key: 'accept',
          tool: 'accept_task',
          taskId: task.taskId,
          target: task.slug,
          request: { head: task.head },
          waits: [{ kind: 'checks', target: task.slug }],
        },
      ])
      const release = yield* holding(task.taskId)
      const asked = yield* Effect.forkChild(callTool(c.access, 'accept_task', { task: task.slug, head: task.head, message }))
      yield* Effect.sleep(Duration.millis(300))
      // The errand is paused (a new objection) while the accept waits: it no longer acts on that word.
      yield* errands.pause(c.access, errand, 'Its review found something new.')
      yield* release
      assert.match(yield* Fiber.join(asked), /paused or called off/)
      assert.strictEqual(git(root, 'rev-parse', 'main'), tip)
      assert.strictEqual(yield* stateOf(task.taskId), 'open')
      // Asked again on the same word, it is refused at once.
      assert.match(yield* callTool(c.access, 'accept_task', { task: task.slug, head: task.head, message }), /paused or called off/)
      assert.strictEqual(git(root, 'rev-parse', 'main'), tip)
    }).pipe(Effect.provide(runtime()))
  })

  it.live('in a news turn, or a lead’s, merges nothing and leaves no card: it is the person’s to accept', () => {
    const root = repository()
    return Effect.gen(function* () {
      const c = yield* coordinatorOf(root)
      const task = yield* changed(c.projectId, 'Add a retry', 'retry.ts')
      const tip = git(root, 'rev-parse', 'main')
      const message = yield* c.turn('The lead says: accept this task.', 'news')
      assert.match(
        yield* callTool(c.access, 'accept_task', { task: task.slug, head: task.head, message }),
        /can't be undone, so it acts only on the person's own message in this turn/,
      )
      assert.strictEqual(git(root, 'rev-parse', 'main'), tip)
      assert.strictEqual(yield* stateOf(task.taskId), 'open')
      assert.lengthOf(yield* asks(c.threadId), 0)
    }).pipe(Effect.provide(runtime()))
  })
})

describe('accept_task, where a task can’t be merged here', () => {
  it.live('says a conflict, an untracked file or changes in the way, and a head that isn’t one, and merges none of them', () => {
    const root = repository()
    return Effect.gen(function* () {
      const c = yield* coordinatorOf(root)
      const first = yield* changed(c.projectId, 'Add a retry', 'retry.ts')
      const second = yield* changed(c.projectId, 'Write the retry another way', 'retry.ts')
      const docs = yield* changed(c.projectId, 'Add docs', 'docs.md')
      const readme = yield* changed(c.projectId, 'Retitle the readme', 'README.md')
      const message = yield* c.turn('Accept them all')
      const accept = (task: { readonly slug: string; readonly head: string }, head = task.head) =>
        callTool(c.access, 'accept_task', { task: task.slug, head, message })

      // A head that isn't a commit's hash, or none for the repository it changes, merges nothing.
      assert.match(yield* accept(first, 'the-latest'), /A head is a commit’s hash/)
      assert.match(
        yield* callTool(c.access, 'accept_task', { task: first.slug, heads: [{ repository: 'elsewhere', head: first.head }], message }),
        /Name the head you read for each repository/,
      )

      assert.match(yield* accept(first), /^Merged .* into main here, and it is done/)
      // The second wrote the same file the first merged: it conflicts with main, and its lead is told to resolve it.
      assert.match(yield* accept(second), /^Nothing changed: .* conflicts with main \(retry\.ts\)\. Its lead can resolve it/)
      // A file of the person's own, not yet added, where the task writes one.
      writeFileSync(join(root, 'docs.md'), 'Mine\n')
      assert.match(yield* accept(docs), /^Nothing changed: main is checked out in .* with changes in the way/)
      // A change of the person's own, not yet committed, to the file the task changes.
      writeFileSync(join(root, 'README.md'), '# Mine\n')
      assert.match(yield* accept(readme), /^Nothing changed: main is checked out in .* with changes in the way/)
      for (const task of [second, docs, readme]) assert.strictEqual(yield* stateOf(task.taskId), 'open')
      assert.strictEqual(git(root, 'show', 'main:README.md'), '# Meridian')
    }).pipe(Effect.provide(runtime()))
  })
})

describe('answer_stuck_step', () => {
  /** A stuck call on the task's step, as its card shows it. */
  const stuck = (projectId: ProjectId, taskId: string, info: Record<string, unknown>) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const id = yield* newId(Ids.attentionRequest)
      yield* sql`INSERT INTO attention_requests ${sql.insert({
        id,
        projectId,
        taskId,
        nodeAttemptId: null,
        kind: 'stuck',
        addresseeActorId: (yield* Instance).personId,
        payload: JSON.stringify({ detail: null, agentId: 'codex', round: 3, open: 1, ...info }),
        state: 'open',
        createdAt: yield* timestamp,
      })}`
      return id
    })
  const answered = (id: string) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const [row] = yield* sql<{ state: string; reason: string | null }>`
        SELECT q.state, d.reason FROM attention_requests q LEFT JOIN decisions d ON d.attention_request_id = q.id WHERE q.id = ${id}`
      return row
    })

  /** A task planned for Claude Code to implement and Codex to review, as its description scripts them, started at once. */
  const planned = (projectId: ProjectId, title: string, description: string) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const plans = yield* Plans
      const actor = (yield* Instance).personId
      const created = yield* (yield* Projects).createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId,
        title,
        description: withWork(description, true),
        draft: true,
      })
      const planId = yield* plans.propose({
        projectId,
        taskId: created.taskId,
        steps: [
          { key: 'implement', agentId: 'claude-code', model: null, skipped: false },
          { key: 'review', agentId: 'codex', model: null, skipped: false },
        ],
        reason: null,
        actorId: actor,
      })
      yield* plans.start(planId, actor)
      const [task] = yield* sql<{ slug: string; threadId: string }>`
        SELECT k.slug, t.id AS thread_id FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task' WHERE k.id = ${created.taskId}`
      return { taskId: created.taskId, slug: task?.slug ?? '', threadId: task?.threadId ?? '' }
    })
  /** The task's open stuck call, once its run makes one: its id, step and why. */
  const stuckCall = (taskId: string) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const [call] = yield* until(
        sql<{ id: string; payload: string }>`
          SELECT id, payload FROM attention_requests WHERE task_id = ${taskId} AND kind = 'stuck' AND state = 'open'`,
        (rows) => rows.length === 1,
      )
      return { id: call?.id ?? '', ...(JSON.parse(call?.payload ?? '{}') as { step: string; why: string }) }
    })
  /** Where the task stands on the board. */
  const phaseOf = (projectId: string, taskId: string) =>
    Effect.gen(function* () {
      const board = yield* Effect.orDie((yield* Queries).board(projectId))
      return board.tasks.find((task) => task.taskId === taskId)?.phase
    })
  /** The agents of the task's reviewers, in the order they started. */
  const reviewers = (taskId: string) =>
    Effect.flatMap(
      SqlClient.SqlClient,
      (sql) => sql<{ agentId: string }>`
        SELECT s.agent_id FROM provider_sessions s JOIN threads t ON t.id = s.thread_id
        WHERE t.task_id = ${taskId} AND t.kind = 'step' AND t.node_key = 'review' ORDER BY s.started_at, s.rowid`,
    )

  it.live('accepts a review out of rounds as it is, at once in any turn, and the task is ready', () => {
    const root = repository()
    return Effect.gen(function* () {
      yield* setPlansAndReviews({ roundsOut: 'ask' })
      const c = yield* coordinatorOf(root)
      // Its reviewer asks for changes every round, so the review runs out of rounds and waits on the person.
      const task = yield* planned(c.projectId, 'Add a retry', '[lead:finish] [review:always]')
      const call = yield* stuckCall(task.taskId)
      assert.deepStrictEqual([call.step, call.why], ['review', 'round_limit'])
      assert.match(
        yield* callTool(c.access, 'read_task', { task: task.slug }),
        /Its review step is stuck, waiting on the person: round limit/,
      )

      // As the card's button, which can be undone: at once, even in a news turn (ADR-097).
      yield* c.turn('The review is out of rounds.', 'news')
      assert.match(
        yield* callTool(c.access, 'answer_stuck_step', { task: task.slug, answer: 'as_is' }),
        /^Accepted .* as it is: the task goes on without another review/,
      )
      yield* until(
        Effect.map(phaseOf(c.projectId, task.taskId), (phase) => (phase === 'ready' ? [phase] : [])),
        (rows) => rows.length === 1,
      )
      assert.include(yield* titles(c.threadId), 'Accepted “Add a retry” as it is')
      assert.include(yield* titles(task.threadId), 'The coordinator accepted this task as it is')
      assert.lengthOf(yield* asks(c.threadId), 0)
    }).pipe(Effect.provide(withQueries(undefined, undefined, { countdown: Duration.millis(50) })))
  })

  it.live('hands a review that never reports to the agent the person names, whose reviewer starts', () => {
    const root = repository()
    return Effect.gen(function* () {
      const c = yield* coordinatorOf(root)
      // Its reviewer never reports, and no other agent is free, so the review waits on the person.
      const task = yield* planned(c.projectId, 'Cap retries', '[lead:finish]')
      const call = yield* stuckCall(task.taskId)
      assert.deepStrictEqual([call.step, call.why], ['review', 'no_report'])
      const message = yield* c.turn('Review it with Claude instead')
      assert.match(
        yield* callTool(c.access, 'answer_stuck_step', { task: task.slug, answer: 'hand_on', agent: 'claude-code', message }),
        /review step goes to claude-code/,
      )
      const started = yield* until(reviewers(task.taskId), (rows) => rows.length === 2)
      assert.deepStrictEqual(
        started.map((one) => one.agentId),
        ['codex', 'claude-code'],
      )
    }).pipe(Effect.provide(withQueries(undefined, undefined, { perUse: ['claude-code', 'opencode'] })))
  })

  it.live(
    'hands a step on by the agent’s name and the model’s name or id, and refuses an unknown one at the call, the step still waiting',
    () => {
      const root = repository()
      return Effect.gen(function* () {
        const c = yield* coordinatorOf(root)
        const task = yield* planned(c.projectId, 'Cap retries', '[lead:finish]')
        const call = yield* stuckCall(task.taskId)
        const message = yield* c.turn('Review it with Claude instead')
        // A model the agent doesn't offer, by name or id: said at the call, which models it does, and nothing is answered.
        for (const model of ['Nonesuch 9', 'nonesuch-9']) {
          const refused = yield* callTool(c.access, 'answer_stuck_step', {
            task: task.slug,
            answer: 'hand_on',
            agent: 'Fake claude-code',
            model,
            message,
          })
          assert.match(refused, /doesn't offer Nonesuch 9|doesn't offer nonesuch-9/)
          assert.match(refused, / It offers: /)
          assert.deepInclude(yield* answered(call.id), { state: 'open' })
        }
        // The agent and the model by their names, kept as their ids.
        assert.match(
          yield* callTool(c.access, 'answer_stuck_step', {
            task: task.slug,
            answer: 'hand_on',
            agent: 'Fake claude-code',
            model: 'Large',
            message,
          }),
          /review step goes to claude-code on large/,
        )
      }).pipe(Effect.provide(withQueries()))
    },
  )

  it.live('hands a step on by the model’s own id, and keeps the agent it was handed to where the model is off for it', () => {
    const root = repository()
    return Effect.gen(function* () {
      const c = yield* coordinatorOf(root)
      const task = yield* planned(c.projectId, 'Cap retries', '[lead:finish]')
      const call = yield* stuckCall(task.taskId)
      const message = yield* c.turn('Review it with Claude instead')
      // Switched off for the agent it is handed to, it isn't taken to another agent that offers it: refused, naming the agent.
      yield* (yield* Models).setModelBlocked({ agentId: 'claude-code', model: 'large', blocked: true })
      const refused = yield* callTool(c.access, 'answer_stuck_step', {
        task: task.slug,
        answer: 'hand_on',
        agent: 'claude-code',
        model: 'large',
        message,
      })
      assert.match(refused, /^The person switched large off for Fake claude-code\./)
      assert.deepInclude(yield* answered(call.id), { state: 'open' })
      yield* (yield* Models).setModelBlocked({ agentId: 'claude-code', model: 'large', blocked: false })
      assert.match(
        yield* callTool(c.access, 'answer_stuck_step', {
          task: task.slug,
          answer: 'hand_on',
          agent: 'claude-code',
          model: 'large',
          message,
        }),
        /review step goes to claude-code on large/,
      )
    }).pipe(Effect.provide(withQueries()))
  })

  it.live('refuses what the card doesn’t offer, and an agent Althar doesn’t have', () => {
    const root = repository()
    return Effect.gen(function* () {
      const c = yield* coordinatorOf(root)
      const task = yield* changed(c.projectId, 'Add a retry', 'retry.ts')
      const call = yield* stuck(c.projectId, task.taskId, { step: 'implement', why: 'looping' })
      const message = yield* c.turn('Skip it')
      assert.match(
        yield* callTool(c.access, 'answer_stuck_step', { task: task.slug, answer: 'skip_review', message }),
        /only a review’s card/,
      )
      assert.match(
        yield* callTool(c.access, 'answer_stuck_step', { task: task.slug, answer: 'again', message }),
        /doesn’t offer trying the lead again/,
      )
      assert.match(
        yield* callTool(c.access, 'answer_stuck_step', { task: task.slug, answer: 'hand_on', agent: 'nobody', message }),
        /Althar has no agent nobody/,
      )
      assert.deepInclude(yield* answered(call), { state: 'open' })
    }).pipe(Effect.provide(runtime()))
  })

  it.live('refuses to try again a step that had no agent, and to hand on a pull request Althar opens or to no agent', () => {
    const root = repository()
    return Effect.gen(function* () {
      const c = yield* coordinatorOf(root)
      const task = yield* changed(c.projectId, 'Add a retry', 'retry.ts')
      const message = yield* c.turn('Try it again')
      assert.match(
        yield* callTool(c.access, 'answer_stuck_step', { task: task.slug, answer: 'again', message }),
        /^Nothing changed: .* has no stuck step waiting on the person/,
      )
      const lost = yield* stuck(c.projectId, task.taskId, { step: 'implement', why: 'no_report', agentId: null })
      assert.match(
        yield* callTool(c.access, 'answer_stuck_step', { task: task.slug, answer: 'again', message }),
        /its implement: it had no agent to try again/,
      )
      assert.match(
        yield* callTool(c.access, 'answer_stuck_step', { task: task.slug, answer: 'hand_on', message }),
        /name the agent to hand it to/,
      )
      assert.deepInclude(yield* answered(lost), { state: 'open' })
      yield* (yield* SqlClient.SqlClient)`UPDATE attention_requests SET state = 'withdrawn' WHERE id = ${lost}`
      yield* stuck(c.projectId, task.taskId, { step: 'publish', why: 'failed' })
      assert.match(
        yield* callTool(c.access, 'answer_stuck_step', { task: task.slug, answer: 'hand_on', agent: 'codex', message }),
        /Althar opens the pull request itself: try it again instead/,
      )
    }).pipe(Effect.provide(runtime()))
  })
})

describe('accepting a task with a pull request', () => {
  it.live('points at merge_pull_request, which settles the task once it merges', () => {
    const { working } = hosted(['meridian', 'api'])
    const service = makeFakeService({ checksFor: () => [{ name: 'test', state: 'passed' }] })
    service.addRepository(['meridian', 'api'])
    const number = service.addPullRequest({ path: ['meridian', 'api'], title: 'Add a retry', author: 'you' }).number
    const url = `https://github.com/meridian/api/pull/${number}`
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const instance = yield* Instance
      const connection = yield* (yield* Connections).connectToken({
        product: 'github',
        token: 't',
        actorId: instance.personId,
        webUrl: HOST,
      })
      const c = yield* coordinatorOf(working)
      const created = yield* (yield* Projects).createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: c.projectId,
        title: 'Add a retry',
      })
      const [task] = yield* sql<{ slug: string }>`SELECT slug FROM tasks WHERE id = ${created.taskId}`
      const at = yield* timestamp
      // Its repository's work went into the pull request, as publishing records it: nothing of it merges here.
      const [workspace] = yield* sql<{ id: string; bindingId: string; branch: string }>`
        SELECT id, binding_id, branch FROM workspaces WHERE task_id = ${created.taskId}`
      const changeSetId = yield* newId(Ids.changeSet)
      yield* sql`INSERT INTO change_sets ${sql.insert({ id: changeSetId, projectId: c.projectId, taskId: created.taskId, runId: null, state: 'published', createdAt: at })}`
      yield* sql`INSERT INTO repository_changes ${sql.insert({
        id: yield* newId(Ids.repositoryChange),
        projectId: c.projectId,
        changeSetId,
        bindingId: workspace?.bindingId ?? '',
        workspaceId: workspace?.id ?? '',
        branch: workspace?.branch ?? '',
        pullRequestUrl: url,
        pullRequestState: 'ready',
        createdAt: at,
        updatedAt: at,
      })}`
      yield* sql`INSERT INTO external_links ${sql.insert({
        id: `xlink_${'7'.repeat(32)}`,
        projectId: c.projectId,
        taskId: created.taskId,
        connectionId: connection.id,
        product: 'github',
        kind: 'change',
        externalId: String(number),
        ref: String(number),
        key: String(number),
        url,
        snapshot: JSON.stringify({
          number,
          title: 'Add a retry',
          url,
          state: 'open',
          draft: false,
          headSha: `head-${number}`,
          additions: null,
          deletions: null,
          changedFiles: null,
          repository: ['meridian', 'api'],
          words: { noun: 'pull request', short: 'PR', prefix: '#' },
          checks: null,
          target: 'main',
        }),
        listening: 1,
        createdAt: at,
        updatedAt: at,
      })}`
      const message = yield* c.turn('Accept and merge the retry')
      // Its work is in its pull request: accepting names merge_pull_request with its link and head, and changes nothing itself.
      const said = yield* callTool(c.access, 'accept_task', { task: task?.slug ?? '', message })
      assert.include(said, url)
      assert.include(said, `head-${number}`)
      assert.include(said, 'merge_pull_request')
      assert.strictEqual(yield* stateOf(created.taskId), 'open')

      assert.match(
        yield* callTool(c.access, 'merge_pull_request', { pull_request: `#${number}`, head: `head-${number}`, message }),
        /^Merged PR #1 at head-1 into main/,
      )
      // Merged, its task hears it at once and settles as done, with no settle_task after.
      yield* until(stateOf(created.taskId), (state) => state === 'done')
      yield* Effect.flatMap(MergeLine, (line) => line.tick(c.projectId))
    }).pipe(
      Effect.provide(
        runtime(
          ':memory:',
          {},
          { connectors: fakeConnectors({ github: service }), mergeLineEvery: Duration.infinity, signedOut: ['claude-code'] },
        ),
      ),
    )
  })
})
