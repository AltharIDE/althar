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

  it('loads Althar-chosen skills into a Claude Code lead as a local plugin for the session, and nowhere else', () => {
    type Meta = { claudeCode: { options: { plugins?: Array<{ type: string; path: string }>; allowDangerouslySkipPermissions: boolean } } }
    const without = agents['claude-code'].sessionMeta?.('lead', {}) as Meta
    assert.isUndefined(without.claudeCode.options.plugins)
    const lead = agents['claude-code'].sessionMeta?.('lead', { skills: '/data/skills/runs/r1/claude-code/plugin' }) as Meta
    assert.deepStrictEqual(lead.claudeCode.options.plugins, [{ type: 'local', path: '/data/skills/runs/r1/claude-code/plugin' }])
    assert.isFalse(lead.claudeCode.options.allowDangerouslySkipPermissions)
    // A reader (and so a review's lead) is given none, even if one is passed.
    const reader = agents['claude-code'].sessionMeta?.('reader', { skills: '/x', untrusted: true }) as Meta
    assert.isUndefined(reader.claudeCode.options.plugins)
  })

  it('says how each agent is given the run’s skills: Claude Code in its session, Codex as an added directory, OpenCode in its config', () => {
    assert.deepStrictEqual(
      Object.fromEntries(Object.values(agents).map((agent) => [agent.id, [agent.skills?.layout, agent.skills?.via.kind]])),
      { 'claude-code': ['claude-plugin', 'meta'], codex: ['agents', 'directory'], opencode: ['plain', 'env'] },
    )
    const via = agents.opencode.skills?.via
    assert.strictEqual(via?.kind, 'env')
    if (via?.kind !== 'env') return
    const own = agents.opencode.launch('/usr/bin/node').env ?? {}
    const config = JSON.parse(via.env('/data/skills/runs/r1/opencode', own).OPENCODE_CONFIG_CONTENT ?? '{}')
    // Its asks are kept: the skills folder is added to them, not put in their place.
    assert.deepStrictEqual(config, {
      ...JSON.parse(own.OPENCODE_CONFIG_CONTENT ?? '{}'),
      skills: { paths: ['/data/skills/runs/r1/opencode'] },
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

  it('lets a Claude Code lead listen on localhost in its sandbox, and a reader not', () => {
    type Sandbox = { network?: { allowLocalBinding?: boolean } }
    const sandboxOf = (role?: 'reader') =>
      (agents['claude-code'].sessionMeta?.(role) as { claudeCode: { options: { settings: { sandbox: Sandbox } } } }).claudeCode.options
        .settings.sandbox
    assert.deepStrictEqual(sandboxOf().network, { allowLocalBinding: true })
    assert.isUndefined(sandboxOf('reader').network)
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

  it('makes an offline Claude Code reader deny its web tools, and still ask for every command', () => {
    type Meta = { claudeCode: { options: { settings: { permissions: { deny?: Array<string>; ask: Array<string> } } } } }
    const metaOf = agents['claude-code'].sessionMeta
    if (metaOf === undefined) return assert.fail('Claude Code has session options')
    const permissionsOf = (role: 'lead' | 'reader', options?: { offline?: boolean }) =>
      (metaOf(role, options) as Meta).claudeCode.options.settings.permissions
    const offline = permissionsOf('reader', { offline: true })
    assert.includeMembers(offline.deny ?? [], ['Edit', 'Write', 'WebFetch', 'WebSearch'])
    assert.deepStrictEqual(offline.ask, ['Bash'])
    // A reader with the network keeps asking for its fetches, which Althar's reader rules allow.
    assert.notInclude(permissionsOf('reader').deny ?? [], 'WebFetch')
    assert.include(permissionsOf('reader', { offline: false }).ask, 'WebFetch')
    // A lead is never offline this way: the option is a reader's.
    assert.include(permissionsOf('lead', { offline: true }).ask, 'WebFetch')
  })

  it('makes Claude Code a review’s lead with no settings file and no hooks, keeping its reader rules and sandbox', () => {
    type Options = {
      settingSources?: Array<string>
      settings: {
        disableAllHooks?: boolean
        permissions: { deny: Array<string>; ask: Array<string> }
        sandbox: { enabled: boolean; autoAllowBashIfSandboxed: boolean }
      }
    }
    const metaOf = agents['claude-code'].sessionMeta
    if (metaOf === undefined) return assert.fail('Claude Code has session options')
    const optionsOf = (options?: { offline?: boolean; untrusted?: boolean }) =>
      (metaOf('reader', options) as { claudeCode: { options: Options } }).claudeCode.options
    for (const offline of [false, true]) {
      const untrusted = optionsOf({ untrusted: true, offline })
      // Neither the repository's settings (its hooks, its allow rules) nor the person's own allow rules load.
      assert.deepStrictEqual(untrusted.settingSources, [])
      assert.isTrue(untrusted.settings.disableAllHooks)
      assert.deepStrictEqual(untrusted.settings.permissions, optionsOf({ offline }).settings.permissions)
      assert.deepInclude(untrusted.settings.sandbox, { enabled: true, autoAllowBashIfSandboxed: false })
    }
    // The coordinator and a reviewer read the person's own code, with their settings, as before.
    assert.isUndefined(optionsOf().settingSources)
    assert.isUndefined(optionsOf().settings.disableAllHooks)
    // A lead's session is never untrusted this way: the option is a review's lead's.
    assert.isUndefined((metaOf('lead', { untrusted: true }) as { claudeCode: { options: Options } }).claudeCode.options.settingSources)
  })

  it('reviews a pull request from outside only on an agent its session holds to reading', () => {
    assert.isTrue(agents['claude-code'].reviewing?.outside)
    assert.isTrue(agents.opencode.reviewing?.outside)
    // codex-acp starts every turn on its mode's approval policy, on-request: what its sandbox contains runs without asking.
    assert.isFalse(agents.codex.reviewing?.outside)
  })

  it('turns Codex’s web search and hooks off for a review’s lead, beside the person’s MCP servers switched off', () => {
    const env = agents.codex.reviewing?.env
    if (env === undefined) return assert.fail('Codex has a review environment')
    const own = { CODEX_CONFIG: JSON.stringify({ 'mcp_servers.github.command': 'npx', 'mcp_servers.github.enabled': false }) }
    assert.deepStrictEqual(JSON.parse(env(own).CODEX_CONFIG ?? '{}'), {
      'mcp_servers.github.command': 'npx',
      'mcp_servers.github.enabled': false,
      web_search: 'disabled',
      'features.hooks': false,
    })
    assert.deepStrictEqual(JSON.parse(env({}).CODEX_CONFIG ?? '{}'), { web_search: 'disabled', 'features.hooks': false })
  })

  it('keeps the repository’s config, plugins and language servers out of an OpenCode review’s lead, and asks for its web search', () => {
    const env = agents.opencode.reviewing?.env
    if (env === undefined) return assert.fail('OpenCode has a review environment')
    const asks = { edit: 'ask', bash: 'ask', webfetch: 'ask', websearch: 'ask' }
    const own = {
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        permission: { edit: 'ask', bash: 'ask', webfetch: 'ask' },
        experimental: { continue_loop_on_deny: true },
        mcp: { github: { enabled: false } },
      }),
    }
    const held = env(own)
    assert.strictEqual(held.OPENCODE_DISABLE_PROJECT_CONFIG, '1')
    assert.deepStrictEqual(JSON.parse(held.OPENCODE_CONFIG_CONTENT ?? '{}'), {
      permission: asks,
      agent: { build: { permission: asks }, plan: { permission: asks } },
      experimental: { continue_loop_on_deny: true },
      mcp: { github: { enabled: false } },
      lsp: false,
    })
    // Without the person's servers to switch off, from its usual config.
    assert.deepInclude(JSON.parse(env({}).OPENCODE_CONFIG_CONTENT ?? '{}'), { lsp: false, permission: asks })
  })

  it('in a Flatpak, a reader’s commands run without the sandbox and every one asks, as no sandbox can start there', () => {
    const allows = () => {
      const meta = agents['claude-code'].sessionMeta?.('reader') as {
        claudeCode: { options: { settings: { sandbox: { allowUnsandboxedCommands: boolean } } } }
      }
      return meta.claudeCode.options.settings.sandbox.allowUnsandboxedCommands
    }
    const before = process.env.FLATPAK_ID
    try {
      delete process.env.FLATPAK_ID
      assert.isFalse(allows())
      process.env.FLATPAK_ID = 'dev.althar.app'
      assert.isTrue(allows())
    } finally {
      if (before === undefined) delete process.env.FLATPAK_ID
      else process.env.FLATPAK_ID = before
    }
  })

  it('inherits CODEX_PATH and the bus address only in a Flatpak, so a person’s own CODEX_PATH never changes which Codex runs elsewhere', () => {
    const inherits = () => agents.codex.launch('/usr/bin/node').inheritEnv
    const before = process.env.FLATPAK_ID
    try {
      delete process.env.FLATPAK_ID
      assert.deepStrictEqual(inherits(), ['CODEX_HOME'])
      process.env.FLATPAK_ID = 'dev.althar.app'
      assert.deepStrictEqual(inherits(), ['CODEX_HOME', 'CODEX_PATH', 'DBUS_SESSION_BUS_ADDRESS'])
    } finally {
      if (before === undefined) delete process.env.FLATPAK_ID
      else process.env.FLATPAK_ID = before
    }
  })

  it('never gives one option two meanings', () => {
    for (const agent of Object.values(agents)) {
      const { rejectAndContinue, rejectAndStop, allowScopes } = agent.permissions
      const ids = [...rejectAndContinue, ...rejectAndStop, ...Object.keys(allowScopes)]
      assert.strictEqual(new Set(ids).size, ids.length, agent.id)
    }
  })

  it('removes all Claude judge tools and user hooks, separately from reader sessions', () => {
    assert.deepStrictEqual(agents['claude-code'].permissionJudge?.sessionMeta, {
      claudeCode: {
        options: {
          tools: [],
          settingSources: [],
          allowDangerouslySkipPermissions: false,
          strictMcpConfig: true,
          settings: { disableAllHooks: true },
        },
      },
    })
    // Neither provider's read-only mode is proof that it cannot read the rest of the disk.
    assert.isUndefined(agents.codex.permissionJudge)
    assert.isUndefined(agents.opencode.permissionJudge)
  })
})
