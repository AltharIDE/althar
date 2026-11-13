import { execFileSync } from 'node:child_process'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { partsOfTask, savePreset } from '../src/presets'
import { offerable } from '../src/reviewOffer'
import { PlanParameters, Runs } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, fakeConnectors, HOST, hosted, items, notices, runtime, until } from './support'

/*
 * Every part of a task changes either way on the person's word to its lead (a task is a conversation plus parts; the person's
 * note of 12 November): a prototype becomes a change in one move, its reviewer added and its pull request ending set, and Ship
 * then runs the review and opens the pull request; a change goes back to a prototype, its review off and its pull request
 * closed, its branch staying; the ending, the reviewer and the lead change on the lead's own task, with nothing refused.
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
  return { working, bare, github }
}

const cards = (projectId: string) =>
  Effect.gen(function* () {
    const snapshot = yield* Effect.orDie((yield* Queries).coordinator(projectId))
    return snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : []))
  })

const planOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ parameters: string }>`
      SELECT parameters FROM task_plans WHERE task_id = ${taskId} ORDER BY proposed_at DESC LIMIT 1`
    return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PlanParameters))(row?.parameters ?? '')
  })

/** The state of the task's latest review, of any run of it. */
const reviewOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ state: string }>`
      SELECT a.state FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id
      JOIN runs r ON r.id = e.run_id WHERE r.task_id = ${taskId} AND n.node_key = 'review' ORDER BY a.rowid DESC LIMIT 1`
    return row?.state
  })

/**
 * A task the coordinator planned, run to its ending: with its review, or, `prototype`, with none and ending with its branch;
 * or, `reviewing`, a change whose review is under way, held there until something stops it.
 */
const finished = (working: string, prototype: boolean, reviewing = false) =>
  Effect.gen(function* () {
    const instance = yield* Instance
    yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    const coordinator = yield* Coordinator
    const threadId = yield* coordinator.thread(project.projectId)
    const body = `Add a retry. ${prototype ? '[coordinator:plan-no-review] ' : ''}[coordinator:plan] [lead:finish] [lead:edit] ${reviewing ? '[review:wait]' : '[review:pass]'}`
    yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
    const [card] = yield* until(cards(project.projectId), (all) => all[0] !== undefined && all[0].plan !== null)
    const task = card ?? assert.fail('no card')
    // A prototype's shape: no review, ending with its branch, as the Prototype preset plans it.
    if (prototype) yield* (yield* Runs).reshape({ taskId: task.taskId, end: 'none', actorId: instance.personId })
    if (reviewing) yield* until(reviewOf(task.taskId), (state) => state === 'running')
    else yield* until(cards(project.projectId), (all) => all[0]?.phase === 'ready')
    const sql = yield* SqlClient.SqlClient
    const [session] = yield* sql<{ id: string }>`
      SELECT id FROM provider_sessions WHERE thread_id = ${task.threadId} ORDER BY started_at DESC LIMIT 1`
    const lead: ToolAccess = {
      role: 'lead',
      projectId: project.projectId,
      threadId: task.threadId,
      sessionId: session?.id ?? '',
      taskId: task.taskId,
    }
    return { projectId: project.projectId, taskId: task.taskId, threadId: task.threadId, lead }
  })

