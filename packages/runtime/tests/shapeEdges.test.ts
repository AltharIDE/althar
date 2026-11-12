import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { savePreset } from '../src/presets'
import { PlanParameters, type PlanStep, Runs } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import { TaskActions } from '../src/TaskActions'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, fakeConnectors, HOST, hosted, items, runtime, until } from './support'

/*
 * A task's shape at its edges (a task is a conversation plus parts, "Changing parts"): the preset, review and ending moves
 * change_part, make_it_a_change and the window's Make it a… make on a task with a plan, what each refuses and why in
 * words, a review moved to after the merge and back, a preset that works in the person's checkout, and a project on no
 * code host Althar knows, whose work stays on its branch.
 */

const runtimeWith = (github: FakeService) =>
  Queries.layer.pipe(
    Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }), listenEvery: Duration.hours(1) })),
  )

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Nine', '-c', 'user.email=nine@althar.test', ...args], { cwd })
    .toString()
    .trim()

const onGitHub = () => {
  const { working, bare } = hosted()
  const github = makeFakeService({ pushUrl: () => bare })
  github.addRepository(['meridian', 'api'])
  return { working, bare, github }
}

const LEAD: PlanStep = { key: 'implement', agentId: 'claude-code', model: null, skipped: false }

const planOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ parameters: string }>`
      SELECT parameters FROM task_plans WHERE task_id = ${taskId} ORDER BY proposed_at DESC LIMIT 1`
    return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PlanParameters))(row?.parameters ?? '')
  })

/**
 * A task in the repository opened as a project, GitHub connected unless `unhosted`, planned with `steps` and held, so nothing
 * runs until a test starts it; with its lead's tools and the coordinator's.
 */
const planned = (working: string, steps: ReadonlyArray<PlanStep> = [LEAD], unhosted = false, description?: string) =>
  Effect.gen(function* () {
    const instance = yield* Instance
    if (!unhosted) yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const projects = yield* Projects
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    const task = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', { title: 'Add a retry' }),
      projectId: project.projectId,
      title: 'Add a retry',
      ...(description === undefined ? {} : { description }),
    })
    const planId = yield* (yield* Plans).propose({
      projectId: project.projectId as ProjectId,
      taskId: task.taskId,
      steps,
      reason: null,
      actorId: instance.personId,
      held: true,
    })
    const lead: ToolAccess = { role: 'lead', projectId: project.projectId, threadId: task.threadId, sessionId: 'none', taskId: task.taskId }
    const coordinator: ToolAccess = {
      role: 'coordinator',
      projectId: project.projectId,
      threadId: yield* (yield* Coordinator).thread(project.projectId),
      sessionId: 'none',
      taskId: null,
    }
    return { ...task, projectId: project.projectId, planId, lead, coordinator }
  })

const phaseOf = (projectId: string, taskId: string) =>
  Effect.gen(function* () {
    const snapshot = yield* Effect.orDie((yield* Queries).coordinator(projectId))
    const card = snapshot.items.find((item) => item.kind === 'task' && item.content.taskId === taskId)
    return card?.kind === 'task' ? card.content.phase : undefined
  })

