import { agents } from '@althar/provider-adapters'
import { assert, describe, it } from '@effect/vitest'

import { asTold, COMPACT, heldFor } from '../src/Sessions'

/*
 * What keeps an agent asking, from the registry, as a session starts and a
 * turn is told: the options it is held to, and the person's own commands
 * said as words to an agent one of whose commands turns its asking off.
 */

describe('what an agent is told', () => {
  it('says the person’s own command to an agent that takes only Althar’s as words, and Althar’s bare', () => {
    const { copilot, codex } = agents
    assert.strictEqual(asTold(copilot, COMPACT), COMPACT)
    for (const said of ['/yolo', '  /allow-all on', '/compact now']) {
      const told = asTold(copilot, said)
      assert.isFalse(told.trimStart().startsWith('/'), said)
      assert.isTrue(told.endsWith(said), said)
    }
    assert.strictEqual(asTold(copilot, 'Please run /yolo for me'), 'Please run /yolo for me')
    // An agent the person's commands reach as they are.
    assert.strictEqual(asTold(codex, '/review'), '/review')
  })
})

describe('what a session holds', () => {
  it('holds what would approve without asking, and a reader in its mode', () => {
    const { copilot, junie, codex, grok } = agents
    assert.deepStrictEqual(heldFor(copilot, false), { held: { allow_all: 'off' } })
    assert.deepStrictEqual(heldFor(copilot, true), {
      held: { allow_all: 'off', mode: 'https://agentclientprotocol.com/protocol/session-modes#agent' },
    })
    assert.deepStrictEqual(heldFor(junie, true), { held: { brave_mode: 'off', mode: 'plan' } })
    assert.deepStrictEqual(heldFor(codex, false), {})
    assert.deepStrictEqual(heldFor(codex, true), { held: { mode: 'read-only' } })
    // One with no mode has none to hold.
    assert.deepStrictEqual(heldFor(grok, true), {})
  })
})
