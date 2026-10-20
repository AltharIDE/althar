import { execFileSync } from 'node:child_process'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { fakeConnectors, HOST, hosted, runtime, until } from './support'

/*
 * A task's graph, read with its thread: its plan's run with each step in the
 * order it ran (its work, a review that found something, the settling, the
 * review again, its pull request), who worked on each, and a follow-up after
 * it with the person's words that started it. A step changing reaches its
 * task's thread, so a window showing the graph reads it again.
 */

const runtimeWith = (github: FakeService) =>
  Queries.layer.pipe(
    Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }), listenEvery: Duration.millis(100) })),
  )

const git = (cwd: string, ...args: Array<string>) => execFileSync('git', args, { cwd }).toString().trim()

const cards = (projectId: string) =>
  Effect.gen(function* () {
    const snapshot = yield* Effect.orDie((yield* Queries).coordinator(projectId))
    return snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : []))
  })

const graphOf = (threadId: string) =>
  Effect.gen(function* () {
    const snapshot = yield* Effect.orDie((yield* Queries).thread(threadId))
    return snapshot.task.graph ?? []
  })

const shape = (
  rounds: ReadonlyArray<{ readonly steps: ReadonlyArray<{ readonly key: string; readonly iteration: number; readonly state: string }> }>,
) => rounds.map((round) => round.steps.map((step) => `${step.key}${step.iteration}:${step.state}`))

describe('a task’s graph', () => {
  it.live(
    'reads each round of work with its steps as they ran, who ran them, and what started a follow-up',
    () => {
      // Its pull request opens on the fake GitHub, where what is pushed goes to the bare repository, as the lead commits as the person.
      const { working, bare } = hosted()
      const github = makeFakeService({ pushUrl: () => bare })
      github.addRepository(['meridian', 'api'])
      git(working, 'config', 'user.name', 'Fake')
      git(working, 'config', 'user.email', 'fake@althar.test')
      return Effect.gen(function* () {
        const instance = yield* Instance
        yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
        const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
        const coordinator = yield* Coordinator
        const threadId = yield* coordinator.thread(project.projectId)
        const body = 'Add a retry. [coordinator:plan] [lead:finish] [lead:edit] [review:findings]'
        yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
        const [ready] = yield* until(
          cards(project.projectId),
          (all) => all[0]?.phase === 'ready' && all[0].change !== null,
          Duration.seconds(30),
        )
        const card = ready ?? assert.fail('no card')

        const [planned] = yield* graphOf(card.threadId)
        const round = planned ?? assert.fail('no round')
        assert.isFalse(round.followUp)
        assert.isNull(round.said)
        assert.isNotNull(round.endedAt)
        assert.deepStrictEqual(shape([round]), [['implement0:done', 'review0:done', 'settle0:done', 'review1:done', 'publish0:done']])
        // The lead's steps are its agent's, the reviews the reviewer's, and the pull request Althar's own.
        const who = new Map(round.steps.map((step) => [`${step.key}${step.iteration}`, step.agentId]))
        assert.strictEqual(who.get('implement0'), who.get('settle0'))
        assert.isNotNull(who.get('review0'))
        assert.isNull(who.get('publish0'))
        for (const step of round.steps) {
          assert.isNotNull(step.startedAt, step.key)
          assert.isNotNull(step.endedAt, step.key)
          assert.isFalse(step.added, step.key)
        }

        // Its thread carries every step's report beside its page, the reviews' and Althar's own too, for the graph to read.
        const { reports } = yield* Effect.orDie((yield* Queries).thread(card.threadId, { limit: 0 }))
        assert.deepStrictEqual(
          reports.flatMap((item) => (item.kind === 'step_result' ? [`${item.content.step}${item.content.round}`] : [])),
          ['implement0', 'review0', 'settle0', 'review1', 'publish0'],
        )
        // Every try at its steps reached its thread as it changed.
        const sql = yield* SqlClient.SqlClient
        const tries = yield* sql<{ id: string }>`
          SELECT a.id FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id
          JOIN runs r ON r.id = e.run_id WHERE r.task_id = ${card.taskId}`
        const changes = yield* (yield* Queries).changesSince(0, 10_000)
        for (const one of tries)
          assert.isTrue(
            changes.some(
              (change) => change.aggregateType === 'node_attempt' && change.aggregateId === one.id && change.threadId === card.threadId,
            ),
            one.id,
          )
        assert.isTrue(changes.some((change) => change.aggregateType === 'run' && change.threadId === card.threadId))

        // The lead is switched to another model: what it did before stays on the model it ran on, and the follow-up runs on the new one.
        const ran = new Map(round.steps.map((step) => [`${step.key}${step.iteration}`, step.model]))
        const was = ran.get('implement0') ?? assert.fail('no model for its work')
        const other = was === 'large' ? 'small' : 'large'
        yield* (yield* Sessions).setModel({ threadId: card.threadId, model: other })
        const [switched] = yield* graphOf(card.threadId)
        assert.deepStrictEqual(new Map(switched?.steps.map((step) => [`${step.key}${step.iteration}`, step.model])), ran)

        // The person writes to its lead: a follow-up, started by what they said, reviewed as its plan was.
        const followUp = 'Also log each retry. [lead:finish] [lead:edit] [review:pass]'
        yield* (yield* Sessions).send({
          envelope: yield* Runtime.envelope('thread.send', { threadId: card.threadId, body: followUp }),
          threadId: card.threadId,
          body: followUp,
        })
        const rounds = yield* until(graphOf(card.threadId), (all) => all.length === 2 && all[1]?.endedAt !== null, Duration.seconds(30))
        const after = rounds[1] ?? assert.fail('no follow-up')
        assert.isTrue(after.followUp)
        assert.deepStrictEqual([after.said?.text, after.said?.relayed], [followUp, false])
        assert.strictEqual(after.steps[0]?.key, 'implement')
        assert.strictEqual(after.steps[0]?.model, other)
        assert.strictEqual(rounds[0]?.steps[0]?.model, was)
        assert.isTrue(after.steps.every((step) => step.state === 'done'))
      }).pipe(Effect.provide(runtimeWith(github)))
    },
    60_000,
  )
})
