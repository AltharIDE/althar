import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Instance } from '../../src/Instance'
import { Policies } from '../../src/Policies'
import { Projects } from '../../src/Projects'
import { Queries } from '../../src/Queries'
import * as Runtime from '../../src/Runtime'
import { Sessions } from '../../src/Sessions'

/*
 * What a person waits for when they pick another model, against the real agents, as installed and signed in on this
 * computer: how long Althar takes to take the pick, on a session with no turn running and in the middle of a turn, the
 * old way (`setModel`, which asks the agent and waits for its answer) and the new (`chooseLead`, which records it and asks
 * the agent after), and how long the window's read of the thread takes after each, which is what shows the pick. It costs
 * one turn of usage on each agent: `bunx vp test run --config vite.agents.config.ts tests/agents/modelChange.test.ts`.
 */

const say = (line: string) => process.stdout.write(`${line}\n`)

const checkout = () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'althar-model-')))
  const repository = join(home, 'meridian')
  const git = (...args: Array<string>) =>
    execFileSync('git', ['-c', 'user.name=Try', '-c', 'user.email=try@althar.test', ...args], { cwd: repository, encoding: 'utf8' })
  if (process.env['TIMING_REPO'] === undefined) {
    // A small repository, unless TIMING_REPO names a real one to take a copy of, as a person's project is.
    mkdirSync(repository)
    git('init', '-q', '-b', 'main')
    writeFileSync(join(repository, 'README.md'), '# Meridian\n')
    git('add', '.')
    git('commit', '-q', '-m', 'Start')
  } else execFileSync('git', ['clone', '-q', process.env['TIMING_REPO'], repository])
  return Runtime.layer({
    database: join(home, 'althar.sqlite'),
    worktreeRoot: join(home, 'worktrees'),
    appVersion: '0.0.0-agents',
    deviceName: 'Agents',
  }).pipe((layer) => ({ layer, repository }))
}

const timed = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const at = performance.now()
    const value = yield* effect
    return { value, ms: Math.round(performance.now() - at) }
  })

const agents = [
  { agentId: 'claude-code', models: ['sonnet', 'opus'] },
  { agentId: 'codex', models: ['gpt-6-astra', 'gpt-6.1-sol'] },
] as const

describe('changing the model of a lead, timed', () => {
  for (const { agentId, models } of agents) {
    it.live(`on ${agentId}`, () => {
      const { layer, repository } = checkout()
      return Effect.gen(function* () {
        const projects = yield* Projects
        const sessions = yield* Sessions
        const queries = yield* Queries
        const policies = yield* Policies
        const instance = yield* Instance
        const sql = yield* SqlClient.SqlClient
        const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository })
        yield* policies.set(project.projectId, { allowEverything: true }, instance.personId)
        const created = yield* projects.createTask({
          envelope: yield* Runtime.envelope('task.create', { title: 'Timing' }),
          projectId: project.projectId,
          title: 'Timing',
        })
        const { threadId } = created
        const [first, second] = models
        const started = yield* timed(sessions.start({ threadId, agentId, model: first }))
        say(`${agentId}: starting a session ${started.ms} ms`)
        const read = () => timed(queries.thread(threadId))
        const modelOf = () =>
          Effect.map(
            sql<{ model: string | null }>`SELECT model FROM provider_sessions WHERE thread_id = ${threadId} AND state = 'active'`,
            (rows) => rows[0]?.model ?? null,
          )
        const untilModel = (model: string) =>
          Effect.gen(function* () {
            const at = performance.now()
            while ((yield* modelOf()) !== model) yield* Effect.sleep('20 millis')
            return Math.round(performance.now() - at)
          })

        // With no turn running.
        const idleOld = yield* timed(sessions.setModel({ threadId, model: second }))
        say(`${agentId}: idle, setModel (before) ${idleOld.ms} ms; the window's read after it ${(yield* read()).ms} ms`)
        const idleNew = yield* timed(sessions.chooseLead({ threadId, model: first }))
        const shown = yield* read()
        say(
          `${agentId}: idle, chooseLead (after) ${idleNew.ms} ms; the window's read after it ${shown.ms} ms, showing nextLead ${shown.value.session?.nextLead?.model ?? 'none'}; on the agent ${yield* untilModel(first)} ms after the pick`,
        )

        // In the middle of a turn.
        // Words that take a while, or (TURN=command) a command that does, which the agent waits on.
        const body =
          process.env['TURN'] === 'command'
            ? 'Run the shell command `sleep 40 && echo done` once, then say what it printed.'
            : process.env['TURN'] === 'churn'
              ? 'Run the shell command `for i in $(seq 1 150); do echo $i > churn-$i.txt; sleep 0.3; done; rm churn-*.txt` once, then say done.'
              : 'Write the numbers from 1 to 250, each on its own line, with a few words about each. Use no tools.'
        yield* sessions.send({
          envelope: yield* Runtime.envelope('thread.send', { body }),
          threadId,
          body,
          disposition: 'after_current',
        })
        for (let waited = 0; waited < 120; waited += 1) {
          const [said] = yield* sql<{ one: number }>`
            SELECT 1 AS one FROM thread_items WHERE thread_id = ${threadId} AND kind IN ('agent_message', 'tool_call') LIMIT 1`
          if (said !== undefined) break
          yield* Effect.sleep('500 millis')
        }
        const turnAt = performance.now()
        const reads: Array<number> = []
        for (let again = 0; again < 3; again += 1) reads.push((yield* read()).ms)
        say(`${agentId}: the window's read of the thread, three times in the turn: ${reads.join(', ')} ms`)
        const midOld = yield* timed(sessions.setModel({ threadId, model: second }))
        const turnLeft = () => Math.round(performance.now() - turnAt)
        const readMid = yield* read()
        say(
          `${agentId}: mid-turn, setModel (before) ${midOld.ms} ms (${turnLeft()} ms after the turn's first words); the window's read after it ${readMid.ms} ms, showing ${readMid.value.session?.model ?? 'none'}`,
        )
        const midNew = yield* timed(sessions.chooseLead({ threadId, model: first }))
        const after = yield* read()
        say(
          `${agentId}: mid-turn, chooseLead (after) ${midNew.ms} ms; the window's read after it ${after.ms} ms, showing nextLead ${after.value.session?.nextLead?.model ?? 'none'}; turn running ${String(after.value.session?.turnRunning)}`,
        )
        say(
          `${agentId}: on the agent ${yield* untilModel(first)} ms after that, the turn ${(yield* read()).value.session?.turnRunning ? 'still' : 'no longer'} running`,
        )
      }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(layer))))
    })
  }
})
