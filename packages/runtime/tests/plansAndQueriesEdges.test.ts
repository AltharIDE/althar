import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeFakeService, type FakeService } from '@althar/connectors/testing'
import { holds } from '@althar/provider-adapters/testing'
import type { ActorId, ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { savePreset } from '../src/presets'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, fakeConnectors, HOST, hosted, repository, runtime, until } from './support'

/*
 * Plans, helpers and what the screens read of them, at their edges: a plan
 * proposed from a preset there's none of, or one that would make work a
 * review; a preset's brief, its review after the merge and the branch a plan
 * works toward as the person changes it, waiting for a place too; a lead's
 * helpers refused, and at work in its task's header; a card's marks for
 * each of a task's changes, by where its pull request stands; and a thread
 * whose turns' kept times can't be read.
 */

/** The runtime over a fake GitHub, with no plan starting by itself while a test looks at it. */
const runtimeWith = (github: FakeService, more: Parameters<typeof runtime>[2] = {}, agents: Parameters<typeof runtime>[1] = {}) =>
  Queries.layer.pipe(
    Layer.provideMerge(
      runtime(':memory:', agents, {
        connectors: fakeConnectors({ github }),
        listenEvery: Duration.hours(1),
        countdown: Duration.hours(1),
        ...more,
      }),
    ),
  )

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Nine', '-c', 'user.email=nine@althar.test', ...args], { cwd })
    .toString()
    .trim()

/** A repository on the fake GitHub, with a release branch beside main there and here. */
const onGitHub = () => {
  const { working, bare } = hosted()
  const github = makeFakeService({ pushUrl: () => bare })
  github.addRepository(['meridian', 'api'])
  git(working, 'branch', 'release/0.8.0')
  git(working, 'push', '-q', bare, 'release/0.8.0')
  git(working, 'update-ref', 'refs/remotes/origin/release/0.8.0', 'release/0.8.0')
  return { working, bare, github }
}

/** A commit on a branch of `cwd`'s, pushed to the host: its hash. */
const pushed = (cwd: string, bare: string, branch: string, file: string) => {
  writeFileSync(join(cwd, file), `${file}\n`)
  git(cwd, 'add', file)
  git(cwd, 'commit', '-q', '-m', `Write ${file}`)
  git(cwd, 'push', '-q', bare, `HEAD:refs/heads/${branch}`)
  return git(cwd, 'rev-parse', 'HEAD')
}

/** GitHub connected, the repository opened as a project, a task in it with its worktree, and the tools of its lead and the coordinator. */
const aProject = (working: string) =>
  Effect.gen(function* () {
    const connections = yield* Connections
    const instance = yield* Instance
    yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const projects = yield* Projects
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    const task = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', { title: 'Add a retry' }),
      projectId: project.projectId,
      title: 'Add a retry',
    })
    const coordinator: ToolAccess = {
      role: 'coordinator',
      projectId: project.projectId,
      threadId: yield* (yield* Coordinator).thread(project.projectId),
      sessionId: 'none',
      taskId: null,
    }
    const lead: ToolAccess = { role: 'lead', projectId: project.projectId, threadId: task.threadId, sessionId: 'none', taskId: task.taskId }
    // The agents' models are usable once their sign-ins are read.
    yield* until(callTool(coordinator, 'list_models', {}), (said) => said.includes('- Claude Large:'))
    return { projectId: project.projectId, task, coordinator, lead, person: instance.personId }
  })

/** The latest plan of a task, by its slug: its id and parameters, and the task's words. */
const planOf = (slug: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ id: string; taskId: string; parameters: string; description: string }>`
      SELECT p.id, p.task_id, p.parameters, k.description FROM task_plans p JOIN tasks k ON k.id = p.task_id
      WHERE k.slug = ${slug} ORDER BY p.rowid DESC LIMIT 1`
    const plan = row ?? assert.fail(`no plan of ${slug}`)
    return { ...plan, parameters: JSON.parse(plan.parameters) as Record<string, unknown> }
  })

const towardOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ toward: string | null }>`SELECT toward FROM workspaces WHERE task_id = ${taskId} ORDER BY created_at LIMIT 1`
    return row?.toward ?? null
  })

