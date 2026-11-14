import { tmpdir } from 'node:os'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { connect } from '../src/AgentConnection'
import { externalDefinition } from '../src/catalog'
import { qualifyAcp } from '../src/qualification'
import { fakeAgentMain } from '../src/testing'
import { compatibilityPeer } from '../src/testing/compatibilityPeer'

const definition = externalDefinition({
  id: 'acp-test',
  name: 'Test',
  command: 'test-agent',
  args: [],
  mode: 'ask',
  readerMode: 'read',
  modeOption: 'mode',
  modelOption: 'model',
  effortOption: null,
  held: {},
  registryId: null,
  registryVersion: null,
})

describe('external agent compatibility', () => {
  it.live('accepts a peer that asks, obeys refusals, retains MCP in reading mode and cancels', () =>
    Effect.gen(function* () {
      assert.strictEqual(yield* qualifyAcp(definition, () => compatibilityPeer(null)), '1.2.3')
    }),
  )

  for (const [bad, message] of [
    ['command', 'after it was refused'],
    ['reader', 'reading mode allowed'],
    ['reader-shell', 'reading mode allowed a shell'],
    ['no-request', 'did not ask'],
    ['no-mcp', 'did not call the MCP'],
    ['no-cancel', 'did not confirm cancellation'],
    ['no-version', 'did not report a version'],
  ] as const)
    it.live(`refuses a peer with ${bad}`, () =>
      Effect.gen(function* () {
        const failed = yield* Effect.flip(qualifyAcp(definition, () => compatibilityPeer(bad)))
        assert.include(failed instanceof Error ? failed.message : String(failed), message)
      }),
    )

  it.live('refuses a changed reported version before any session is opened', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const failed = yield* Effect.flip(
          connect({
            transport: {
              _tag: 'Process',
              spec: { command: 'bun', args: [fakeAgentMain] },
              cwd: tmpdir(),
              expectedVersion: 'not-the-version',
            },
            onPermission: () => Effect.succeed({ decision: 'reject' }),
          }),
        )
        assert.strictEqual(failed._tag, 'AgentRequestFailed')
        if (failed._tag === 'AgentRequestFailed') assert.include(failed.message, 'changed version')
      }),
    ),
  )
})
