import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { scenarios } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { setToolRoles } from '../src/agentTools'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { homeWith } from './agentHome'
import { items, runtime, task, turns, until } from './support'

/*
 * The person's own MCP servers, given to a lead's session beside Althar's
 * own (ADR-097), whichever of their agents' settings they were found in, and
 * not where the person took the role off them. The fake agent says how many
 * servers its session was given.
 */

/** A home of the test's own, each time it runs, with one server in Codex's settings. */
const agentConfigs = () => ({
  homeDir: homeWith({ codex: { mcp_servers: { context7: { command: 'npx', args: ['-y', '@upstash/context7-mcp'] } } } }),
  folder: mkdtempSync(join(tmpdir(), 'althar-agent-sync-')),
  env: {},
})

const servers = (role: 'given' | 'taken off') =>
  Effect.gen(function* () {
    if (role === 'taken off') yield* setToolRoles('server', 'context7', ['reviewer', 'coordinator'], null)
    const sessions = yield* Sessions
    const { task: created } = yield* task()
    yield* sessions.start({ threadId: created.threadId, agentId: 'claude-code' })
    yield* until(turns(created.threadId), (rows) => rows.length >= 1 && rows.every((row) => row.state !== 'running'))
    yield* sessions.send({
      envelope: yield* Runtime.envelope('thread.send', { threadId: created.threadId, body: scenarios.settings }),
      threadId: created.threadId,
      body: scenarios.settings,
      disposition: 'after_current',
    })
    const said = yield* until(items(created.threadId), (rows) => rows.some((row) => String(row.content['text'] ?? '').includes('mcp=')))
    return /mcp=(\d+)/.exec(said.map((row) => String(row.content['text'] ?? '')).join(' '))?.[1]
  })

describe('the person’s MCP servers in a lead’s session', () => {
  it.live('are given beside Althar’s own', () =>
    Effect.gen(function* () {
      assert.strictEqual(yield* servers('given'), '2')
    }).pipe(Effect.provide(runtime(':memory:', {}, { agentConfigs: agentConfigs() }))),
  )

  it.live('are not given where the person took leads off one', () =>
    Effect.gen(function* () {
      assert.strictEqual(yield* servers('taken off'), '1')
    }).pipe(Effect.provide(runtime(':memory:', {}, { agentConfigs: agentConfigs() }))),
  )
})