/** A planned task whose lead did its part, with no review, in a project with another task: its card and its lead's tools. */
const ranTask = (working: string) =>
  Effect.gen(function* () {
    const { projectId, coordinator } = yield* aProject(working)
    const body = 'Add a backoff. [coordinator:plan] [coordinator:plan-no-review] [lead:finish] [lead:edit]'
    yield* (yield* Coordinator).say({
      envelope: yield* Runtime.envelope('thread.send', { body }),
      threadId: coordinator.threadId,
      body,
      disposition: 'after_current',
    })
    const queries = yield* Queries
    const cards = Effect.map(Effect.orDie(queries.coordinator(projectId)), (snapshot) =>
      snapshot.items.flatMap((item) => (item.kind === 'task' && item.content.title !== 'Add a retry' ? [item.content] : [])),
    )
    const [card] = yield* until(cards, (all) => all[0]?.phase === 'ready')
    const ran = card ?? assert.fail('no card')
    yield* until(
      Effect.flatMap(Sessions, (sessions) => sessions.busy(ran.threadId)),
      (busy) => !busy,
    )
    const sql = yield* SqlClient.SqlClient
    const [session] = yield* sql<{ id: string }>`
      SELECT id FROM provider_sessions WHERE thread_id = ${ran.threadId} ORDER BY started_at DESC LIMIT 1`
    const lead: ToolAccess = { role: 'lead', projectId, threadId: ran.threadId, sessionId: session?.id ?? '', taskId: ran.taskId }
    return { ran, lead }
  })

