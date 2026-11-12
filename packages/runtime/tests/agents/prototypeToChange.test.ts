import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { makeFakeService } from '@althar/connectors/testing'
import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from '../../src/Connections'
import { Instance } from '../../src/Instance'
import { Plans } from '../../src/Plans'
import { Policies } from '../../src/Policies'
import { Projects } from '../../src/Projects'
import { Queries } from '../../src/Queries'
import { PlanParameters, Runs } from '../../src/Runs'
import * as Runtime from '../../src/Runtime'
import { Secrets } from '../../src/Secrets'
import { Sessions } from '../../src/Sessions'
import { fakeConnectors, HOST, hosted } from '../support'

/*
 * A prototype becoming a change on the person's plain word, with a real lead (a task is a conversation plus parts; the
 * person's note of 12 November): a task planned from Prototype, led by the agent and model that preset names, as installed
 * and signed in on this computer, does its work; the person asks what making it a finished change takes, then answers
 * "Yep pls"; its lead makes it a change in place, asking nothing again; the person's Ship runs the review and opens the
 * pull request, on a fake GitHub. It prints each thread as it goes, and costs a few turns of usage on the lead and on the
 * reviewer the project's rules pick: `bunx vp test run --config vite.agents.config.ts tests/agents/prototypeToChange.test.ts`.
 */

const say = (line: string) => process.stdout.write(`${line}\n`)
const clip = (text: string, length = 300) => (text.length > length ? `${text.slice(0, length)}…` : text).replaceAll('\n', ' ⏎ ')

