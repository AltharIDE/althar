import { existsSync } from 'node:fs'

import { assert, describe, it } from '@effect/vitest'

import { agents } from '../src/registry'
import { SECRET_PLACES, secretReadRules } from '../src/secrets'

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
      // One with no mode asks by what its session's meta holds it to, and has none for reading either.
      if (agent.modes.ask === null) {
        assert.isDefined(agent.sessionMeta, agent.id)
        assert.isNull(agent.modes.reader, agent.id)
        continue
      }
      for (const mode of [agent.modes.ask, agent.modes.reader])
        assert.notMatch(mode ?? '', /bypass|full-access|yolo|autopilot|auto-approve|accept-edits|\bauto\b/i, agent.id)
      // codex-acp's `agent` mode answers its own requests with an automatic reviewer.
      assert.notStrictEqual(`${agent.id}:${agent.modes.ask}`, 'codex:agent')
      assert.notStrictEqual(agent.modes.ask, agent.modes.readOnly)
    }
  })

  it('keeps off, for every session, what would have the later agents approve without asking', () => {
    const { copilot, junie, grok } = agents
    assert.deepStrictEqual(copilot.options.held, { allow_all: 'off' })
    assert.deepStrictEqual(junie.options.held, { brave_mode: 'off' })
    assert.deepStrictEqual(grok.sessionMeta?.(), { yoloMode: false, autoMode: false })
    assert.deepStrictEqual(grok.sessionMeta?.('reader'), { yoloMode: false, autoMode: false })
    assert.includeMembers([...agents['qwen-code'].launch('/usr/bin/node').args], ['--approval-mode', 'default'])
    assert.deepInclude(agents['mistral-vibe'].launch('/usr/bin/node').env ?? {}, {
      VIBE_DEFAULT_AGENT: 'ask',
      VIBE_BYPASS_TOOL_PERMISSIONS: 'false',
      VIBE_SMART_APPROVE_DEFAULT: 'false',
    })
    assert.deepInclude(copilot.launch('/usr/bin/node').env ?? {}, { COPILOT_DISABLE_LOGIN_SHELL_ENV: '1' })
    assert.deepInclude(junie.launch('/usr/bin/node').env ?? {}, { JUNIE_CONFIG_DEFAULT_LOCATIONS: 'false' })
    // Antigravity's mode is held where it asks, as its others approve without asking.
    assert.deepStrictEqual(agents.antigravity.options.held, { mode: 'default' })
    // None is launched with a flag that approves.
    for (const agent of [copilot, junie, grok, agents.kimi, agents['mistral-vibe'], agents['qwen-code'], agents.antigravity])
      for (const arg of agent.launch('/usr/bin/node').args)
        assert.notMatch(arg, /allow|yolo|autopilot|brave|approve|skip-permissions/i, agent.id)
  })

  it('sends the later agents only Althar’s own commands, as one of theirs turns their asking off', () => {
    for (const id of ['copilot', 'junie', 'grok', 'kimi', 'mistral-vibe', 'qwen-code', 'antigravity'] as const)
      assert.strictEqual(agents[id].commands, 'althar', id)
    for (const id of ['claude-code', 'codex', 'opencode'] as const) assert.isUndefined(agents[id].commands, id)
  })

  it('gives one account to an agent whose sign-in isn’t its folder’s own', () => {
    const one = Object.values(agents)
      .filter((agent) => agent.home.accounts === 'one')
      .map((agent) => agent.id)
    assert.deepStrictEqual(one, ['copilot', 'junie', 'mistral-vibe'])
  })

  it('leads no review of a pull request, and judges no permission, on an agent its session can’t hold to reading', () => {
    for (const id of ['copilot', 'junie', 'grok', 'kimi', 'mistral-vibe', 'qwen-code', 'antigravity'] as const) {
      assert.isUndefined(agents[id].reviewing, id)
      assert.isUndefined(agents[id].permissionJudge, id)
    }
  })

  it('runs Antigravity’s server as Google’s registry launches it, its sign-in its home’s own, with no browser and a temporary folder of its own', () => {
    const spec = agents.antigravity.launch('/usr/bin/node')
    assert.strictEqual(spec.command, 'agy_acp_server.par')
    assert.deepStrictEqual(spec.args, process.platform === 'linux' ? ['--uid='] : [])
    assert.deepStrictEqual(spec.env, { AGY_ACP_FORCE_FILE_STORAGE: '1', PYTHONUNBUFFERED: '1', BROWSER: 'true' })
    assert.isTrue(spec.privateTemp)
    // Every role in the mode that asks, and what it asks the person never answered by the rules.
    assert.deepStrictEqual(agents.antigravity.modes, { ask: 'default', readOnly: null, reader: 'default' })
    assert.strictEqual(agents.antigravity.permissions.questions, 'interaction_')
    for (const agent of Object.values(agents).filter((entry) => entry.id !== 'antigravity')) assert.isUndefined(agent.permissions.questions)
  })

  it('downloads Antigravity’s server only from Google, at one version, each archive and both its programs pinned, and none for Windows', () => {
    const download = agents.antigravity.cli?.download
    if (download === undefined || !('version' in download)) return assert.fail('Antigravity has a pinned download')
    assert.strictEqual(download.version, '1.3.0')
    assert.deepStrictEqual(Object.keys(download.assets).sort(), ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'])
    for (const [platform, asset] of Object.entries(download.assets)) {
      assert.match(asset.url, /^https:\/\/dl\.google\.com\/agy-extensions\/releases\/(macos|linux)\/agy-acp-server-1\.3\.0-/, platform)
      assert.match(asset.sha256, /^[0-9a-f]{64}$/, platform)
      assert.deepStrictEqual(Object.keys(asset.files).sort(), ['agy_acp_server.par', 'localharness_external'], platform)
      for (const sha256 of Object.values(asset.files)) assert.match(sha256, /^[0-9a-f]{64}$/, platform)
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

  it('denies every Claude Code session reading where the person keeps keys and sign-ins', () => {
    type Meta = { claudeCode: { options: { settings: { permissions: { deny?: Array<string> } } } } }
    const metaOf = agents['claude-code'].sessionMeta
    if (metaOf === undefined) return assert.fail('Claude Code has session options')
    for (const [role, options] of [
      ['lead', {}],
      ['reader', {}],
      ['reader', { offline: true }],
      ['reader', { untrusted: true }],
    ] as const) {
      const deny = (metaOf(role, options) as Meta).claudeCode.options.settings.permissions.deny ?? []
      assert.includeMembers(deny, ['Read(~/.ssh/**)', 'Read(~/.aws/**)', 'Read(~/.npmrc)'], role)
      assert.includeMembers(deny, secretReadRules() as Array<string>, role)
    }
    assert.lengthOf(secretReadRules(), SECRET_PLACES.length * 2)
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

  it('holds the coordinator’s Claude Code to its folder: commands run sandboxed without asking, writing only there, with no network', () => {
    type Options = {
      settings: {
        permissions: { deny: Array<string>; ask: Array<string> }
        sandbox: {
          enabled: boolean
          autoAllowBashIfSandboxed: boolean
          allowUnsandboxedCommands: boolean
          failIfUnavailable: boolean
          network?: Record<string, unknown>
          filesystem?: { allowWrite?: Array<string> }
        }
      }
    }
    const metaOf = agents['claude-code'].sessionMeta
    if (metaOf === undefined) return assert.fail('Claude Code has session options')
    const optionsOf = (options: { contained?: string; untrusted?: boolean; offline?: boolean }) =>
      (metaOf('reader', options) as { claudeCode: { options: Options } }).claudeCode.options
    const folder = '/work/meridian/.coordinator'
    const contained = optionsOf({ contained: folder })
    // Only where its sandbox can start: there, failing to start it fails the session rather than running commands without it.
    const starts = process.platform === 'darwin' || (process.platform === 'linux' && process.env.FLATPAK_ID === undefined)
    if (!starts || contained.settings.sandbox.autoAllowBashIfSandboxed === false) {
      assert.deepStrictEqual(contained, optionsOf({}))
      return
    }
    assert.deepStrictEqual(contained.settings.sandbox, {
      enabled: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      failIfUnavailable: true,
      network: { allowedDomains: [], strictAllowlist: true, allowLocalBinding: false, allowAllUnixSockets: false },
      filesystem: { allowWrite: [folder] },
    })
    // Its edit tools and the person's keys stay denied; no command asks, as each runs in the sandbox.
    assert.includeMembers(contained.settings.permissions.deny, ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', ...secretReadRules()])
    assert.notInclude(contained.settings.permissions.ask, 'Bash')
    // A review's lead never gets it, whatever it is passed: it reads a repository it doesn't trust.
    for (const options of [
      { contained: folder, untrusted: true },
      { contained: folder, untrusted: true, offline: true },
    ]) {
      const held = optionsOf(options)
      assert.include(held.settings.permissions.ask, 'Bash', JSON.stringify(options))
      assert.isFalse(held.settings.sandbox.autoAllowBashIfSandboxed)
    }
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
