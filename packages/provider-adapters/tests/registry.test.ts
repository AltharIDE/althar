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
      // codex-acp's `agent` mode answers its own requests with an automatic reviewer.
      assert.notStrictEqual(`${agent.id}:${agent.modes.ask}`, 'codex:agent')
      assert.notStrictEqual(agent.modes.ask, agent.modes.readOnly)
    }
  })

  it('makes OpenCode ask, whatever its own config says, for its built-in agents too', () => {
    const spec = agents.opencode.launch('/usr/bin/node')
    assert.deepStrictEqual([spec.command, ...spec.args], ['opencode', 'acp'])
    const asks = { edit: 'ask', bash: 'ask', webfetch: 'ask' }
    assert.deepStrictEqual(JSON.parse(spec.env?.OPENCODE_CONFIG_CONTENT ?? '{}'), {
      permission: asks,
      agent: { build: { permission: asks }, plan: { permission: asks } },
      experimental: { continue_loop_on_deny: true },
    })
  })

  it('makes Claude Code ask, and keeps bypass mode out of reach', () => {
    const meta = agents['claude-code'].sessionMeta?.() as {
      claudeCode: { options: { allowDangerouslySkipPermissions: boolean; settings: { permissions: { ask: Array<string> } } } }
    }
    assert.isFalse(meta.claudeCode.options.allowDangerouslySkipPermissions)
    assert.isTrue((meta.claudeCode.options as unknown as { strictMcpConfig: boolean }).strictMcpConfig)
    assert.isTrue((meta.claudeCode.options.settings as unknown as { sandbox: { enabled: boolean } }).sandbox.enabled)
    assert.includeMembers(meta.claudeCode.options.settings.permissions.ask, ['Bash', 'Edit', 'Write'])
  })

  it('makes Claude Code a reader: its edits denied, and every command asking', () => {
    const meta = agents['claude-code'].sessionMeta?.('reader') as {
      claudeCode: {
        options: {
          settings: { permissions: { deny: Array<string>; ask: Array<string> }; sandbox: { autoAllowBashIfSandboxed: boolean } }
        }
      }
    }
    assert.includeMembers(meta.claudeCode.options.settings.permissions.deny, ['Edit', 'Write'])
    assert.includeMembers(meta.claudeCode.options.settings.permissions.ask, ['Bash'])
    assert.isFalse(meta.claudeCode.options.settings.sandbox.autoAllowBashIfSandboxed)
  })

  it('never gives one option two meanings', () => {
    for (const agent of Object.values(agents)) {
      const { rejectAndContinue, rejectAndStop, allowScopes } = agent.permissions
      const ids = [...rejectAndContinue, ...rejectAndStop, ...Object.keys(allowScopes)]
      assert.strictEqual(new Set(ids).size, ids.length, agent.id)
    }
  })
})