describe('a task’s shape, at its edges', () => {
  it.live('refuses a preset, an ending, a title or a task it can’t take, each in words', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* planned(working)
      const change = (args: Record<string, unknown>) => callTool(task.lead, 'change_part', { why: 'the person asked', ...args })
      assert.strictEqual(yield* change({ part: 'preset', preset: 'Nope' }), 'There’s no preset “Nope”. list_presets names them.')
      assert.strictEqual(yield* change({ part: 'preset', preset: '  ' }), 'Name the preset (preset), as list_presets names it.')
      // Work never becomes a review of someone else's pull request.
      assert.strictEqual(
        yield* change({ part: 'preset', preset: 'Review a PR' }),
        `Review a PR reads someone else’s pull request: add_review gives ${task.slug} one to review.`,
      )
      assert.strictEqual(yield* change({ part: 'ending' }), `Say how ${task.slug} ends (end): here, branch, draft or ready.`)
      // make_it_a_change on a planned task asks for a title it can use.
      const make = (title: string) => callTool(task.lead, 'make_it_a_change', { title, review: null, output: 'draft' })
      assert.strictEqual(yield* make('  '), 'Give it a title: what the change does, in a few words.')
      assert.strictEqual(yield* make('x'.repeat(61)), 'That title is 61 characters. Keep it to 60: what the change does, in a few words.')
      // change_lead from the coordinator names a task; a task with no plan has no team to change yet.
      assert.notMatch(yield* callTool(task.coordinator, 'change_lead', { review: { agent: 'codex' }, why: 'the person asked' }), /^Changed/)
      const projects = yield* Projects
      const bare = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', { title: 'Tidy' }),
        projectId: task.projectId,
        title: 'Tidy',
      })
      const bareLead: ToolAccess = { ...task.lead, threadId: bare.threadId, taskId: bare.taskId }
      assert.strictEqual(
        yield* callTool(bareLead, 'change_lead', { review: { agent: 'codex' }, why: 'the person asked' }),
        `${bare.slug} has no plan yet: propose_plan plans it, with its team.`,
      )
      // Its shape, changed by the runtime: refused for a task that isn't there, one abandoned, and one with no plan.
      const runs = yield* Runs
      const instance = yield* Instance
      const reshaped = (taskId: string) => Effect.flip(runs.reshape({ taskId, end: 'draft', actorId: instance.personId }))
      assert.strictEqual(((yield* reshaped('task_nothing')) as { _tag: string })._tag, 'NotFound')
      assert.deepInclude(yield* reshaped(bare.taskId), { why: 'no_lead' })
      const sql = yield* SqlClient.SqlClient
      yield* sql`UPDATE tasks SET state = 'abandoned' WHERE id = ${bare.taskId}`
      assert.deepInclude(yield* reshaped(bare.taskId), { why: 'abandoned' })
      // A review it never had, taken off, changes nothing.
      assert.match(
        yield* callTool(task.lead, 'remove_part', { part: 'checked_by' }),
        /^Nothing changed: add-a-retry has those parts already\./,
      )
      // A review of someone else's pull request has no work of its own: no review of it, and no preset of work.
      yield* sql`UPDATE task_plans SET parameters = json_set(parameters, '$.reads', json('true')) WHERE task_id = ${task.taskId}`
      assert.strictEqual(
        yield* change({ part: 'checked_by', review: { agent: 'codex' } }),
        `${task.slug} reviews someone else’s pull request: it has no work of its own to review.`,
      )
      assert.strictEqual(
        yield* change({ part: 'preset', preset: 'Change' }),
        `${task.slug} reviews someone else’s pull request: to fix what it found here, add_part takes a worktree for it.`,
      )
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('ends in a pull request with no review, with its branch once its ending is taken off, and says why it didn’t ship', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* planned(working)
      assert.match(
        yield* callTool(task.lead, 'change_part', { part: 'ending', end: 'ready', why: 'the person asked' }),
        /changed its parts: ending in a pull request ready for review\. .* Ship opens its pull request: call ship_task .*, and it ships once your turn ends;/,
      )
      assert.match(yield* callTool(task.lead, 'remove_part', { part: 'ending' }), /changed its parts: ending with its branch\./)
      assert.strictEqual((yield* planOf(task.taskId)).end, 'none')
      // Asked to ship it too, with nothing yet to ship: what changed is said, and why it didn't ship.
      assert.match(
        yield* callTool(task.coordinator, 'change_part', { task: task.slug, part: 'ending', end: 'draft', ship: true }),
        /^add-a-retry: changed its parts: ending in a draft pull request\. .* It didn’t ship: Nothing waits to ship\.$/,
      )
      assert.strictEqual((yield* planOf(task.taskId)).end, 'draft')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('moves its review to after the merge, keeps it there, and takes it off; a reviewer named with its effort goes on', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      // Its reviewer, Claude on another model than its lead's, is the one it keeps.
      const task = yield* planned(working, [LEAD, { key: 'review', agentId: 'claude-code', model: 'large', skipped: false }])
      const change = (args: Record<string, unknown>) => callTool(task.lead, 'change_part', { why: 'the person asked', ...args })
      assert.match(yield* change({ part: 'preset', preset: 'Small change' }), /made it a Small change: reviewed by .+ after it merges/)
      const after = yield* planOf(task.taskId)
      assert.isTrue(after.reviewAfterMerge)
      assert.deepStrictEqual(
        after.steps.map((step) => [step.key, step.model, step.skipped]),
        [
          ['implement', null, false],
          ['review', 'large', true],
        ],
      )
      // The same again changes nothing; its ending changes with its review still after the merge.
      assert.match(yield* change({ part: 'preset', preset: 'Small change' }), /^Nothing changed: add-a-retry has those parts already\./)
      assert.match(yield* change({ part: 'ending', end: 'ready' }), /ending in a pull request ready for review/)
      assert.deepStrictEqual([(yield* planOf(task.taskId)).end, (yield* planOf(task.taskId)).reviewAfterMerge], ['ready', true])
      // Taken off: nothing reads it after the merge either.
      assert.match(yield* callTool(task.lead, 'remove_part', { part: 'checked_by', why: 'the person said no review' }), /no review/)
      assert.isUndefined((yield* planOf(task.taskId)).reviewAfterMerge)
      // Put back, by the model and effort named.
      assert.match(
        yield* change({ part: 'checked_by', review: { agent: 'codex', model: 'large', effort: 'high' } }),
        /changed its parts: reviewed by /,
      )
      const review = (yield* planOf(task.taskId)).steps.find((step) => step.key === 'review')
      assert.deepStrictEqual([review?.agentId, review?.model, review?.effort, review?.skipped], ['codex', 'large', 'high', false])
      // The person's own preset, reviewed after the merge by an agent it names alone, on that agent's own model.
      const instance = yield* Instance
      yield* savePreset({
        name: 'Quick fix',
        parts: { workspace: 'worktree', checked: 'after', shelf: 'board', lead: null, reviewer: 'claude-code', brief: '' },
        projectId: null,
        fromTaskId: null,
        actorId: instance.personId,
      })
      assert.match(yield* change({ part: 'preset', preset: 'Quick fix' }), /made it a Quick fix: reviewed by .+ after it merges/)
      const quick = (yield* planOf(task.taskId)).steps.find((step) => step.key === 'review')
      assert.deepStrictEqual([quick?.agentId, quick?.skipped], ['claude-code', true])
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('makes a planned task a change in place with no review, and takes a review off one made a change before', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* planned(working)
      const make = (review: Record<string, unknown> | null, output: 'draft' | 'ready') =>
        callTool(task.lead, 'make_it_a_change', { title: 'Retry for real', review, output })
      assert.match(
        yield* make(null, 'ready'),
        /^The task is a change now, called “Retry for real”, with no review, ending in a pull request ready for review\. Commit your work: Ship opens its pull request/,
      )
      assert.deepStrictEqual(
        (yield* planOf(task.taskId)).steps.map((step) => step.key),
        ['implement'],
      )
      assert.match(
        yield* make({ agent: 'codex' }, 'draft'),
        /reviewed by .+, ending in a draft pull request\. .*Ship runs its review, then opens/,
      )
      // Its review, once on, is taken off as the person asks, its row kept to add back.
      assert.match(yield* make(null, 'draft'), /with no review/)
      assert.deepStrictEqual(
        (yield* planOf(task.taskId)).steps.map((step) => [step.key, step.skipped]),
        [
          ['implement', false],
          ['review', true],
        ],
      )
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('keeps a task on no code host Althar knows on its branch as it becomes a change, made one in place or by Change', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* planned(working, [LEAD], true)
      assert.match(
        yield* callTool(task.lead, 'make_it_a_change', { title: 'Retry for real', review: { agent: 'codex' }, output: 'draft' }),
        /ending on its branch: its repository isn’t on a code host Althar knows\. Commit your work: its review reads it, and it stays on its branch here/,
      )
      assert.isNull((yield* planOf(task.taskId)).end ?? null)
      // From a prototype, which pushes its branch, Change follows the project: on its branch, nothing going up.
      yield* (yield* Runs).reshape({ taskId: task.taskId, end: 'none', actorId: (yield* Instance).personId })
      assert.match(
        yield* callTool(task.lead, 'change_part', { part: 'preset', preset: 'Change', why: 'the person asked' }),
        /made it a Change: .*ending on its branch, its repository on no code host Althar knows/,
      )
      const plan = yield* planOf(task.taskId)
      assert.deepStrictEqual([plan.end ?? null, plan.endChosen ?? false], [null, false])
      assert.match(
        yield* callTool(task.lead, 'make_it_a_change', { title: 'Retry for real', review: null, output: 'draft' }),
        /with no review, ending on its branch: .* Commit your work: it stays on its branch here, with no pull request to open\./,
      )
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('makes a task another preset from the window, said once in its thread, and refuses one that isn’t there', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* planned(working)
      const actions = yield* TaskActions
      const personId = (yield* Instance).personId
      const lines = Effect.map(items(task.threadId), (all) =>
        all.flatMap((item) => (item.kind === 'notice' && String(item.content.title).startsWith('You made it') ? [item.content.title] : [])),
      )
      yield* actions.shape(task.taskId, 'Change', personId)
      assert.lengthOf(yield* lines, 1)
      assert.match(String((yield* lines)[0]), /^You made it a Change: reviewed by .+, ending in a draft pull request/)
      // The same again changes nothing, and says nothing.
      yield* actions.shape(task.taskId, 'Change', personId)
      assert.lengthOf(yield* lines, 1)
      yield* savePreset({
        name: 'Over the wire',
        parts: { workspace: 'worktree', checked: 'none', end: 'none', shelf: 'board', lead: null, reviewer: null, brief: '' },
        projectId: null,
        fromTaskId: null,
        actorId: personId,
      })
      yield* actions.shape(task.taskId, 'Over the wire', personId)
      assert.match(String((yield* lines)[1]), /^You made it an Over the wire: no review, ending with its branch/)
      assert.strictEqual(
        ((yield* Effect.flip(actions.shape('task_nothing', 'Change', personId))) as { message: string }).message,
        'That task isn’t here any more.',
      )
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('moves a task at work to the person’s checkout with a preset that works there, once it can, and back', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const instance = yield* Instance
      const task = yield* planned(working, [LEAD], false, '[lead:finish]')
      yield* (yield* Plans).start(task.planId, instance.personId)
      yield* until(phaseOf(task.projectId, task.taskId), (phase) => phase === 'ready')
      // The person's own preset: in their checkout, reviewed by Codex on its large model, ending ready for review.
      yield* savePreset({
        name: 'On my checkout',
        parts: { workspace: 'local', checked: 'before', end: 'ready', shelf: 'board', lead: null, reviewer: 'codex/large', brief: '' },
        projectId: null,
        fromTaskId: null,
        actorId: instance.personId,
      })
      const change = (preset: string) => callTool(task.lead, 'change_part', { part: 'preset', preset, why: 'the person asked' })
      const head = () => git(working, 'rev-parse', '--abbrev-ref', 'HEAD')
      assert.match(
        yield* change('On my checkout'),
        /made it an On my checkout: Local, reviewed by .+, ending in a pull request ready for review/,
      )
      assert.strictEqual(head(), task.branch)
      assert.strictEqual((yield* planOf(task.taskId)).steps.find((step) => step.key === 'review')?.model, 'large')
      // Back to a worktree of its own, as Change works.
      assert.match(yield* change('Change'), /made it a Change: a worktree of its own/)
      assert.strictEqual(head(), 'main')
      // Their checkout has changes of theirs: it moves there once it can, and their file is never touched.
      writeFileSync(join(working, 'Board.tsx'), 'export {}\n')
      assert.match(yield* change('On my checkout'), /made it an On my checkout: Local once it can/)
      assert.strictEqual(head(), 'main')
      assert.strictEqual(git(working, 'status', '--porcelain'), '?? Board.tsx')
      // Its review, at work, moved to after the merge.
      assert.match(yield* change('Small change'), /made it a Small change: reviewed by .+ after it merges/)
      assert.isTrue((yield* planOf(task.taskId)).reviewAfterMerge)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('asks the person before a preset takes their checkout off a branch of their own', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const instance = yield* Instance
      const task = yield* planned(working, [LEAD], false, '[lead:finish]')
      yield* (yield* Plans).start(task.planId, instance.personId)
      yield* until(phaseOf(task.projectId, task.taskId), (phase) => phase === 'ready')
      yield* savePreset({
        name: 'Here and now',
        parts: { workspace: 'local', checked: 'none', end: 'none', shelf: 'board', lead: null, reviewer: null, brief: '' },
        projectId: null,
        fromTaskId: null,
        actorId: instance.personId,
      })
      git(working, 'switch', '-q', '-c', 'my-spike')
      assert.match(
        yield* callTool(task.lead, 'change_part', { part: 'preset', preset: 'Here and now', why: 'the person asked' }),
        /made it a Here and now: Local once the person says whether to switch their checkout/,
      )
      assert.strictEqual(git(working, 'rev-parse', '--abbrev-ref', 'HEAD'), 'my-spike')
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})