describe('a lead’s helpers', () => {
  it.live('are a task lead’s, and run on a model it names where it has none of its own at work', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const { lead } = yield* aProject(working)
      const nobody: ToolAccess = { ...lead, taskId: null }
      assert.strictEqual(yield* callTool(nobody, 'start_helper', { name: 'Look', brief: 'Look around.' }), 'Helpers are a task lead’s.')
      assert.strictEqual(yield* callTool(nobody, 'stop_helper', { helper: 'Look' }), 'Helpers are a task lead’s.')
      assert.strictEqual(
        yield* callTool(lead, 'start_helper', { name: 'Look', brief: 'Look around.' }),
        'Name the model it runs on, as list_models writes it.',
      )
      assert.strictEqual(
        yield* callTool(lead, 'start_helper', {
          name: 'Look',
          brief: 'Look around.',
          model: 'Claude Large',
          effort: 'high',
          change: 'Docs',
        }),
        'This task has no change "Docs" here: start_change starts one.',
      )
      const sql = yield* SqlClient.SqlClient
      assert.lengthOf(yield* sql`SELECT id FROM helpers`, 0)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live(
    'at work show in the task’s header and on the round they started in, each by its model, or by its agent where it names none',
    () => {
      const { working, github } = onGitHub()
      return Effect.gen(function* () {
        const { ran, lead } = yield* ranTask(working)
        const queries = yield* Queries
        assert.match(
          yield* callTool(lead, 'start_helper', { name: 'Read the backoff', brief: 'Read it. [lead:slowly]', model: 'Claude Large' }),
          /^Started "Read the backoff" on /,
        )
        assert.match(
          yield* callTool(lead, 'start_helper', {
            name: 'Second look',
            brief: 'Read it too. [lead:slowly]',
            agent: 'codex',
            in_copy: true,
          }),
          /^Started "Second look" on /,
        )
        const thread = yield* until(queries.thread(ran.threadId), (one) => (one.task.helpers ?? []).length === 2)
        assert.deepStrictEqual(
          (thread.task.helpers ?? []).map((one) => [one.name, one.model]),
          [
            ['Read the backoff', 'large'],
            ['Second look', 'codex'],
          ],
        )
        // Each on the round it started in, its lead's only one.
        assert.deepStrictEqual(
          (thread.task.graph ?? []).map((round) => (round.helpers ?? []).map((one) => one.name)),
          [['Read the backoff', 'Second look']],
        )
      }).pipe(Effect.provide(runtimeWith(github, { countdown: Duration.millis(300) }, { holds: holds() })))
    },
  )
})

describe('a plan from a preset', () => {
  it.live('is proposed as given where there’s no such preset, or one that would make work a review', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const { coordinator } = yield* aProject(working)
      yield* callTool(coordinator, 'draft_task', { title: 'Fix a typo', description: 'The README says recieve.' })
      const propose = (preset: string) =>
        callTool(coordinator, 'propose_plan', { task: 'fix-a-typo', lead: { model: 'Claude Large' }, review: null, preset })
      assert.strictEqual(yield* propose('Nope'), "The plan is proposed as you gave it: there's no preset “Nope”. list_presets names them.")
      assert.strictEqual(
        yield* propose('Review a PR'),
        'The plan is proposed as you gave it, but not as Review a PR: Review a PR starts from a pull request.',
      )
      const plan = yield* planOf('fix-a-typo')
      assert.deepInclude(plan.parameters, { end: 'draft', worksIn: 'worktree' })
      assert.isUndefined(plan.parameters.reads)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('lists the person’s own presets after the built-in ones, as theirs', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const { coordinator, person } = yield* aProject(working)
      yield* savePreset({
        name: 'Quick look',
        parts: { workspace: 'copy', checked: 'none', end: 'none', shelf: 'board', lead: null, reviewer: null, brief: '' },
        projectId: null,
        fromTaskId: null,
        actorId: person,
      })
      const listed = (yield* callTool(coordinator, 'list_presets', {})).split('\n')
      assert.strictEqual(listed.at(-1), '- Quick look (theirs): a copy, no review, ends here, the coordinator picks its lead.')
      assert.strictEqual(listed[0], '- Chat: a copy, no review, ends here, the coordinator picks its lead.')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('adds its brief after the task’s own words, once, and one with no brief leaves them as they are', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const { coordinator, person } = yield* aProject(working)
      yield* callTool(coordinator, 'draft_task', { title: 'Fix a typo', description: 'The README says recieve.' })
      yield* callTool(coordinator, 'propose_plan', { task: 'fix-a-typo', lead: { model: 'Claude Large' }, review: null })
      const plans = yield* Plans
      const { id } = yield* planOf('fix-a-typo')
      assert.strictEqual(yield* plans.applyPreset(id, 'prototype', person), 'Prototype')
      const brief = 'The README says recieve.\n\nA prototype: show the idea working, quickly. Its effort follows its size.'
      assert.strictEqual((yield* planOf('fix-a-typo')).description, brief)
      // Picked again, or another with no brief, the words stay as they are.
      yield* plans.applyPreset(id, 'Prototype', person)
      assert.strictEqual(yield* plans.applyPreset(id, 'Change', person), 'Change')
      const now = yield* planOf('fix-a-typo')
      assert.strictEqual(now.description, brief)
      assert.deepInclude(now.parameters, { end: 'draft' })
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('keeps its review after the merge as the person changes its plan, and works toward the branch they point it at', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const { coordinator, person } = yield* aProject(working)
      yield* callTool(coordinator, 'draft_task', { title: 'Fix a typo', description: 'The README says recieve.' })
      yield* callTool(coordinator, 'propose_plan', { task: 'fix-a-typo', lead: { model: 'Claude Large' }, review: null })
      const plans = yield* Plans
      const { id, taskId } = yield* planOf('fix-a-typo')
      yield* plans.applyPreset(id, 'Small change', person)
      const steps = [{ key: 'implement' as const, agentId: 'codex', model: null, skipped: false }]
      yield* plans.change(id, steps, person, undefined, undefined, 'release/0.8.0')
      const changed = yield* planOf('fix-a-typo')
      assert.deepStrictEqual(changed.parameters.steps, steps)
      assert.deepInclude(changed.parameters, { reviewAfterMerge: true, end: 'ready' })
      assert.strictEqual(yield* towardOf(taskId), 'release/0.8.0')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('keeps a review a review, led by an agent that can be held to reading', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const { coordinator, person } = yield* aProject(working)
      git(working, 'switch', '-q', '-c', 'back-off')
      const head = pushed(working, bare, 'back-off', 'backoff.ts')
      git(working, 'switch', '-q', 'main')
      git(working, 'push', '-q', bare, `${head}:refs/pull/1/head`)
      github.addPullRequest({ path: ['meridian', 'api'], title: 'Back off', author: 'dana', source: 'back-off', headSha: head })
      assert.match(
        yield* callTool(coordinator, 'review_pull_request', { pull_request: '#1', lead: { model: 'Claude Large' } }),
        /^Planned review-1-back-off: its lead will review dana's pull request #1/,
      )
      const plans = yield* Plans
      const { id } = yield* planOf('review-1-back-off')
      const refused = yield* Effect.flip(plans.applyPreset(id, 'Small change', person))
      assert.strictEqual((refused as { message?: string }).message, 'A review stays a review.')
      // Codex can't be held to reading: it leads no review, though one with it skipped is fine.
      const lead = { key: 'implement' as const, agentId: 'claude-code', model: 'large', skipped: false }
      const codex = yield* Effect.flip(plans.change(id, [{ ...lead, agentId: 'codex' }], person))
      assert.strictEqual(
        (codex as { message?: string }).message,
        "Fake codex can't be held to reading only: it runs commands its sandbox contains without asking, so it could run this pull request's code. Review it with Fake claude-code or Fake opencode.",
      )
      const steps = [lead, { key: 'review' as const, agentId: 'codex', model: null, skipped: true }]
      yield* plans.change(id, steps, person)
      assert.deepStrictEqual((yield* planOf('review-1-back-off')).parameters.steps, steps)
      // Picked on its card, the review's own preset keeps its steps, the skipped one too.
      assert.strictEqual(yield* plans.applyPreset(id, 'Review a PR', person), 'Review a PR')
      assert.deepInclude((yield* planOf('review-1-back-off')).parameters, { steps, reads: true, end: 'none' })
      // A review has no worktree of its own to start another change beside.
      assert.strictEqual(
        yield* callTool(coordinator, 'start_change', { task: 'review-1-back-off', name: 'Docs' }),
        'Nothing changed for review-1-back-off: The task has no worktree of its own here to start a change beside.',
      )
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})

describe('a plan waiting for a place', () => {
  const GB = 1024 ** 3
  /** A machine with room for one agent at once. */
  const onePlace = { busy: { machine: { cores: 3, memory: 7 * GB } } }

  /** A task the person starts now on Codex, with no review: its plan's id. */
  const started = (projectId: ProjectId, title: string, description: string, person: ActorId) =>
    Effect.gen(function* () {
      const created = yield* (yield* Projects).createTask({
        envelope: yield* Runtime.envelope('task.create', { title }),
        projectId,
        title,
        description,
        draft: true,
      })
      const plans = yield* Plans
      const planId = yield* plans.propose({
        projectId,
        taskId: created.taskId,
        steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
        reason: null,
        actorId: person,
        end: null,
        held: true,
      })
      yield* plans.start(planId, person)
      return { ...created, planId }
    })

  const attempts = (taskId: string) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return yield* sql<{ state: string; holdReason: string | null }>`
        SELECT a.state, a.hold_reason FROM node_attempts a JOIN nodes n ON n.id = a.node_id
        JOIN workflow_executions e ON e.id = n.execution_id JOIN runs r ON r.id = e.run_id
        WHERE r.task_id = ${taskId} ORDER BY a.admitted_at, a.rowid`
    })

  it.live('works in the person’s checkout, toward the branch they point it at, once they change it so', () => {
    const working = repository()
    git(working, 'branch', 'release/0.8.0')
    const github = makeFakeService({})
    return Effect.gen(function* () {
      const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      const person = (yield* Instance).personId
      const projectId = project.projectId as ProjectId
      const first = yield* started(projectId, 'First', 'Work on it. [lead:wait]', person)
      yield* until(attempts(first.taskId), (rows) => rows.at(-1)?.state === 'running')
      const second = yield* started(projectId, 'Second', 'Do it. [lead:finish]', person)
      yield* until(attempts(second.taskId), (rows) => rows.at(-1)?.state === 'held' && rows.at(-1)?.holdReason === 'machine_busy')
      const steps = [{ key: 'implement' as const, agentId: 'claude-code', model: null, skipped: false }]
      yield* (yield* Plans).change(second.planId, steps, person, undefined, 'checkout', 'release/0.8.0')
      const sql = yield* SqlClient.SqlClient
      const [run] = yield* sql<{ parameters: string }>`SELECT parameters FROM runs WHERE task_id = ${second.taskId}`
      assert.deepInclude(JSON.parse(run?.parameters ?? '{}'), { worksIn: 'checkout', steps })
      assert.strictEqual(yield* towardOf(second.taskId), 'release/0.8.0')
      // Still waiting, the first at work in the one place: nothing of it began.
      assert.strictEqual((yield* attempts(second.taskId)).at(-1)?.state, 'held')
    }).pipe(Effect.provide(runtimeWith(github, { ...onePlace, countdown: Duration.millis(300) })))
  })
})

describe('a card of several changes', () => {
  it.live('marks each by where its pull request stands, and says which one a change waits for', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const { task, lead } = yield* aProject(working)
      const sql = yield* SqlClient.SqlClient
      const changeOf = (name: string) =>
        Effect.map(
          sql<{ path: string; branch: string }>`SELECT path, branch FROM workspaces WHERE task_id = ${task.taskId} AND name = ${name}`,
          ([row]) => row ?? assert.fail(`no change ${name}`),
        )
      // Each change's pull request, opened by hand from its branch, which it follows.
      const numbers = new Map<string, number>()
      for (const name of ['Merged', 'Closed', 'Failing', 'Checking', 'Ready', 'Draft']) {
        assert.include(yield* callTool(lead, 'start_change', { name, ...(name === 'Ready' ? { waits_for: 'Checking' } : {}) }), `“${name}”`)
        const change = yield* changeOf(name)
        const pull = github.addPullRequest({
          path: ['meridian', 'api'],
          title: name,
          author: 'nine',
          source: change.branch,
          headSha: pushed(change.path, bare, change.branch, `${name.toLowerCase()}.md`),
          ...(name === 'Draft' ? { draft: true } : {}),
        })
        numbers.set(name, pull.number)
        assert.strictEqual(
          yield* callTool(lead, 'add_part', { part: 'output', pull_request: pull.number, why: 'It opened by hand.' }),
          `${task.slug} follows #${pull.number} now, as a change of its own.`,
        )
      }
      // On the host: one merged, one closed, one's checks failed, and one's still running.
      github.mergeByHand(numbers.get('Merged') ?? 0)
      github.close(numbers.get('Closed') ?? 0)
      github.setChecks(numbers.get('Failing') ?? 0, [{ name: 'test', state: 'failed' }])
      github.setChecks(numbers.get('Checking') ?? 0, [{ name: 'test', state: 'running' }])
      const expected = [
        { name: task.branch, stands: 'unshipped' },
        { name: 'Merged', stands: 'merged' },
        { name: 'Closed', stands: 'closed' },
        { name: 'Failing', stands: 'failing' },
        { name: 'Checking', stands: 'checking' },
        { name: 'Ready', stands: 'ready' },
        { name: 'Draft', stands: 'draft' },
      ]
      // Heard as the person looks at the task: each look has Althar read its pull requests again.
      const changes = yield* Changes
      const queries = yield* Queries
      const card = yield* until(
        Effect.andThen(changes.refresh(task.taskId), queries.card(task.taskId)),
        (one) => JSON.stringify(one.changeMarks) === JSON.stringify(expected),
      )
      assert.strictEqual(card.changeCount, 7)
      // The one that waits says for which, while its pull request is open.
      const ready = [card.change, ...(card.earlier ?? [])].find((one) => one?.title === 'Ready')
      assert.deepStrictEqual(ready?.change, { id: ready?.change?.id ?? '', name: 'Ready', waitsFor: 'Checking' })
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})

describe('a task’s thread', () => {
  it.live('leaves out the times of a turn it can’t read, and still reads', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const { ran } = yield* ranTask(working)
      const queries = yield* Queries
      // Its lead's turn, and its timings.
      const before = yield* queries.thread(ran.threadId)
      assert.isNotEmpty(before.turns ?? [])
      // Kept in a shape this version can't read, as by another one: left out, its turn's items still there.
      const sql = yield* SqlClient.SqlClient
      yield* sql`UPDATE turn_deliveries SET timings = '42' WHERE thread_id = ${ran.threadId}`
      const after = yield* queries.thread(ran.threadId)
      assert.deepStrictEqual(after.turns, [])
      assert.strictEqual(after.task.id, ran.taskId)
      assert.isNotEmpty(after.items)
    }).pipe(Effect.provide(runtimeWith(github, { countdown: Duration.millis(300) })))
  })
})
