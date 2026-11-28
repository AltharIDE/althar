import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AgentExited, AgentRequestFailed, AgentStartFailed, type InProcessAgent } from '@althar/provider-adapters'
import { fakeAgent } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Cause, Deferred, Duration, Effect, Exit, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Accounts } from '../src/Accounts'
import { type AgentEntry, Agents } from '../src/Config'
import { Models } from '../src/Models'
import { SignIns } from '../src/SignIns'
import { SessionFailed } from '../src/errors'
import { Sessions } from '../src/Sessions'
import { startsAgain } from '../src/startAgain'
import { noReasonWords, signedOutWords } from '../src/words'
import { fakeAgents, items, runtime, task, until } from './support'

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

/** The fake agents, each changed by `change`. */
const changed = (change: (entry: AgentEntry) => AgentEntry) =>
  Layer.effect(
    Agents,
    Effect.gen(function* () {
      const base = yield* Agents
      return Agents.of({ list: base.list.map(change), get: (agentId) => Effect.map(base.get(agentId), change) })
    }),
  ).pipe(Layer.provide(fakeAgents()))

/** The fake agents, each with Althar's check of its own program saying `problem`, and a command that isn't there. */
const withProgram = (problem: string) =>
  changed((entry) => ({
    definition: { ...entry.definition, program: () => problem },
    transport: (cwd) => ({ _tag: 'Process', spec: { command: 'althar-no-such-agent', args: [] }, cwd }),
  }))

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
  ] as const)('says %s, once it has looked again a while, before anything is spawned', ([problem, words]) =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const { task: created } = yield* task()
      const exit = yield* Effect.exit(sessions.start({ threadId: created.threadId, agentId: 'claude-code' }))
      // Not "isn't installed", which spawning the missing command would have said.
      assert.strictEqual(summaryOf(exit), words)
    }).pipe(Effect.provide(runtime(':memory:', {}, { agents: withProgram(problem) }))),
  )
})

describe('a program that is still arriving', () => {
  it.live('is looked for again, and the start goes on once it is there, as when an install finishes', () => {
    let looked = 0
    // Missing for its first three looks, as Claude Code's 364 MB were for minutes on 24 November 2026; there from then on.
    const arriving = changed((entry) => ({
      ...entry,
      definition: {
        ...entry.definition,
        program: () => {
          looked += 1
          return looked <= 3
            ? "Claude Code's own program for this computer (@anthropic-ai/claude-agent-sdk-darwin-arm64 0.3.330) is missing."
            : undefined
        },
      },
    }))
    return Effect.gen(function* () {
      const sessions = yield* Sessions
      const { task: created } = yield* task()
      const exit = yield* Effect.exit(sessions.start({ threadId: created.threadId, agentId: 'claude-code' }))
      assert.isTrue(Exit.isSuccess(exit), Exit.isFailure(exit) ? Cause.pretty(exit.cause) : '')
      assert.isAtLeast(looked, 4)
      const notices = (yield* items(created.threadId)).filter((item) => item.kind === 'notice')
      assert.isFalse(notices.some((item) => item.content.severity === 'error'))
    }).pipe(
      Effect.provide(
        runtime(':memory:', {}, { agents: arriving, programWait: { every: Duration.millis(10), within: Duration.seconds(5) } }),
      ),
    )
  })
})

