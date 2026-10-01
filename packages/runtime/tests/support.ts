import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AgentDefinition, AgentId } from '@charrette/provider-adapters'
import { codexLikeMeanings, fakeAgent, type FakeAgentOptions, fakeAgentMain } from '@charrette/provider-adapters/testing'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Agents, type AgentEntry } from '../src/Config'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'

/** A git repository with one commit on `main`. */
export const repository = () => {
  const path = mkdtempSync(join(tmpdir(), 'charrette-repo-'))
  const run = (...args: Array<string>) =>
    execFileSync('git', args, {
      cwd: path,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@charrette.test',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@charrette.test',
      },
    })
  run('init', '-q', '-b', 'main')
  writeFileSync(join(path, 'README.md'), '# Meridian\n')
  run('add', '.')
  run('commit', '-q', '-m', 'Start')
  return path
}

const definition = (id: string, signedOut: ReadonlyArray<string> = []): AgentDefinition => ({
  id: id as AgentId,
  name: `Fake ${id}`,
  source: 'bundled',
  launch: () => ({ command: 'bun', args: [fakeAgentMain] }),
  modes: { ask: 'ask', readOnly: 'read-only', reader: 'read-only' },
  options: { mode: 'mode', model: 'model' },
  signIn: { status: () => ({ command: 'true', args: [] }), read: () => !signedOut.includes(id), login: 'true' },
  permissions: codexLikeMeanings,
  // One fake agent passes session options, as Claude Code's entry does.
  ...(id === 'claude-code' ? { sessionMeta: () => ({ fake: { asks: true } }) } : {}),
  knownGaps: [],
})

/**
 * Agents for tests: the fake agent, in this process, under any id. The id
 * `process` runs it as a real process with Bun; `missing` names a command
 * that doesn't exist.
 */
export const fakeAgents = (options: FakeAgentOptions = {}, signedOut: ReadonlyArray<string> = []) => {
  const entry = (agentId: string): AgentEntry => ({
    definition: definition(agentId, signedOut),
    transport: (cwd) =>
      agentId === 'process'
        ? { _tag: 'Process', spec: { command: 'bun', args: [fakeAgentMain] }, cwd }
        : agentId === 'missing'
          ? { _tag: 'Process', spec: { command: 'charrette-no-such-agent', args: [] }, cwd }
          : { _tag: 'InProcess', agent: fakeAgent(options) },
  })
  return Layer.succeed(
    Agents,
    Agents.of({ list: ['claude-code', 'codex', 'opencode'].map(entry), get: (agentId) => Effect.succeed(entry(agentId)) }),
  )
}

/** The runtime over a database, with worktrees in a temporary folder and fake agents, and a plan's countdown of a moment. */
export const runtime = (
  database = ':memory:',
  options: FakeAgentOptions = {},
  more: { readonly signedOut?: ReadonlyArray<string>; readonly countdown?: Duration.Duration } = {},
) =>
  Runtime.layer({
    database,
    worktreeRoot: mkdtempSync(join(tmpdir(), 'charrette-worktrees-')),
    appVersion: '0.0.0-test',
    deviceName: 'Test Mac',
    agents: fakeAgents(options, more.signedOut),
    countdown: more.countdown ?? Duration.millis(300),
  })

/** Opens a new repository as a project and creates a task in it. */
export const task = (title = 'Retry checkout') =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
    const created = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', { title }),
      projectId: project.projectId,
      title,
    })
    return { project, task: created }
  })

/** Waits until a query returns a row matching the check, reading the store every few milliseconds. */
export const until = <A, R = SqlClient.SqlClient>(
  query: Effect.Effect<ReadonlyArray<A>, unknown, R>,
  check: (rows: ReadonlyArray<A>) => boolean,
  limit = Duration.seconds(10),
) =>
  Effect.gen(function* () {
    const deadline = Date.now() + Duration.toMillis(limit)
    for (;;) {
      const rows = yield* Effect.orDie(query)
      if (check(rows)) return rows
      if (Date.now() > deadline) return yield* Effect.die(new Error(`Timed out waiting; last saw ${JSON.stringify(rows)}`))
      yield* Effect.sleep('20 millis')
    }
  })

/** The thread's items, oldest first, with their content parsed. */
export const items = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{
      kind: string
      content: string
      toolCallId: string | null
    }>`SELECT kind, content, tool_call_id FROM thread_items WHERE thread_id = ${threadId} ORDER BY sequence`
    return rows.map((row) => ({ kind: row.kind, content: JSON.parse(row.content) as Record<string, unknown>, toolCallId: row.toolCallId }))
  })

/** The thread's turns, oldest first. */
export const turns = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{
      id: string
      state: string
      stopReason: string | null
      errorClass: string | null
      usage: string | null
      providerSessionId: string
      prompt: string | null
      inputs: number
    }>`
      SELECT t.id, t.state, t.stop_reason, t.error_class, t.usage, t.provider_session_id, t.prompt,
        (SELECT count(*) FROM turn_delivery_inputs i WHERE i.delivery_id = t.id) AS inputs
      FROM turn_deliveries t WHERE t.thread_id = ${threadId} ORDER BY t.requested_at, t.id`
  })

/** The notices on a thread, as their titles and descriptions, oldest first. */
export const notices = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{
      content: string
    }>`SELECT content FROM thread_items WHERE thread_id = ${threadId} AND kind = 'notice' ORDER BY sequence`
    return rows.map((row) => JSON.parse(row.content) as Readonly<Record<string, string>>)
  })