describe('a task’s parts, both ways, on its lead’s word', () => {
  it.live('makes a prototype a change in one move, and Ship then runs the review and opens its pull request', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* finished(working, true)
      // A prototype: its branch pushed, no review and no pull request.
      assert.lengthOf(github.changes, 0)
      assert.include(git(bare, 'branch', '--list'), 'althar/add-a-retry')
      assert.isTrue((yield* cards(task.projectId))[0]?.reviewerChange === 'now')

      // "Make it a real change": one call, on the lead's own task, with nothing asked of the person.
      const said = yield* callTool(task.lead, 'change_part', { part: 'preset', preset: 'Change', why: 'the person asked' })
      assert.match(said, /^add-a-retry: made it a Change: reviewed by .+, ending in a draft pull request\./)
      assert.match(said, /Ship runs its review, then opens its pull request/)
      const plan = yield* planOf(task.taskId)
      assert.deepStrictEqual(
        plan.steps.map((step) => [step.key, step.skipped]),
        [
          ['implement', false],
          ['review', false],
        ],
      )
      assert.strictEqual(plan.end, 'draft')
      assert.isTrue(
        (yield* notices(task.threadId)).some((one) => String(one['title']).startsWith('Its lead made it a Change: reviewed by ')),
      )
      // Nothing is up as a pull request, so no review runs before Ship.
      assert.lengthOf(github.changes, 0)

      // Ship, as the person's button or ship_task on their word: the review runs, then the pull request opens.
      yield* callTool(task.lead, 'ship_task', { why: 'the person asked' })
      const [opened] = yield* until(
        Effect.sync(() => github.changes),
        (all) => all.length === 1,
      )
      assert.deepStrictEqual([opened?.source, opened?.draft], ['althar/add-a-retry', true])
      // Its review ran first, over everything since the task started.
      const reviewed = (yield* items(task.threadId)).find((item) => item.kind === 'step_result' && item.content.step === 'review')
      assert.strictEqual(reviewed?.kind === 'step_result' ? reviewed.content.verdict : undefined, 'pass')
      const [card] = yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready' && all[0].change !== null)
      assert.strictEqual(card?.reviewerChange, 'next_ship')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('makes a change a prototype again: its review off, its pull request closed, back to its branch', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* finished(working, false)
      const [card] = yield* until(cards(task.projectId), (all) => all[0]?.change?.state === 'open')
      assert.isTrue(card?.change?.draft)

      // Ready for review, then the reviewer changed, then back to a prototype: each on the lead's own word.
      assert.match(
        yield* callTool(task.lead, 'change_part', { part: 'ending', end: 'ready', why: 'the person asked' }),
        /ending in a pull request ready for review, PR #1 marked ready for review/,
      )
      assert.isFalse(github.changes[0]?.draft)
      // Back to a draft: no host turns one back, so it stays ready, and the next opens as a draft.
      assert.match(
        yield* callTool(task.lead, 'change_part', { part: 'ending', end: 'draft', why: 'the person asked' }),
        /ending in a draft pull request, PR #1 stays ready for review, and the next opens as a draft/,
      )
      assert.isFalse(github.changes[0]?.draft)
      assert.match(
        yield* callTool(task.lead, 'change_part', { part: 'checked_by', review: { agent: 'claude-code' }, why: 'the person asked' }),
        /reviewed by .+, reading what ships next/,
      )
      const said = yield* callTool(task.lead, 'change_part', { part: 'preset', preset: 'Prototype', why: 'the person asked' })
      assert.match(said, /made it a Prototype: no review, ending with its branch, PR #1 closed, its branch staying/)
      assert.strictEqual(github.changes[0]?.state, 'closed')
      const plan = yield* planOf(task.taskId)
      assert.strictEqual(plan.end, 'none')
      assert.isTrue(plan.steps.every((step) => step.key !== 'review' || step.skipped))
      // Its lead stays: change_lead changes it, on the lead's own task too.
      assert.match(
        yield* callTool(task.lead, 'change_lead', { lead: { agent: 'codex' }, why: 'the person asked' }),
        /changed the lead to .+\. It takes over from its next turn\./,
      )
      assert.strictEqual((yield* planOf(task.taskId)).steps.find((step) => step.key === 'implement')?.agentId, 'codex')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('takes the review off and puts it back, and makes it a chat, all on the lead’s own task', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* finished(working, true)
      assert.match(
        yield* callTool(task.lead, 'add_part', { part: 'checked_by', why: 'the person asked for a review' }),
        /changed its parts: reviewed by /,
      )
      assert.match(yield* callTool(task.lead, 'remove_part', { part: 'checked_by', why: 'the person said no review' }), /no review/)
      assert.isTrue((yield* planOf(task.taskId)).steps.every((step) => step.key !== 'review' || step.skipped))
      const said = yield* callTool(task.lead, 'change_part', { part: 'preset', preset: 'Chat', why: 'the person asked' })
      assert.match(said, /made it a Chat: nothing going up until it ships, on Scratch/)
      const plan = yield* planOf(task.taskId)
      assert.deepStrictEqual([plan.end ?? null, plan.here], [null, true])
      // And back to a change, from a chat.
      assert.match(
        yield* callTool(task.lead, 'change_part', { part: 'preset', preset: 'Change', why: 'the person asked' }),
        /made it a Change: reviewed by .+, ending in a draft pull request, on the board/,
      )
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('makes a change a chat while its review runs: the review stops, and nothing of it goes up', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* finished(working, false, true)
      assert.notInclude(git(bare, 'branch', '--list'), 'althar/add-a-retry')
      const said = yield* callTool(task.lead, 'change_part', { part: 'preset', preset: 'Chat', why: 'the person asked' })
      assert.match(said, /made it a Chat: no review, nothing going up until it ships, on Scratch/)
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready')
      assert.strictEqual(yield* reviewOf(task.taskId), 'cancelled')
      // Its run ended as a chat ends, here: no branch pushed, no pull request opened (and closed again) on the way.
      assert.notInclude(git(bare, 'branch', '--list'), 'althar/add-a-retry')
      assert.lengthOf(github.changes, 0)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('makes a change a prototype while its review runs: its branch goes up, and no pull request opens', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* finished(working, false, true)
      const said = yield* callTool(task.lead, 'change_part', { part: 'preset', preset: 'Prototype', why: 'the person asked' })
      assert.match(said, /made it a Prototype: no review, ending with its branch/)
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready')
      assert.strictEqual(yield* reviewOf(task.taskId), 'cancelled')
      assert.include(git(bare, 'branch', '--list'), 'althar/add-a-retry')
      assert.lengthOf(github.changes, 0)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('keeps the ending the person asked for in a preset saved from the task, and follows the project again on its word', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const instance = yield* Instance
      const task = yield* finished(working, false)
      // Taken from the project: a preset saved from it follows the project.
      assert.isUndefined((yield* partsOfTask(task.taskId)).parts.end)
      // Asked for, even the project's own: the person's, which a preset saved from it keeps.
      yield* callTool(task.lead, 'change_part', { part: 'ending', end: 'draft', why: 'the person asked' })
      assert.strictEqual((yield* partsOfTask(task.taskId)).parts.end, 'draft')
      // A preset whose ending is the project's follows the project again, though the ending is the same.
      yield* callTool(task.lead, 'change_part', { part: 'preset', preset: 'Change', why: 'the person asked' })
      assert.isUndefined((yield* partsOfTask(task.taskId)).parts.end)
      // Ready, saved as a preset, and that preset applied after another ending: ready again, and still the person's.
      yield* callTool(task.lead, 'change_part', { part: 'ending', end: 'ready', why: 'the person asked' })
      const saved = yield* partsOfTask(task.taskId)
      assert.strictEqual(saved.parts.end, 'ready')
      yield* savePreset({ name: 'Ready change', parts: saved.parts, projectId: null, fromTaskId: null, actorId: instance.personId })
      yield* callTool(task.lead, 'change_part', { part: 'ending', end: 'branch', why: 'the person asked' })
      assert.strictEqual((yield* planOf(task.taskId)).end, 'none')
      assert.match(
        yield* callTool(task.lead, 'change_part', { part: 'preset', preset: 'Ready change', why: 'the person asked' }),
        /made it a Ready change: .*ending in a pull request ready for review/,
      )
      const plan = yield* planOf(task.taskId)
      assert.deepStrictEqual([plan.end, plan.endChosen], ['ready', true])
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it('offers a review to the fast lane’s work too: one never run before the merge isn’t done', () => {
    const facts = {
      taskId: 't',
      open: true,
      steps: [
        { key: 'implement' as const, agentId: 'claude-code', model: null, skipped: false },
        { key: 'review' as const, agentId: 'codex', model: null, skipped: true },
      ],
      reviewsAfterMerge: true,
      reads: false,
      pulls: [],
    }
    assert.isUndefined(offerable(facts))
    assert.strictEqual(offerable({ ...facts, reads: true }), 'no_review_of_its_own')
  })

  it.live('changes the reviewer of a plan not started yet, rather than asking for a new plan', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const instance = yield* Instance
      yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
      const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      const coordinator = yield* Coordinator
      const threadId = yield* coordinator.thread(project.projectId)
      const body = 'Add a retry. [coordinator:plan-no-review] [coordinator:plan]'
      yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
      const [card] = yield* until(cards(project.projectId), (all) => all[0]?.phase === 'planned')
      const access: ToolAccess = {
        role: 'coordinator',
        projectId: project.projectId as ProjectId,
        threadId,
        sessionId: 'none',
        taskId: null,
      }
      assert.match(
        yield* callTool(access, 'change_lead', { task: card?.taskId ?? '', review: { agent: 'codex' }, why: 'the person asked' }),
        /changed the review to /,
      )
      assert.isTrue((yield* planOf(card?.taskId ?? '')).steps.some((step) => step.key === 'review' && !step.skipped))
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})
