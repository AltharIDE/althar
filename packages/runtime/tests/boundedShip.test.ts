import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Holds } from '@althar/provider-adapters/testing'
import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import { Ids } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Deferred, Duration, Effect, Layer, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Policies } from '../src/Policies'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Runs } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { fakeConnectors, HOST, hosted, runtime, until } from './support'

/* A Ship's persisted accepted endpoints survive late commits, first/next publication and retries. */

const git = (cwd: string, ...args: Array<string>) => execFileSync('git', args, { cwd }).toString().trim()

/** The host merges a pull request by squashing it: main gets one commit with its branch's change, and the branch stays as it was. */
const squashMerge = (bare: string, branch: string) => {
  const clone = mkdtempSync(join(tmpdir(), 'althar-merge-'))
  execFileSync('git', ['clone', '-q', bare, clone])
  const as = ['-c', 'user.name=Host', '-c', 'user.email=host@althar.test']
  git(clone, ...as, 'merge', '-q', '--squash', `origin/${branch}`)
  git(clone, ...as, 'commit', '-q', '-m', `Squashed ${branch}`)
  git(clone, 'push', '-q', 'origin', 'main')
}

/** A repository on the fake GitHub, its lead committing as the person does. */
const onGitHub = (more: Omit<Parameters<typeof makeFakeService>[0] & object, 'pushUrl'> = {}) => {
  const { working, bare } = hosted()
  const github = makeFakeService({ pushUrl: () => bare, ...more })
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

const heldAt = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ heldAt: string | null }>`SELECT held_at FROM workspaces WHERE task_id = ${taskId}`
    return row?.heldAt ?? null
  })

/** Waits until the lead's turn is over, nothing of it at work. */
const idle = (threadId: string) =>
  until(
    Effect.flatMap(Sessions, (sessions) => sessions.busy(threadId)),
    (busy) => !busy,
  )

/**
 * A planned task whose lead did its part and whose draft pull request opened, reviewed as `markers` say: ready. In a project
 * that ends its tasks on their branch (`ends`), it opens none.
 */
