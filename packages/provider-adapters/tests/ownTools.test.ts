import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { codexServers, codexWithoutOwnTools, openCodeServers, openCodeWithoutOwnTools } from '../src/ownTools'
import { agents } from '../src/registry'

/* The person's own MCP servers, switched off by name as Codex and OpenCode start (ADR-011). */

const folder = (files: Readonly<Record<string, string>>) => {
  const root = mkdtempSync(join(tmpdir(), 'althar-own-tools-'))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

describe('the person’s own MCP servers', () => {
  it('are read from Codex’s config in every form TOML writes them, each with how it is reached', () => {
    const servers = codexServers(
      [
        'model = "gpt-6"',
        'mcp_servers.dotted = { command = "npx", args = ["dotted-mcp"] }',
        '[mcp_servers.github]',
        'command = "npx"',
        '[mcp_servers.github.env]',
        'TOKEN = "x"',
        '[mcp_servers."linear-server"]',
        'url = "https://mcp.linear.app/mcp"',
        '[profiles.fast]',
        'model = "gpt-6-mini"',
      ].join('\n'),
    )
    expect(Object.fromEntries(servers)).toEqual({
      dotted: { command: 'npx' },
      github: { command: 'npx' },
      'linear-server': { url: 'https://mcp.linear.app/mcp' },
    })
    expect(Object.fromEntries(codexServers('[mcp_servers]\ninline = { url = "http://localhost:9000" }\nbare = {}\n'))).toEqual({
      inline: { url: 'http://localhost:9000' },
      bare: null,
    })
    // Not TOML, or no servers: none.
    expect(codexServers('[mcp_servers\n').size).toBe(0)
    expect(codexServers('mcp_servers = 3').size).toBe(0)
  })

  it('are read from OpenCode’s config, comments and trailing commas and all', () => {
    expect(
      openCodeServers('{\n  // mine\n  "mcp": { "github": { "type": "local" }, /* and */ "sentry": {}, },\n  "url": "http://a//b"\n}'),
    ).toEqual(['github', 'sentry'])
    expect(openCodeServers('not json')).toEqual([])
    expect(openCodeServers('{"mcp": null}')).toEqual([])
  })

  it('are switched off for Codex, from its home and the repository down to the session’s folder, each still reachable', () => {
    const home = folder({
      'codex/config.toml':
        '[mcp_servers.github]\ncommand = "npx"\n[mcp_servers.althar]\ncommand = "x"\n[mcp_servers."a.b"]\ncommand = "x"\n',
    })
    // A project scoped to a folder of its repository: the repository's root has config too, and the first to name a server says how.
    const repository = folder({
      '.git/HEAD': 'ref: refs/heads/main\n',
      '.codex/config.toml': '[mcp_servers.sentry]\nurl = "https://mcp.sentry.dev/mcp"\n[mcp_servers.github]\nurl = "https://elsewhere"\n',
      'apps/web/.codex/config.toml': 'mcp_servers.docs = { command = "docs-mcp" }\n',
    })
    const env = codexWithoutOwnTools({ env: { CODEX_HOME: join(home, 'codex') }, homeDir: '/nowhere', cwd: join(repository, 'apps/web') })
    expect(JSON.parse(env.CODEX_CONFIG ?? '{}')).toEqual({
      'mcp_servers.github.command': 'npx',
      'mcp_servers.github.enabled': false,
      'mcp_servers.sentry.url': 'https://mcp.sentry.dev/mcp',
      'mcp_servers.sentry.enabled': false,
      'mcp_servers.docs.command': 'docs-mcp',
      'mcp_servers.docs.enabled': false,
    })
    // Its usual folder, where no home is set; with nothing named, nothing added.
    expect(codexWithoutOwnTools({ env: {}, homeDir: folder({}), cwd: folder({ '.git/HEAD': '' }) })).toEqual({})
    expect(agents.codex.withoutOwnTools).toBe(codexWithoutOwnTools)
  })

  it('are switched off for OpenCode in the config it takes, from each file it reads, over the rest of Althar’s', () => {
    const homeDir = folder({
      '.config/opencode/opencode.jsonc': '{ "mcp": { "github": {} } }',
      '.config/opencode/config.json': '{ "mcp": { "legacy": {} } }',
      '.opencode/opencode.json': '{ "mcp": { "mine": {} } }',
    })
    // A project scoped to a folder of its repository: files from there up to the root are read, and nothing above it.
    const outer = folder({
      'opencode.json': '{ "mcp": { "above": {} } }',
      'repository/.git/HEAD': '',
      'repository/opencode.json': '{ "mcp": { "sentry": {} } }',
      'repository/apps/web/.opencode/opencode.json': '{ "mcp": { "althar": {}, "docs": {} } }',
    })
    const repository = join(outer, 'repository')
    const at = openCodeWithoutOwnTools({ permission: { bash: 'ask' } })
    expect(JSON.parse(at({ env: {}, homeDir, cwd: join(repository, 'apps/web') }).OPENCODE_CONFIG_CONTENT ?? '{}')).toEqual({
      permission: { bash: 'ask' },
      mcp: {
        legacy: { enabled: false },
        github: { enabled: false },
        sentry: { enabled: false },
        docs: { enabled: false },
        mine: { enabled: false },
      },
    })
    // Its config elsewhere, as XDG, OPENCODE_CONFIG and OPENCODE_CONFIG_DIR say; a project's own config left out when it says so.
    const xdg = folder({ 'opencode/opencode.json': '{ "mcp": { "notes": {} } }' })
    const dir = folder({ 'opencode.json': '{ "mcp": { "docs": {} } }', 'custom.json': '{ "mcp": { "custom": {} } }' })
    const env = {
      XDG_CONFIG_HOME: xdg,
      OPENCODE_CONFIG_DIR: dir,
      OPENCODE_CONFIG: join(dir, 'custom.json'),
      OPENCODE_DISABLE_PROJECT_CONFIG: '1',
    }
    expect(JSON.parse(at({ env, homeDir: '/nowhere', cwd: repository }).OPENCODE_CONFIG_CONTENT ?? '{}').mcp).toEqual({
      notes: { enabled: false },
      custom: { enabled: false },
      docs: { enabled: false },
    })
    expect(JSON.parse(at({ env: {}, homeDir: folder({}), cwd: folder({ '.git/HEAD': '' }) }).OPENCODE_CONFIG_CONTENT ?? '{}')).toEqual({
      permission: { bash: 'ask' },
    })
    expect(agents.opencode.withoutOwnTools).toBeTypeOf('function')
    expect(agents['claude-code'].withoutOwnTools).toBeUndefined()
  })
})