describe('a program another start is bringing', () => {
  it.live('is looked for as a launch now would be, so the start goes on as soon as it is kept', () => {
    const folder = mkdtempSync(join(tmpdir(), 'althar-agents-'))
    const kept = join(folder, 'claude')
    // Kept a moment after the start first looks, as by another session's download.
    setTimeout(() => writeFileSync(kept, '#!/bin/sh\n', { mode: 0o755 }), 100)
    const arriving = changed((entry) => ({
      ...entry,
      definition: {
        ...entry.definition,
        launch: (node) => {
          const spec = entry.definition.launch(node)
          return existsSync(kept) ? { ...spec, env: { ...spec.env, CLAUDE_CODE_EXECUTABLE: kept } } : spec
        },
        cli: { name: 'claude', drivenBy: 'CLAUDE_CODE_EXECUTABLE' },
        program: (env) =>
          env.CLAUDE_CODE_EXECUTABLE !== undefined ? undefined : "Claude Code's own program for this computer is missing.",
      },
    }))
    return Effect.gen(function* () {
      const sessions = yield* Sessions
      const { task: created } = yield* task()
      const exit = yield* Effect.exit(sessions.start({ threadId: created.threadId, agentId: 'claude-code' }))
      assert.isTrue(Exit.isSuccess(exit), Exit.isFailure(exit) ? Cause.pretty(exit.cause) : '')
    }).pipe(
      // Long: a look again at the launch that failed would wait all of it out, and time the test out.
      Effect.provide(
        runtime(':memory:', {}, { agents: arriving, programWait: { every: Duration.millis(10), within: Duration.minutes(1) } }),
      ),
    )
  })
})

describe('a program that comes on first use', () => {
  // Not on Windows: the program the stand-in package holds is a shell script, which Althar runs (--version) to check it.
  it.live.skipIf(process.platform === 'win32')('is downloaded at the agent’s first start, checked, and the start goes on', () => {
    const root = mkdtempSync(join(tmpdir(), 'althar-agents-'))
    const staged = mkdtempSync(join(tmpdir(), 'althar-npm-'))
    mkdirSync(join(staged, 'package'))
    writeFileSync(join(staged, 'package', 'claude'), '#!/bin/sh\necho 2.1.331\n', { mode: 0o755 })
    execFileSync('tar', ['-czf', join(staged, 'package.tgz'), '-C', staged, 'package'])
    const bytes = readFileSync(join(staged, 'package.tgz'))
    const tarball = 'https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk/-/stand-in.tgz'
    const asked: string[] = []
    const kept = join(root, 'claude-code', '0.3.331', 'claude')
    const firstUse = changed((entry) => ({
      ...entry,
      definition: {
        ...entry.definition,
        // As Config's `usingLocated` points it: its adapter told the copy Althar keeps, once it is there.
        launch: (node) => {
          const spec = entry.definition.launch(node)
          return existsSync(kept) ? { ...spec, env: { ...spec.env, CLAUDE_CODE_EXECUTABLE: kept } } : spec
        },
        cli: {
          name: 'claude',
          drivenBy: 'CLAUDE_CODE_EXECUTABLE',
          download: {
            npm: true as const,
            version: '0.3.331',
            assets: {
              [`${process.platform}-${process.arch}`]: {
                name: '@anthropic-ai/claude-agent-sdk-stand-in',
                version: '0.3.331',
                tarball,
                integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
                program: 'claude',
                prune: [],
              },
            },
          },
        },
        // As Claude Code's own check: missing unless its launch names a copy to drive, as it does once Althar has downloaded it.
        program: (env) =>
          env.CLAUDE_CODE_EXECUTABLE !== undefined ? undefined : "Claude Code's own program for this computer is missing.",
      },
    }))
    return Effect.gen(function* () {
      const sessions = yield* Sessions
      const { task: created } = yield* task()
      const exit = yield* Effect.exit(sessions.start({ threadId: created.threadId, agentId: 'claude-code' }))
      assert.isTrue(Exit.isSuccess(exit), Exit.isFailure(exit) ? Cause.pretty(exit.cause) : '')
      assert.deepStrictEqual(asked, [tarball])
      assert.isTrue(existsSync(kept))
    }).pipe(
      Effect.provide(
        runtime(
          ':memory:',
          {},
          {
            agents: firstUse,
            agentsRoot: root,
            download: async (url) => {
              asked.push(String(url))
              return new Response(new Uint8Array(bytes))
            },
            // Long: once downloaded, the start goes on at once, never waiting this out.
            programWait: { every: Duration.millis(10), within: Duration.minutes(1) },
          },
        ),
      ),
    )
  })
})