const opened = (working: string, markers = '[review:pass]', ends?: 'none') =>
  Effect.gen(function* () {
    const connections = yield* Connections
    const instance = yield* Instance
    yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const projects = yield* Projects
    const coordinator = yield* Coordinator
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    if (ends !== undefined) yield* (yield* Policies).set(project.projectId, { end: ends }, instance.personId)
    const threadId = yield* coordinator.thread(project.projectId)
    const body = `Add a retry. [coordinator:plan] [lead:finish] [lead:edit] ${markers}`
    yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
    const [ready] = yield* until(
      cards(project.projectId),
      (all) => all[0]?.phase === 'ready' && (ends !== undefined || all[0].change !== null),
    )
    const card = ready ?? assert.fail('no card')
    yield* idle(card.threadId)
    const sql = yield* SqlClient.SqlClient
    const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${card.taskId}`
    const [turns] = yield* sql<{ n: number }>`SELECT count(*) AS n FROM turn_deliveries WHERE thread_id = ${card.threadId}`
    return { projectId: project.projectId, taskId: card.taskId, threadId: card.threadId, path: workspace?.path ?? '', turns: turns?.n ?? 0 }
  })

const BRANCH = 'althar/add-a-retry'

const commitIn = (path: string, file: string, message: string) => {
  appendFileSync(join(path, file), `${message}\n`)
  git(path, 'add', '-A')
  git(path, '-c', 'user.name=Fake', '-c', 'user.email=fake@althar.test', 'commit', '-q', '-m', message)
}

const shipping = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ state: string; step: string; parameters: string }>`
    SELECT a.state, n.node_key AS step, r.parameters FROM runs r JOIN workflow_executions e ON e.run_id = r.id
    JOIN nodes n ON n.execution_id = e.id JOIN node_attempts a ON a.node_id = n.id
    WHERE r.task_id = ${taskId} AND r.plan_id IS NULL ORDER BY a.admitted_at, a.rowid`
  })

const withHost = (github: FakeService, held?: Holds, file = ':memory:') =>
  Queries.layer.pipe(
    Layer.provideMerge(
      runtime(file, held === undefined ? {} : { holds: held }, { connectors: fakeConnectors({ github }), listenEvery: Duration.hours(1) }),
    ),
  )

const ship = (taskId: string) =>
  Effect.gen(function* () {
    yield* (yield* Runs).ship({ envelope: yield* Runtime.envelope('task.ship', { taskId }), taskId })
  })

const done = (taskId: string) => until(shipping(taskId), (rows) => rows.at(-1)?.step === 'publish' && rows.at(-1)?.state === 'succeeded')

describe('a Ship publishes its accepted boundary', () => {
  for (const mode of ['first pull request', 'next pull request', 'branch only'] as const) {
    it.live(`keeps later commits local when publishing its ${mode}`, () => {
      const { working, bare, github } = onGitHub()
      let reads = true
      const held: Holds = { open: () => undefined, opened: (marker) => marker === '[review:slowly]' && reads }
      return Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const task = yield* opened(working, '[review:slowly]', mode === 'next pull request' ? undefined : 'none')
        if (mode === 'first pull request')
          yield* (yield* Runs).reshape({ taskId: task.taskId, end: 'draft', actorId: (yield* Instance).personId })
        if (mode === 'next pull request') {
          squashMerge(bare, BRANCH)
          github.mergeByHand(1)
          yield* (yield* Changes).refresh(task.taskId)
          yield* until(cards(task.projectId), (all) => all[0]?.phase === 'settled')
        }
        // Commit directly so even a late filesystem commit, without a person-turn hold, must remain held after publication.
        commitIn(task.path, 'accepted.txt', 'Accepted work')
        const reviewed = git(task.path, 'rev-parse', 'HEAD^{tree}')
        reads = false
        yield* ship(task.taskId)
        yield* until(shipping(task.taskId), (rows) => rows.at(-1)?.step === 'review' && rows.at(-1)?.state === 'running')
        commitIn(task.path, 'later.txt', 'Work after the review copied its files')
        const later = git(task.path, 'rev-parse', 'HEAD^{tree}')
        reads = true
        yield* done(task.taskId)
        const [workspace] = yield* sql<{ id: string; branch: string }>`SELECT id, branch FROM workspaces WHERE task_id = ${task.taskId}`
        const branch = workspace?.branch ?? ''
        assert.strictEqual(git(bare, 'rev-parse', `${branch}^{tree}`), reviewed)
        assert.strictEqual(git(task.path, 'rev-parse', 'HEAD^{tree}'), later)
        assert.isNotNull(yield* heldAt(task.taskId))
        assert.lengthOf(github.changes, mode === 'next pull request' ? 2 : mode === 'branch only' ? 0 : 1)
        const [last] = yield* sql<{
          head: string
        }>`SELECT json_extract(parameters, ${`$.ships.heads."${workspace?.id ?? ''}"`}) AS head FROM runs WHERE task_id = ${task.taskId} AND plan_id IS NULL ORDER BY created_at DESC, rowid DESC LIMIT 1`
        assert.strictEqual(git(task.path, 'rev-parse', `${last?.head ?? ''}^{tree}`), reviewed)
      }).pipe(Effect.provide(withHost(github, held)))
    })
  }

  it.live('keeps a commit made while the host opens the pull request held for the next Ship', () => {
    const gate = Deferred.makeUnsafe<void>()
    let holdsOpening = false
    const { working, bare, github } = onGitHub({
      waitsFor: (method) => (method === 'openChange' && holdsOpening ? Deferred.await(gate) : Effect.void),
    })
    return Effect.gen(function* () {
      const task = yield* opened(working, '[coordinator:plan-no-review]', 'none')
      yield* (yield* Runs).reshape({ taskId: task.taskId, end: 'draft', actorId: (yield* Instance).personId })
      commitIn(task.path, 'accepted.txt', 'Accepted before publication')
      const accepted = git(task.path, 'rev-parse', 'HEAD^{tree}')
      holdsOpening = true
      yield* ship(task.taskId)
      yield* until(
        Effect.sync(() => github.calls),
        (calls) => calls.includes('openChange'),
      )
      commitIn(task.path, 'later.txt', 'Committed while the host answers')
      yield* Deferred.succeed(gate, undefined)
      yield* done(task.taskId)
      assert.strictEqual(git(bare, 'rev-parse', `${BRANCH}^{tree}`), accepted)
      assert.isNotNull(yield* heldAt(task.taskId))
    }).pipe(Effect.provide(withHost(github)))
  })

  it.live('does not include a new workspace added after the Ship admitted its work', () => {
    const { working, bare, github } = onGitHub()
    let reads = true
    const held: Holds = { open: () => undefined, opened: (marker) => marker === '[review:slowly]' && reads }
    return Effect.gen(function* () {
      const task = yield* opened(working, '[review:slowly]', 'none')
      yield* (yield* Runs).reshape({ taskId: task.taskId, end: 'draft', actorId: (yield* Instance).personId })
      commitIn(task.path, 'accepted.txt', 'Accepted first change')
      reads = false
      yield* ship(task.taskId)
      yield* until(shipping(task.taskId), (rows) => rows.at(-1)?.step === 'review' && rows.at(-1)?.state === 'running')
      const other = yield* (yield* Projects).startChange({ taskId: task.taskId, name: 'Later change', actorId: (yield* Instance).personId })
      commitIn(other.path, 'unread.txt', 'New change not admitted to this Ship')
      reads = true
      yield* done(task.taskId)
      assert.lengthOf(github.changes, 1)
      const absent = execFileSync('git', ['for-each-ref', '--format=%(refname)', `refs/heads/${other.branch}`], { cwd: bare })
        .toString()
        .trim()
      assert.strictEqual(absent, '')
      assert.isTrue((yield* (yield* Changes).unshipped(task.taskId)).some((one) => one.workspaceId === other.workspaceId))
    }).pipe(Effect.provide(withHost(github, held)))
  })

  it.live('retries a failed first publication after restart using its saved boundary', () => {
    const { working, bare, github } = onGitHub()
    const file = join(mkdtempSync(join(tmpdir(), 'althar-ship-boundary-')), 'althar.sqlite')
    return Effect.gen(function* () {
      const kept = yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const task = yield* opened(working, '[coordinator:plan-no-review]', 'none')
        yield* (yield* Runs).reshape({ taskId: task.taskId, end: 'draft', actorId: (yield* Instance).personId })
        commitIn(task.path, 'accepted.txt', 'Accepted before the failed publication')
        const tree = git(task.path, 'rev-parse', 'HEAD^{tree}')
        github.failNext('openChange', 'rejected', undefined, 422)
        yield* ship(task.taskId)
        const [call] = yield* until(
          sql<{ id: string }>`SELECT id FROM attention_requests WHERE task_id = ${task.taskId} AND kind = 'stuck' AND state = 'open'`,
          (rows) => rows.length === 1,
        )
        assert.lengthOf(github.changes, 0)
        return { ...task, attention: call?.id ?? '', tree }
      }).pipe(Effect.provide(withHost(github, undefined, file)))
      commitIn(kept.path, 'later.txt', 'Unaccepted work while Althar was closed')
      const later = git(kept.path, 'rev-parse', 'HEAD^{tree}')
      yield* Effect.gen(function* () {
        const runs = yield* Runs
        yield* runs.answerStuck({
          envelope: yield* Runtime.envelope('attention.answer_stuck', {}),
          attentionId: kept.attention,
          answer: { kind: 'retry', agentId: 'codex' },
        })
        yield* done(kept.taskId)
        assert.strictEqual(git(bare, 'rev-parse', `${BRANCH}^{tree}`), kept.tree)
        assert.strictEqual(git(kept.path, 'rev-parse', 'HEAD^{tree}'), later)
        assert.isNotNull(yield* heldAt(kept.taskId))
        assert.lengthOf(github.changes, 1)
      }).pipe(Effect.provide(withHost(github, undefined, file)))
    })
  })

  it.live('bounds publication to an attached pull request’s own branch', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* opened(working, '[coordinator:plan-no-review]', 'none')
      const before = git(task.path, 'rev-parse', 'HEAD')
      git(bare, 'update-ref', 'refs/heads/external-change', before)
      const external = github.addPullRequest({
        path: ['meridian', 'api'],
        title: 'External change',
        author: 'you',
        source: 'external-change',
        headSha: before,
      })
      const changes = yield* Changes
      yield* changes.attach({
        taskId: task.taskId,
        pullRequest: `${HOST}/meridian/api/pull/${external.number}`,
        actorId: (yield* Instance).personId,
      })
      commitIn(task.path, 'accepted.txt', 'Accepted attached work')
      const head = git(task.path, 'rev-parse', 'HEAD')
      const accepted = git(task.path, 'rev-parse', 'HEAD^{tree}')
      commitIn(task.path, 'later.txt', 'Attached work for the next Ship')
      const [workspace] = yield* sql<{ id: string }>`SELECT id FROM workspaces WHERE task_id = ${task.taskId}`
      const [run] = yield* sql<{
        id: string
      }>`SELECT id FROM runs WHERE task_id = ${task.taskId} ORDER BY created_at DESC, rowid DESC LIMIT 1`
      // The shared publication helper also obeys a boundary when the attached change is its publication target.
      yield* changes.publish({
        projectId: Schema.decodeUnknownSync(Ids.project.schema)(task.projectId),
        taskId: task.taskId,
        runId: run?.id ?? '',
        end: 'draft',
        ships: true,
        heads: { [workspace?.id ?? '']: head },
      })
      assert.strictEqual(git(bare, 'rev-parse', 'external-change^{tree}'), accepted)
      assert.notStrictEqual(git(task.path, 'rev-parse', 'HEAD^{tree}'), accepted)
      assert.lengthOf(github.changes, 1)
    }).pipe(Effect.provide(withHost(github)))
  })

  it.live('waits for a real matching commit when a review read uncommitted files, then retries only that tree', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* opened(working, '[review:pass]', 'none')
      yield* (yield* Runs).reshape({ taskId: task.taskId, end: 'draft', actorId: (yield* Instance).personId })
      commitIn(task.path, 'accepted.txt', 'Work admitted to Ship')
      appendFileSync(join(task.path, 'uncommitted.txt'), 'The review reads this too\n')
      yield* ship(task.taskId)
      const [call] = yield* until(
        sql<{
          id: string
          detail: string
        }>`SELECT id, json_extract(payload, '$.detail') AS detail FROM attention_requests WHERE task_id = ${task.taskId} AND kind = 'stuck' AND state = 'open'`,
        (rows) => rows.length === 1,
      )
      assert.include(call?.detail ?? '', 'reviewed files have no matching commit')
      assert.lengthOf(github.changes, 0)
      git(task.path, 'add', '-A')
      git(task.path, '-c', 'user.name=Fake', '-c', 'user.email=fake@althar.test', 'commit', '-q', '-m', 'Commit exactly the reviewed files')
      const reviewed = git(task.path, 'rev-parse', 'HEAD^{tree}')
      commitIn(task.path, 'later.txt', 'Not in the review copy')
      yield* (yield* Runs).answerStuck({
        envelope: yield* Runtime.envelope('attention.answer_stuck', {}),
        attentionId: call?.id ?? '',
        answer: { kind: 'retry', agentId: 'codex' },
      })
      yield* done(task.taskId)
      assert.strictEqual(git(bare, 'rev-parse', `${BRANCH}^{tree}`), reviewed)
      assert.isNotNull(yield* heldAt(task.taskId))
    }).pipe(Effect.provide(withHost(github)))
  })

  it.live('refuses to widen an older interrupted Ship that saved no accepted boundary', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* opened(working, '[coordinator:plan-no-review]', 'none')
      yield* (yield* Runs).reshape({ taskId: task.taskId, end: 'draft', actorId: (yield* Instance).personId })
      commitIn(task.path, 'accepted.txt', 'Before a publication failed')
      github.failNext('openChange', 'rejected', undefined, 422)
      yield* ship(task.taskId)
      const [call] = yield* until(
        sql<{ id: string }>`SELECT id FROM attention_requests WHERE task_id = ${task.taskId} AND kind = 'stuck' AND state = 'open'`,
        (rows) => rows.length === 1,
      )
      const remote = git(bare, 'rev-parse', BRANCH)
      // A store written by the older implementation carried neither endpoint nor review copy for this no-review Ship.
      yield* sql`UPDATE runs SET parameters = json_remove(parameters, '$.ships.heads', '$.ships.snapshots') WHERE task_id = ${task.taskId} AND plan_id IS NULL`
      commitIn(task.path, 'later.txt', 'Never accepted by the interrupted Ship')
      yield* (yield* Runs).answerStuck({
        envelope: yield* Runtime.envelope('attention.answer_stuck', {}),
        attentionId: call?.id ?? '',
        answer: { kind: 'retry', agentId: 'codex' },
      })
      const [waiting] = yield* until(
        sql<{
          detail: string
        }>`SELECT json_extract(payload, '$.detail') AS detail FROM attention_requests WHERE task_id = ${task.taskId} AND kind = 'stuck' AND state = 'open'`,
        (rows) => rows.some((row) => row.detail.includes('saved no accepted code boundary')),
      )
      assert.include(waiting?.detail ?? '', 'saved no accepted code boundary')
      assert.strictEqual(git(bare, 'rev-parse', BRANCH), remote)
      assert.lengthOf(github.changes, 0)
    }).pipe(Effect.provide(withHost(github)))
  })

  it.live('holds a person turn that starts during review and commits after Ship finishes', () => {
    const { working, bare, github } = onGitHub()
    let reads = true
    let leads = true
    const held: Holds = {
      open: () => undefined,
      opened: (marker) => (marker === '[review:slowly]' ? reads : marker === '[lead:slowly]' && leads),
    }
    return Effect.gen(function* () {
      const task = yield* opened(working, '[review:slowly]')
      commitIn(task.path, 'accepted.txt', 'Before the review')
      const accepted = git(task.path, 'rev-parse', 'HEAD^{tree}')
      reads = false
      yield* ship(task.taskId)
      yield* until(shipping(task.taskId), (rows) => rows.at(-1)?.step === 'review' && rows.at(-1)?.state === 'running')
      leads = false
      const body = 'Work after this Ship. tidy pls [lead:slowly] [lead:commit]'
      yield* (yield* Sessions).send({
        envelope: yield* Runtime.envelope('thread.send', { threadId: task.threadId, body }),
        threadId: task.threadId,
        body,
      })
      yield* until(
        Effect.flatMap(Sessions, (sessions) => sessions.busy(task.threadId)),
        (busy) => busy,
      )
      reads = true
      yield* done(task.taskId)
      assert.strictEqual(git(bare, 'rev-parse', `${BRANCH}^{tree}`), accepted)
      assert.isNull(yield* heldAt(task.taskId))
      leads = true
      yield* idle(task.threadId)
      yield* until(heldAt(task.taskId), (at) => at !== null)
      assert.notStrictEqual(git(task.path, 'rev-parse', 'HEAD^{tree}'), accepted)
      assert.strictEqual(git(bare, 'rev-parse', `${BRANCH}^{tree}`), accepted)
    }).pipe(Effect.provide(withHost(github, held)))
  })

  it.live('blocks an overlapping person turn from pushing before an initially unheld Ship’s review passes', () => {
    const { working, bare, github } = onGitHub()
    let reads = true
    const held: Holds = { open: () => undefined, opened: (marker) => marker === '[review:slowly]' && reads }
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* opened(working, '[review:slowly]')
      const previous = git(bare, 'rev-parse', BRANCH)
      commitIn(task.path, 'accepted.txt', 'Work the Ship reviews')
      const accepted = git(task.path, 'rev-parse', 'HEAD^{tree}')
      reads = false
      yield* ship(task.taskId)
      yield* until(shipping(task.taskId), (rows) => rows.at(-1)?.step === 'review' && rows.at(-1)?.state === 'running')
      const body = 'A separate later tweak. tidy pls [lead:commit]'
      const sent = yield* (yield* Sessions).send({
        envelope: yield* Runtime.envelope('thread.send', { threadId: task.threadId, body }),
        threadId: task.threadId,
        body,
      })
      yield* until(
        sql<{
          state: string
        }>`SELECT d.state FROM turn_deliveries d JOIN turn_delivery_inputs i ON i.delivery_id = d.id WHERE i.user_input_id = ${sent.inputId ?? ''}`,
        (rows) => rows[0]?.state === 'completed',
      )
      yield* idle(task.threadId)
      yield* until(heldAt(task.taskId), (at) => at !== null)
      assert.strictEqual(git(bare, 'rev-parse', BRANCH), previous)
      reads = true
      yield* done(task.taskId)
      assert.strictEqual(git(bare, 'rev-parse', `${BRANCH}^{tree}`), accepted)
      assert.isNotNull(yield* heldAt(task.taskId))
    }).pipe(Effect.provide(withHost(github, held)))
  })

  for (const mode of ['first', 'next', 'sibling', 'branch-only'] as const) {
    it.live(`routes the public ${mode} pull-request opener through the configured review`, () => {
      const { working, bare, github } = onGitHub()
      let reads = true
      const held: Holds = { open: () => undefined, opened: (marker) => marker === '[review:slowly]' && reads }
      return Effect.gen(function* () {
        const task = yield* opened(working, '[review:slowly]', mode === 'first' || mode === 'branch-only' ? 'none' : undefined)
        if (mode === 'first') yield* (yield* Runs).reshape({ taskId: task.taskId, end: 'draft', actorId: (yield* Instance).personId })
        else if (mode === 'next') {
          squashMerge(bare, BRANCH)
          github.mergeByHand(1)
          yield* (yield* Changes).refresh(task.taskId)
          yield* until(cards(task.projectId), (all) => all[0]?.phase === 'settled')
        }
        const other =
          mode === 'sibling'
            ? yield* (yield* Projects).startChange({ taskId: task.taskId, name: 'Another output', actorId: (yield* Instance).personId })
            : undefined
        const path = other?.path ?? task.path
        const previouslyUp = git(bare, 'rev-parse', BRANCH)
        commitIn(path, 'requires-review.txt', 'This committed work still needs its reviewer')
        const accepted = git(path, 'rev-parse', 'HEAD^{tree}')
        reads = false
        yield* (yield* Runs).publish(task.taskId)
        yield* until(shipping(task.taskId), (rows) => rows.at(-1)?.step === 'review' && rows.at(-1)?.state === 'running')
        assert.lengthOf(github.changes, mode === 'first' || mode === 'branch-only' ? 0 : 1)
        assert.strictEqual(git(bare, 'rev-parse', BRANCH), previouslyUp)
        reads = true
        yield* done(task.taskId)
        assert.lengthOf(github.changes, mode === 'first' || mode === 'branch-only' ? 1 : 2)
        const branch = other?.branch ?? (mode === 'first' || mode === 'branch-only' ? BRANCH : `${BRANCH}-2`)
        assert.strictEqual(git(bare, 'rev-parse', `${branch}^{tree}`), accepted)
        if (mode === 'branch-only') {
          const sql = yield* SqlClient.SqlClient
          const [canonical] = yield* sql<{
            ending: string
          }>`SELECT json_extract(parameters, '$.end') AS ending FROM task_plans WHERE task_id = ${task.taskId} ORDER BY proposed_at DESC, rowid DESC LIMIT 1`
          assert.strictEqual(canonical?.ending, 'none')
          assert.strictEqual(github.changes[0]?.draft, true)
        }
      }).pipe(Effect.provide(withHost(github, held)))
    })
  }
})
