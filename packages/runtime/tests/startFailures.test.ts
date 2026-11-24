import { AgentExited, AgentRequestFailed, AgentStartFailed } from '@althar/provider-adapters'
import { assert, describe, it } from '@effect/vitest'
import { Cause, Effect, Exit, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { type AgentEntry, Agents } from '../src/Config'
import { SessionFailed } from '../src/errors'
import { Sessions } from '../src/Sessions'
import { startsAgain } from '../src/sessionConnections'
import { noReasonWords, signedOutWords } from '../src/words'
import { fakeAgents, items, runtime, task } from './support'

/*
 * An agent whose start fails says why in plain words, and one whose start
 * may pass starts again by itself, afresh, before anyone is asked. Each agent
 * is the fake one under its id, failing its session/new as the agents do:
 * what it throws reaches Althar as the ACP SDK answers any throw, "Internal
 * error" with the words in `data.details`, as claude-agent-acp's did on 24
 * November 2026.
 */

/** A start of `agentId`, whose session/new throws each of `throws` in turn and then starts: how many times it was asked, and how it went. */
const starting = (agentId: string, throws: ReadonlyArray<string>) => {
  let asked = 0
  const app = runtime(
    ':memory:',
    {},
    {
      each: {
        [agentId]: {
          beforeNewSession: async () => {
            asked += 1
            const next = throws[asked - 1]
            if (next !== undefined) throw new Error(next)
          },
        },
      },
    },
  )
  return Effect.gen(function* () {
    const sessions = yield* Sessions
    const { task: created } = yield* task()
    const exit = yield* Effect.exit(sessions.start({ threadId: created.threadId, agentId }))
    const notices = (yield* items(created.threadId)).filter((item) => item.kind === 'notice')
    const sql = yield* SqlClient.SqlClient
    const states = (yield* sql<{ state: string }>`SELECT state FROM provider_sessions`).map((row) => row.state)
    return { exit, asked: () => asked, notices, states }
  }).pipe(Effect.provide(app))
}

const summaryOf = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) throw new Error('The start should have failed.')
  const failure = exit.cause.reasons.find(Cause.isFailReason)
  if (failure === undefined || !(failure.error instanceof SessionFailed)) throw new Error(`Not a failed start: ${Cause.pretty(exit.cause)}`)
  return failure.error.summary
}

describe('an agent whose start fails', () => {
  it.live('starts again by itself, afresh, where its first start crashed, and nobody hears of it', () =>
    Effect.gen(function* () {
      const { exit, asked, notices, states } = yield* starting('claude-code', ['Claude Code process exited with code 137'])
      assert.isTrue(Exit.isSuccess(exit))
      assert.strictEqual(asked(), 2)
      assert.deepStrictEqual(states, ['active'])
      assert.isFalse(notices.some((item) => item.content.severity === 'error'))
    }),
  )

  it.live('starts again where it gave no reason at all, and says so in words if it fails again', () =>
    Effect.gen(function* () {
      const { exit, asked, notices } = yield* starting('opencode', ['', ''])
      assert.strictEqual(asked(), 2)
      assert.strictEqual(summaryOf(exit), noReasonWords)
      assert.strictEqual(notices.at(-1)?.content.title, "Fake opencode couldn't start.")
      assert.strictEqual(notices.at(-1)?.content.description, noReasonWords)
    }),
  )

  it.live('says what stopped it where it crashes twice', () =>
    Effect.gen(function* () {
      const { exit, asked } = yield* starting('codex', [
        'codex app-server terminated by signal SIGSEGV',
        'codex app-server terminated by signal SIGSEGV',
      ])
      assert.strictEqual(asked(), 2)
      assert.strictEqual(summaryOf(exit), 'It stopped while starting: codex app-server terminated by signal SIGSEGV.')
    }),
  )

  // What each agent says, at another version than what drives it: never started again, as a second start meets the same.
  it.live.each([
    [
      'claude-code',
      "Claude Code process exited with code 1. stderr: error: unknown option '--initialize-fields=settings'",
      "Its program and what drives it are different versions: Claude Code process exited with code 1. stderr: error: unknown option '--initialize-fields=settings'. Reinstall Althar (in a checkout of Althar, run bun install), then try again.",
    ],
    [
      'codex',
      "error: unexpected argument '--althar-unknown-flag' found",
      "Its program and what drives it are different versions: error: unexpected argument '--althar-unknown-flag' found. Reinstall Althar (in a checkout of Althar, run bun install), then try again.",
    ],
    [
      'opencode',
      'Unrecognized flag: --althar-unknown-flag in command opencode',
      'Its program and what drives it are different versions: Unrecognized flag: --althar-unknown-flag in command opencode. Reinstall Althar (in a checkout of Althar, run bun install), then try again.',
    ],
  ] as const)('%s says a version mismatch, and what to do', ([agentId, thrown, words]) =>
    Effect.gen(function* () {
      const { exit, asked, notices } = yield* starting(agentId, [thrown])
      assert.strictEqual(asked(), 1)
      assert.strictEqual(summaryOf(exit), words)
      assert.notInclude(String(notices.at(-1)?.content.description), 'Internal error')
    }),
  )

  it.live('says it is signed out, and isn’t started again', () =>
    Effect.gen(function* () {
      const { exit, asked } = yield* starting('claude-code', ['Not logged in · Please run /login'])
      assert.strictEqual(asked(), 1)
      assert.strictEqual(summaryOf(exit), signedOutWords)
    }),
  )
})