describe('whose copy is put right', () => {
  it.live('is the person’s own where the launch drives it, as Codex’s `CODEX_PATH` does: update it, not Althar', () => {
    // The person's own Codex, refusing what codex-acp starts it with, in clap's words, as it stops.
    const theirs = changed((entry) => ({
      definition: { ...entry.definition, cli: { name: 'codex', drivenBy: 'CODEX_PATH' } },
      transport: (cwd) => ({
        _tag: 'Process',
        spec: {
          command: 'sh',
          args: ['-c', `echo "error: unexpected argument '--acp' found" >&2; exit 2`],
          env: { CODEX_PATH: '/opt/homebrew/bin/codex' },
        },
        cwd,
      }),
    }))
    return Effect.gen(function* () {
      const sessions = yield* Sessions
      const { task: created } = yield* task()
      const exit = yield* Effect.exit(sessions.start({ threadId: created.threadId, agentId: 'codex' }))
      assert.strictEqual(
        summaryOf(exit),
        "Its program and what drives it are different versions: error: unexpected argument '--acp' found. Update it, then try again.",
      )
    }).pipe(Effect.provide(runtime(':memory:', {}, { agents: theirs })))
  })
})

describe('what the agent answered', () => {
  it.live('is kept whole in the failed start’s record, beside the words', () =>
    Effect.gen(function* () {
      const { exit } = yield* starting('claude-code', [
        "Claude Code process exited with code 1. stderr: error: unknown option '--initialize-fields=settings'",
      ])
      if (Exit.isSuccess(exit)) throw new Error('The start should have failed.')
      const failure = exit.cause.reasons.find(Cause.isFailReason)
      const reason = failure?.error instanceof SessionFailed ? failure.error.reason : ''
      assert.include(reason, 'It answered: {"code":-32603,"message":"Internal error","data":{"details":')
    }),
  )
})

describe('the models an agent offers, asked of it', () => {
  it.live('are asked again, afresh, where the first start of the asking crashed: the adapter it was on stopped first', () => {
    const seen: Array<string> = []
    let connections = 0
    let refused = false
    // One adapter that takes any number of connections and stays alive after refusing a start, as an in-process one does.
    const app = fakeAgent({
      beforeNewSession: async () => {
        seen.push(`start ${connections}`)
        if (!refused) {
          refused = true
          throw new Error('Claude Code process exited with code 137')
        }
      },
    }).app
    const watched: InProcessAgent = {
      _tag: 'InProcessAgent',
      app: Object.assign(Object.create(app) as typeof app, {
        connect: (streams: Parameters<typeof app.connect>[0]) => {
          const at = ++connections
          const peer = app.connect(streams)
          void peer.closed.then(() => seen.push(`closed ${at}`))
          return peer
        },
      }),
    }
    const agents = changed((entry) =>
      entry.definition.id === 'claude-code' ? { ...entry, transport: () => ({ _tag: 'InProcess', agent: watched }) } : entry,
    )
    return Effect.gen(function* () {
      const models = yield* Models
      const signIns = yield* SignIns
      const known = yield* until(models.catalog, (all) => all.every((agent) => !agent.probing))
      assert.deepStrictEqual(
        known.find((agent) => agent.agentId === 'claude-code')?.models.map((model) => model.id),
        ['small', 'large'],
      )
      // The first connection closed before the second start began, and the second closed once the asking was done.
      assert.deepStrictEqual(seen, ['start 1', 'closed 1', 'start 2', 'closed 2'])
      // Its sign-in, checked as the asking began, was forgotten before it started again, and nothing read it since.
      const [account] = yield* (yield* Accounts).of('claude-code')
      if (account === undefined) throw new Error('Claude Code has no account.')
      assert.isUndefined(yield* signIns.cached(account))
    }).pipe(Effect.provide(runtime(':memory:', {}, { agents })))
  })
})

