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
  it('are read from Codex’s config by their tables, quoted or not, each once', () => {
    expect(
      codexServers(
        [
          'model = "gpt-6"',
          '[mcp_servers.github]',
          'command = "npx"',
          '[mcp_servers.github.env]',
          'TOKEN = "x"',
          '[mcp_servers."linear-server"]',
          "[ mcp_servers . 'notes' ]",
          '[profiles.fast]',
        ].join('\n'),
      ),
    ).toEqual(['github', 'linear-server', 'notes'])
    expect(codexServers('')).toEqual([])
  })

  it('are read from OpenCode’s config, comments and trailing commas and all', () => {
    expect(
      openCodeServers('{\n  // mine\n  "mcp": { "github": { "type": "local" }, /* and */ "sentry": {}, },\n  "url": "http://a//b"\n}'),
    ).toEqual(['github', 'sentry'])
    expect(openCodeServers('not json')).toEqual([])
    expect(openCodeServers('{"mcp": null}')).toEqual([])
  })

  it('are switched off for Codex, from its home and the repository, by keys codex-acp leaves beside its own', () => {
    const home = folder({ 'codex/config.toml': '[mcp_servers.github]\n[mcp_servers.althar]\n[mcp_servers."a.b"]\n' })
    const cwd = folder({ '.codex/config.toml': '[mcp_servers.sentry]\n' })
    const env = codexWithoutOwnTools({ env: { CODEX_HOME: join(home, 'codex') }, homeDir: '/nowhere', cwd })
    expect(JSON.parse(env.CODEX_CONFIG ?? '{}')).toEqual({ 'mcp_servers.github.enabled': false, 'mcp_servers.sentry.enabled': false })
    // Its usual folder, where no home is set; with nothing named, nothing added.
    expect(codexWithoutOwnTools({ env: {}, homeDir: folder({}), cwd: folder({}) })).toEqual({})
    expect(agents.codex.withoutOwnTools).toBe(codexWithoutOwnTools)
  })

  it('are switched off for OpenCode in the config it takes, over the rest of Althar’s', () => {
    const homeDir = folder({ '.config/opencode/opencode.jsonc': '{ "mcp": { "github": {} } }' })
    const cwd = folder({ 'opencode.json': '{ "mcp": { "sentry": {} } }', '.opencode/opencode.json': '{ "mcp": { "althar": {} } }' })
    const at = openCodeWithoutOwnTools({ permission: { bash: 'ask' } })
    expect(JSON.parse(at({ env: {}, homeDir, cwd }).OPENCODE_CONFIG_CONTENT ?? '{}')).toEqual({
      permission: { bash: 'ask' },
      mcp: { github: { enabled: false }, sentry: { enabled: false } },
    })
    // Its config elsewhere, as XDG and OPENCODE_CONFIG_DIR say; with nothing named, Althar's config as it is.
    const xdg = folder({ 'opencode/opencode.json': '{ "mcp": { "notes": {} } }' })
    const dir = folder({ 'opencode.json': '{ "mcp": { "docs": {} } }' })
    expect(
      JSON.parse(
        at({ env: { XDG_CONFIG_HOME: xdg, OPENCODE_CONFIG_DIR: dir }, homeDir: '/nowhere', cwd: folder({}) }).OPENCODE_CONFIG_CONTENT ??
          '{}',
      ).mcp,
    ).toEqual({
      notes: { enabled: false },
      docs: { enabled: false },
    })
    expect(JSON.parse(at({ env: {}, homeDir: folder({}), cwd: folder({}) }).OPENCODE_CONFIG_CONTENT ?? '{}')).toEqual({
      permission: { bash: 'ask' },
    })
    expect(agents.opencode.withoutOwnTools).toBeTypeOf('function')
    expect(agents['claude-code'].withoutOwnTools).toBeUndefined()
  })
})
