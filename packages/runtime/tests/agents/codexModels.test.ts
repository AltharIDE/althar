import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Models } from '../../src/Models'
import { Projects } from '../../src/Projects'
import * as Runtime from '../../src/Runtime'
import { Sessions } from '../../src/Sessions'
import { usableModels } from '../../src/usableModels'

/*
 * What Codex offers, as installed and signed in on this computer, through Althar's own reading of it: the model named
 * in CODEX_MODEL (GPT-6.2 Sol by default) is among the models Althar can give work to on Codex, and a lead starts on it
 * there. It starts a session and sends nothing, so it costs no usage:
 * `bunx vp test run --config vite.agents.config.ts tests/agents/codexModels.test.ts`.
 */

const wanted = process.env['CODEX_MODEL'] ?? 'gpt-6.2-sol'

const checkout = () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'althar-codex-models-')))
  const repository = join(home, 'meridian')
  mkdirSync(repository)
  const git = (...args: Array<string>) =>
    execFileSync('git', ['-c', 'user.name=Try', '-c', 'user.email=try@althar.test', ...args], { cwd: repository })
  git('init', '-q', '-b', 'main')
  writeFileSync(join(repository, 'README.md'), '# Meridian\n')
  git('add', '.')
  git('commit', '-q', '-m', 'Start')
  const layer = Runtime.layer({
    database: join(home, 'althar.sqlite'),
    worktreeRoot: join(home, 'worktrees'),
    appVersion: '0.0.0-agents',
    deviceName: 'Agents',
  })
  return { layer, repository }
}

describe('Codex’s models, on the real agent', () => {
  it.live(
    `offers ${wanted} on Codex, and a lead starts on it there`,
    () => {
      const { layer, repository } = checkout()
      return Effect.gen(function* () {
        const models = yield* Models
        const sql = yield* SqlClient.SqlClient
        // Asked as Althar asks at launch, in the background.
        const deadline = Date.now() + 120_000
        let codex = (yield* models.catalog).find((agent) => agent.agentId === 'codex')
        while ((codex === undefined || codex.probing) && Date.now() < deadline) {
          yield* Effect.sleep('500 millis')
          codex = (yield* models.catalog).find((agent) => agent.agentId === 'codex')
        }
        const offered = codex?.models.map((model) => model.id) ?? []
        process.stdout.write(`Codex offers: ${offered.join(', ')}\n`)
        assert.include(offered, wanted)
        const routes = (yield* usableModels()).flatMap((model) => model.routes.map((route) => ({ name: model.name, ...route })))
        const onCodex = routes.find((route) => route.agentId === 'codex' && route.model === wanted)
        process.stdout.write(`list_models: ${onCodex?.name ?? 'missing'} on Codex\n`)
        assert.isDefined(onCodex)
        // A task's lead on it, on Codex.
        const projects = yield* Projects
        const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository })
        const created = yield* projects.createTask({
          envelope: yield* Runtime.envelope('task.create', { title: 'Led by Sol' }),
          projectId: project.projectId,
          title: 'Led by Sol',
        })
        const sessions = yield* Sessions
        yield* sessions.start({ threadId: created.threadId, agentId: 'codex', model: wanted })
        const live = yield* sessions.running(created.threadId)
        const [session] = yield* sql<{ agentId: string; model: string | null; state: string }>`
          SELECT agent_id, model, state FROM provider_sessions WHERE thread_id = ${created.threadId}`
        process.stdout.write(`Lead: ${session?.model} on ${session?.agentId}, ${session?.state}\n`)
        assert.isTrue(Option.isSome(live))
        assert.deepStrictEqual(session, { agentId: 'codex', model: wanted, state: 'active' })
        yield* sessions.stop(created.threadId)
      }).pipe(Effect.provide(layer))
    },
    180_000,
  )
})