describe('what Althar holds of an agent, when its start is made again', () => {
  it.live('is read again: its sign-in as checked and its models, and an asking under way from before counts for nothing', () => {
    let offered: ReadonlyArray<{ readonly id: string; readonly name: string }> = [{ id: 'old', name: 'Old' }]
    let hold = false
    let crash = false
    const entered = Deferred.makeUnsafe<void>()
    const release = Deferred.makeUnsafe<void>()
    const options = {
      // Read as each of its processes starts, so an asking started before holds what was offered then.
      get models() {
        return offered
      },
      beforeNewSession: async () => {
        if (hold) {
          hold = false
          Deferred.doneUnsafe(entered, Exit.void)
          await Effect.runPromise(Deferred.await(release))
          return
        }
        if (crash) {
          crash = false
          throw new Error('Claude Code process exited with code 137')
        }
      },
    }
    return Effect.gen(function* () {
      const models = yield* Models
      const signIns = yield* SignIns
      const sessions = yield* Sessions
      const claude = (all: ReadonlyArray<{ readonly agentId: string; readonly models: ReadonlyArray<{ readonly id: string }> }>) =>
        all.find((agent) => agent.agentId === 'claude-code')?.models.map((model) => model.id) ?? []
      // Both known: the models it offers, and its sign-in.
      assert.deepStrictEqual(claude(yield* until(models.catalog, (all) => all.every((agent) => !agent.probing))), ['old'])
      const [account] = yield* (yield* Accounts).of('claude-code')
      if (account === undefined) throw new Error('Claude Code has no account.')
      yield* signIns.account(account)
      const checked = yield* signIns.cached(account)
      assert.isDefined(checked)
      // An asking from before, held under way across the start that recovers.
      yield* models.forget('claude-code')
      hold = true
      yield* models.catalog
      yield* Deferred.await(entered)
      offered = [{ id: 'new', name: 'New' }]
      crash = true
      const { task: created } = yield* task()
      yield* sessions.start({ threadId: created.threadId, agentId: 'claude-code' })
      // Its sign-in as checked before is gone, to be read again.
      assert.notStrictEqual(yield* signIns.cached(account), checked)
      // The asking from before ends, and what it found counts for nothing: what it offers is asked again.
      yield* Deferred.succeed(release, undefined)
      const after = claude(yield* until(models.catalog, (all) => all.every((agent) => !agent.probing) && claude(all).length > 0))
      assert.include(after, 'new')
      assert.notInclude(after, 'old')
    }).pipe(Effect.provide(runtime(':memory:', {}, { each: { 'claude-code': options } })))
  })

  it.live('keep their names while they are asked again, until the agent answers anew', () => {
    let offered: ReadonlyArray<{ readonly id: string; readonly name: string }> = [{ id: 'large', name: 'Large' }]
    let hold = false
    const entered = Deferred.makeUnsafe<void>()
    const release = Deferred.makeUnsafe<void>()
    const options = {
      get models() {
        return offered
      },
      beforeNewSession: async () => {
        if (!hold) return
        hold = false
        Deferred.doneUnsafe(entered, Exit.void)
        await Effect.runPromise(Deferred.await(release))
      },
    }
    return Effect.gen(function* () {
      const models = yield* Models
      const claude = (
        all: ReadonlyArray<{ readonly agentId: string; readonly models: ReadonlyArray<{ readonly id: string; readonly name: string }> }>,
      ) => all.find((agent) => agent.agentId === 'claude-code')?.models.map((model) => `${model.id}: ${model.name}`) ?? []
      assert.deepStrictEqual(claude(yield* until(models.catalog, (all) => all.every((agent) => !agent.probing))), ['large: Large'])
      offered = [{ id: 'larger', name: 'Larger' }]
      hold = true
      yield* models.refresh('claude-code')
      // Asked again, and while it is, what it said last.
      const asking = (yield* models.catalog).find((agent) => agent.agentId === 'claude-code')
      assert.isTrue(asking?.probing)
      yield* Deferred.await(entered)
      assert.deepStrictEqual(claude(yield* models.catalog), ['large: Large'])
      yield* Deferred.succeed(release, undefined)
      assert.deepStrictEqual(
        claude(yield* until(models.catalog, (all) => all.every((agent) => !agent.probing) && claude(all).includes('larger: Larger'))),
        ['larger: Larger'],
      )
    }).pipe(Effect.provide(runtime(':memory:', {}, { each: { 'claude-code': options } })))
  })
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