/** The fake agents, each with Althar's check of its own program saying `problem`, and a command that isn't there. */
const withProgram = (problem: string) =>
  Layer.effect(
    Agents,
    Effect.gen(function* () {
      const base = yield* Agents
      const checked = (entry: AgentEntry): AgentEntry => ({
        definition: { ...entry.definition, program: () => problem },
        transport: (cwd) => ({ _tag: 'Process', spec: { command: 'althar-no-such-agent', args: [] }, cwd }),
      })
      return Agents.of({ list: base.list.map(checked), get: (agentId) => Effect.map(base.get(agentId), checked) })
    }),
  ).pipe(Layer.provide(fakeAgents()))

describe('the program Althar brings for an agent, checked before it starts', () => {
  it.live.each([
    [
      "Claude Code's own program is version 0.3.326, and its adapter needs 0.3.330.",
      "Its program and what drives it are different versions: Claude Code's own program is version 0.3.326, and its adapter needs 0.3.330. Reinstall Althar (in a checkout of Althar, run bun install), then try again.",
    ],
    [
      "Claude Code's own program for this computer (@anthropic-ai/claude-agent-sdk-darwin-arm64 0.3.330) is missing.",
      "A part of it is missing: Claude Code's own program for this computer (@anthropic-ai/claude-agent-sdk-darwin-arm64 0.3.330) is missing. Reinstall Althar (in a checkout of Althar, run bun install), then try again.",
    ],
  ] as const)('says %s before anything is spawned', ([problem, words]) =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const { task: created } = yield* task()
      const exit = yield* Effect.exit(sessions.start({ threadId: created.threadId, agentId: 'claude-code' }))
      // Not "isn't installed", which spawning the missing command would have said.
      assert.strictEqual(summaryOf(exit), words)
    }).pipe(Effect.provide(runtime(':memory:', {}, { agents: withProgram(problem) }))),
  )
})

describe('which failed starts are made again', () => {
  const failed = (error: unknown) => startsAgain(Cause.fail(error))
  const request = (failure: AgentRequestFailed['failure'], message: string) =>
    new AgentRequestFailed({ method: 'session/new', failure, message })

  it('makes again a start that crashed, or failed for no reason the person can act on', () => {
    assert.isTrue(failed(request('unknown', 'Claude Code process exited with code 137')))
    assert.isTrue(failed(request('unknown', 'Internal error')))
    assert.isTrue(failed(request('transient', '529 overloaded')))
    assert.isTrue(failed(new AgentExited({ code: 1, signal: null, stderr: "thread 'main' panicked at src/main.rs:12:5" })))
    assert.isTrue(failed(new AgentStartFailed({ command: 'grok', reason: 'spawn EAGAIN' })))
  })

  it('never makes again one the person has to put right, or one that would fail the same', () => {
    assert.isFalse(failed(request('auth_required', 'Authentication required')))
    assert.isFalse(failed(request('usage_limit', "You've hit your usage limit")))
    assert.isFalse(failed(request('invalid_request', 'Invalid params')))
    assert.isFalse(failed(request('unknown', "error: unknown option '--acp'")))
    assert.isFalse(failed(request('transient', 'getaddrinfo ENOTFOUND api.anthropic.com')))
    assert.isFalse(failed(new AgentExited({ code: 1, signal: null, stderr: 'Not logged in · Please run /login' })))
    assert.isFalse(failed(new AgentStartFailed({ command: 'kimi', reason: 'spawn kimi ENOENT' })))
    assert.isFalse(failed(new SessionFailed({ agentId: 'codex', reason: 'x', summary: 'x' })))
    assert.isFalse(startsAgain(Cause.die('boom')))
  })
})
