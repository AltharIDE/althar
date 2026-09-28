import { existsSync } from 'node:fs'

import { assert, describe, it } from '@effect/vitest'

import { agents } from '../src/registry'

describe('the agent registry', () => {
  it('ships every bundled adapter where it says', () => {
    for (const agent of Object.values(agents).filter((entry) => entry.source === 'bundled')) {
      const spec = agent.launch('/usr/bin/node')
      assert.strictEqual(spec.command, '/usr/bin/node')
      assert.isTrue(existsSync(spec.args[0] ?? ''), `${agent.id}: ${spec.args[0]}`)
    }
  })

  it('never starts an agent in a mode that skips asking', () => {
    for (const agent of Object.values(agents)) {
      assert.notMatch(agent.modes.ask, /bypass|full-access|yolo/i, agent.id)
      assert.notStrictEqual(agent.modes.ask, agent.modes.readOnly)
    }
  })

  it('makes OpenCode ask, whatever its own config says', () => {
    const spec = agents.opencode.launch('/usr/bin/node')
    assert.deepStrictEqual([spec.command, ...spec.args], ['opencode', 'acp'])
    assert.deepStrictEqual(JSON.parse(spec.env?.OPENCODE_CONFIG_CONTENT ?? '{}'), {
      permission: { edit: 'ask', bash: 'ask', webfetch: 'ask' },
    })
  })
})
