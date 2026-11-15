import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'
import { vi } from 'vitest'

import { Accounts } from '../src/Accounts'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Policies } from '../src/Policies'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { knownModels } from './knownModels'
import { repository, runtime, until } from './support'

const fault = vi.hoisted(() => ({ armed: false, injected: 0, command: [] as ReadonlyArray<string> }))
vi.mock('../src/spawner', async (original) => {
  const real = await original<typeof import('../src/spawner')>()
  return {
    ...real,
    startApart: (command: import('../src/spawner').Command, cap?: number) => {
      if (!fault.armed || command.command !== 'git' || !command.args.includes('fetch')) return real.startApart(command, cap)
      fault.armed = false
      fault.injected += 1
      fault.command = command.args
      return {
        result: Promise.resolve({
          code: 128,
          signal: null,
          error: null,
          stdout: '',
          over: false,
          stderr: 'fatal: Could not read from remote repository.\n',
        }),
        stop: () => undefined,
      }
    },
  }
})

for (const rotate of [false, true])
  it.live(
    `carries the coordinator to ${rotate ? 'its next account' : 'the next agent'} while its copies refresh with a failed fetch`,
    () => {
      fault.armed = false
      fault.injected = 0
      const home = mkdtempSync(join(tmpdir(), 'althar-takeover-config-'))
      const work = join(home, 'work')
      mkdirSync(work)
      return Effect.gen(function* () {
        const accounts = yield* Accounts
        const account = rotate ? yield* accounts.add({ agentId: 'claude-code', name: 'work', folder: work }) : undefined
        yield* knownModels
        const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
        if (rotate) yield* (yield* Policies).setAccounts(project.projectId, { rotate: true }, (yield* Instance).personId)
        const coordinator = yield* Coordinator
        const threadId = yield* coordinator.thread(project.projectId)
        yield* coordinator.say({
          envelope: yield* Runtime.envelope('thread.send', {}),
          threadId,
          body: 'Is the checkout slow?',
          disposition: 'after_current',
        })
        const sql = yield* SqlClient.SqlClient
        const seen = yield* until(
          Effect.gen(function* () {
            return {
              replies: yield* sql<{ agentId: string; accountId: string; content: string }>`
              SELECT s.agent_id, s.account_id, i.content FROM thread_items i JOIN provider_sessions s ON s.id = i.provider_session_id
              WHERE i.thread_id = ${threadId} AND i.kind = 'agent_message' ORDER BY i.sequence`,
              sessions: yield* sql`SELECT agent_id, state FROM provider_sessions WHERE thread_id = ${threadId}`,
              turns: yield* sql`SELECT state, error_class FROM turn_deliveries WHERE thread_id = ${threadId}`,
              inputs: yield* sql`SELECT state, input_origin FROM user_inputs WHERE thread_id = ${threadId}`,
              notices: yield* sql`SELECT content FROM thread_items WHERE thread_id = ${threadId} AND kind = 'notice'`,
              injected: fault.injected,
              command: fault.command,
            }
          }),
          (one) => one.replies.length > 0,
        )
        const [reply] = seen.replies
        assert.strictEqual(reply?.agentId, rotate ? 'claude-code' : 'codex')
        if (account !== undefined) assert.strictEqual(reply?.accountId, account.id)
        assert.include(reply?.content ?? '', 'Is the checkout slow?')
        assert.strictEqual(fault.injected, 1)
      }).pipe(
        Effect.provide(
          Queries.layer.pipe(
            Layer.provideMerge(
              runtime(
                ':memory:',
                {},
                {
                  each: {
                    'claude-code@usual': {
                      outOfUsage: {
                        until: Date.now() + 3_600_000,
                        beforeLimit: async () => {
                          fault.armed = true
                        },
                      },
                    },
                  },
                },
              ),
            ),
          ),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            fault.armed = false
          }),
        ),
      )
    },
  )