describe('a prototype made a change on the person’s plain word, on a real lead', () => {
  it.live(
    'is made a change in place on “Yep pls”, and Ship reviews it and opens its pull request',
    () => {
      const home = mkdtempSync(join(tmpdir(), 'althar-graduate-'))
      const { working, bare } = hosted()
      execFileSync('git', ['config', 'user.name', 'Try'], { cwd: working })
      execFileSync('git', ['config', 'user.email', 'try@althar.test'], { cwd: working })
      const github = makeFakeService({ pushUrl: () => bare })
      github.addRepository(['meridian', 'api'])
      const layer = Queries.layer.pipe(
        Layer.provideMerge(
          Runtime.layer({
            database: join(home, 'althar.sqlite'),
            worktreeRoot: join(home, 'worktrees'),
            appVersion: '0.0.0-agents',
            deviceName: 'Agents',
            connectors: fakeConnectors({ github }),
            secrets: Secrets.memory(),
          }),
        ),
      )
      return Effect.gen(function* () {
        const instance = yield* Instance
        const projects = yield* Projects
        const plans = yield* Plans
        const sessions = yield* Sessions
        const queries = yield* Queries
        const runs = yield* Runs
        const sql = yield* SqlClient.SqlClient
        yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
        const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
        yield* (yield* Policies).set(project.projectId, { allowEverything: true }, instance.personId)
        const title = 'Prototype: a greeting in the README'
        const description = 'Add a short "Hello" section to README.md that greets whoever reads it. A prototype: show the idea, quickly.'
        const created = yield* projects.createTask({
          envelope: yield* Runtime.envelope('task.create', { title }),
          projectId: project.projectId,
          title,
          description,
        })
        const planId = yield* plans.propose({
          projectId: project.projectId as ProjectId,
          taskId: created.taskId,
          steps: [{ key: 'implement', agentId: 'claude-code', model: null, skipped: false }],
          reason: null,
          actorId: instance.personId,
          held: true,
        })
        // Planned from Prototype, as the coordinator plans one: its lead, no review, ending with its branch.
        yield* plans.applyPreset(planId, 'Prototype', instance.personId)
        // Its lead's model as the agent names it here: a runtime with no model catalogue knows Opus by the agent's own word.
        yield* plans.change(planId, [{ key: 'implement', agentId: 'claude-code', model: 'opus', skipped: false }], instance.personId)
        yield* plans.start(planId, instance.personId)
        const threadId = created.threadId
        const planOf = Effect.gen(function* () {
          const [row] = yield* sql<{ parameters: string }>`
            SELECT parameters FROM task_plans WHERE task_id = ${created.taskId} ORDER BY proposed_at DESC LIMIT 1`
          return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PlanParameters))(row?.parameters ?? '')
        })
        const card = Effect.map(queries.coordinator(project.projectId), (snapshot) =>
          snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : [])).find((one) => one.taskId === created.taskId),
        )
        say(`Planned: ${JSON.stringify((yield* planOf).steps)}, ending ${(yield* planOf).end}`)

        // Everything new in every thread, printed once it stops growing; the tools the lead called, by name.
        const seen = new Set<string>()
        const called: Array<string> = []
        const print = Effect.gen(function* () {
          const items = yield* sql<{ id: string; thread: string; kind: string; content: string; agentId: string | null }>`
            SELECT i.id, t.kind || coalesce(':' || t.node_key, '') AS thread, i.kind, i.content, s.agent_id
            FROM thread_items i JOIN threads t ON t.id = i.thread_id LEFT JOIN provider_sessions s ON s.id = i.provider_session_id
            ORDER BY i.created_at, i.sequence`
          for (const item of items) {
            const key = `${item.id}:${item.content.length}`
            if (seen.has(item.id) || item.kind === 'agent_thought') continue
            if (item.kind === 'agent_message' && !seen.has(key)) {
              seen.add(key)
              continue
            }
            seen.add(item.id)
            const content = JSON.parse(item.content) as { readonly title?: string; readonly status?: string; readonly text?: string }
            const who = `[${item.thread}${item.agentId === null ? '' : ` ${item.agentId}`}]`
            if (item.kind === 'tool_call') {
              say(`${who} tool: ${clip(content.title ?? '', 200)} (${content.status ?? ''})`)
              if (item.thread === 'task') called.push(content.title ?? '')
            } else if (item.kind === 'agent_message') say(`${who} says: ${clip(content.text ?? JSON.stringify(content), 2000)}`)
            else if (item.kind !== 'task') say(`${who} ${item.kind}: ${clip(JSON.stringify(content), 600)}`)
          }
        })
        /** Until `done`, printing as it goes; what Althar asks the person meanwhile fails it. */
        const until = (what: string, done: Effect.Effect<boolean, unknown>) =>
          Effect.gen(function* () {
            const started = Date.now()
            for (;;) {
              yield* print
              if (yield* done) return
              const waiting = yield* sql<{ kind: string; title: string | null }>`
                SELECT kind, json_extract(payload, '$.title') AS title FROM attention_requests WHERE state = 'open'`
              if (waiting.length > 0) say(`!! waiting on the person: ${JSON.stringify(waiting)}`)
              assert.isFalse(
                waiting.some((one) => one.kind === 'stuck'),
                `${what} is stuck`,
              )
              assert.isBelow(Date.now() - started, 15 * 60_000, `${what} took over 15 minutes`)
              yield* Effect.sleep(Duration.seconds(2))
            }
          })
        const idle = Effect.gen(function* () {
          const pending = yield* sql<{ n: number }>`
            SELECT count(*) AS n FROM turn_deliveries WHERE thread_id = ${threadId} AND state IN ('pending', 'delivered')`
          return (pending[0]?.n ?? 0) === 0 && !(yield* sessions.busy(threadId))
        })
        const tell = (body: string) =>
          Effect.gen(function* () {
            say(`\n> ${body}`)
            const from = called.length
            yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', { threadId, body }), threadId, body })
            yield* Effect.sleep(Duration.seconds(3))
            yield* until(`the answer to “${body}”`, idle)
            return called.slice(from)
          })

        yield* until(
          'the prototype',
          Effect.map(card, (one) => one?.phase === 'ready'),
        )
        assert.lengthOf(github.changes, 0)
        say(
          `\nThe prototype is done: ${(yield* planOf).end}, review ${JSON.stringify((yield* planOf).steps.find((s) => s.key === 'review') ?? null)}`,
        )

        const asked = yield* tell('Nice. What would it take to make this a finished change, reviewed with a pull request?')
        say(`Tools in that turn: ${JSON.stringify(asked)}`)
        const before = yield* planOf
        const madeAlready = before.steps.some((step) => step.key === 'review' && !step.skipped)
        const yes = madeAlready ? [] : yield* tell('Yep pls')
        say(`Tools in that turn: ${JSON.stringify(yes)}`)

        // Made a change in place: its reviewer on and its ending a pull request, with no offer or question to the person.
        const plan = yield* planOf
        say(`Plan now: ${JSON.stringify(plan.steps)}, ending ${plan.end}`)
        assert.isTrue(
          plan.steps.some((step) => step.key === 'review' && !step.skipped),
          'a reviewer is on',
        )
        assert.include(['draft', 'ready'], plan.end)
        assert.isFalse([...asked, ...yes].some((tool) => /offer_review|Offer a review|wait_for_person/i.test(tool)))
        const [question] = yield* sql<{ n: number }>`SELECT count(*) AS n FROM attention_requests WHERE state = 'open'`
        assert.strictEqual(question?.n ?? 0, 0)

        // The person's Ship: the review runs over the whole branch, then the pull request opens.
        say('\n> (the person presses Ship)')
        yield* runs.ship({ envelope: yield* Runtime.envelope('task.ship', { taskId: created.taskId }), taskId: created.taskId })
        yield* until(
          'Ship',
          Effect.sync(() => github.changes.length > 0),
        )
        const reviews = yield* sql<{ n: number }>`
          SELECT count(*) AS n FROM thread_items WHERE thread_id = ${threadId} AND kind = 'step_result'
            AND json_extract(content, '$.step') = 'review'`
        say(`\nOpened: ${JSON.stringify(github.changes.map((one) => ({ source: one.source, draft: one.draft, state: one.state })))}`)
        assert.isAbove(reviews[0]?.n ?? 0, 0, 'its review ran before the pull request opened')
      }).pipe(Effect.scoped, Effect.provide(layer))
    },
    40 * 60_000,
  )
})
