import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { Agents, cliToken, Connectors } from '../src/Config'

/*
 * What the runtime is configured with, read where its tests take it least:
 * gh's and glab's sign-ins as each hands them out, the products it connects
 * to with its app's slug, and each agent's error output, by the agent.
 */

/** Runs `effect` with `tool` on the PATH first, printing what it is given. */
const withTool = <A, E>(tool: string, prints: string, effect: Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const bin = mkdtempSync(join(tmpdir(), 'althar-bin-'))
    writeFileSync(join(bin, tool), `#!/bin/sh\nprintf '%s\\n' '${prints}'\n`, { mode: 0o755 })
    const path = process.env.PATH ?? ''
    process.env.PATH = `${bin}${delimiter}${path}`
    return yield* effect.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          process.env.PATH = path
        }),
      ),
    )
  })

describe('a command-line tool’s sign-in', () => {
  it.live('is the token gh or glab hands out, read as it is', () =>
    Effect.gen(function* () {
      assert.strictEqual(yield* withTool('gh', 'gho_0123456789abcdefghij', cliToken('gh', 'github.com')), 'gho_0123456789abcdefghij')
      assert.strictEqual(
        yield* withTool('glab', 'glpat-0123456789abcdefghij', cliToken('glab', 'gitlab.com')),
        'glpat-0123456789abcdefghij',
      )
    }),
  )

  it.live('is none where what the tool prints isn’t a token', () =>
    Effect.gen(function* () {
      assert.isNull(yield* withTool('gh', 'You are not logged in', cliToken('gh', 'github.com')))
      assert.isNull(yield* withTool('gh', 'short', cliToken('gh', 'github.com')))
    }),
  )
})

describe('the products the runtime connects to', () => {
  it.effect('carry the slug of Althar’s app where it has one', () =>
    Effect.gen(function* () {
      const connectors = yield* Connectors
      assert.strictEqual(connectors.appSlug, 'althar-app')
      assert.isAbove(connectors.products.length, 0)
    }).pipe(Effect.provide(Connectors.live({}, () => Promise.reject(new Error('No network in tests')), 'althar-app'))),
  )

  it.effect('carry no slug where none is given', () =>
    Effect.gen(function* () {
      assert.isUndefined((yield* Connectors).appSlug)
    }).pipe(Effect.provide(Connectors.live())),
  )
})

describe('the registry’s agents', () => {
  it('say what each process writes to its error output, by its agent', () => {
    const said: Array<[string, string, number]> = []
    const registry = Agents.fromRegistry(undefined, (agentId, chunk, pid) => void said.push([agentId, chunk, pid]))
    const [entry] = registry.list
    const transport = entry?.transport(tmpdir())
    assert.strictEqual(transport?._tag, 'Process')
    if (transport?._tag !== 'Process') return
    transport.stderr?.('warming up\n', 42)
    assert.deepStrictEqual(said, [[entry?.definition.id ?? '', 'warming up\n', 42]])
    // Without one, it goes nowhere of Althar's.
    const quiet = Agents.fromRegistry().list[0]?.transport(tmpdir())
    assert.isUndefined(quiet?._tag === 'Process' ? quiet.stderr : undefined)
  })
})
