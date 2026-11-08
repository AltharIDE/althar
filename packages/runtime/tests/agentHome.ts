import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { agentServers } from '@althar/provider-adapters'

import type { SyncIo } from '../src/mcpSync'

/*
 * A home of a test's own for the person's agents' settings, never the real
 * `~/.claude.json`, `~/.codex` or `~/.config/opencode`; and fakes of Claude
 * Code's and Codex's own commands, which write their files as the agents do
 * and keep what they were asked. One told to fail says so as the agent would.
 */

const withoutTransport = (spec: Record<string, unknown>) => Object.fromEntries(Object.entries(spec).filter(([key]) => key !== 'transport'))

/** A config as TOML, as far as these tests need: tables of strings, numbers, booleans and lists of strings, a table deep. */
export const stringify = (config: Record<string, unknown>): string => {
  const value = (each: unknown): string =>
    Array.isArray(each) ? `[${each.map(value).join(', ')}]` : typeof each === 'string' ? JSON.stringify(each) : String(each)
  const lines: Array<string> = []
  const table = (path: string, entries: Record<string, unknown>) => {
    const plain = Object.entries(entries).filter(([, each]) => typeof each !== 'object' || Array.isArray(each))
    if (path !== '') lines.push(`[${path}]`)
    for (const [key, each] of plain) lines.push(`${key} = ${value(each)}`)
    for (const [key, each] of Object.entries(entries))
      if (typeof each === 'object' && each !== null && !Array.isArray(each))
        table(path === '' ? key : `${path}.${key}`, each as Record<string, unknown>)
  }
  table('', config)
  return `${lines.join('\n')}\n`
}

export const GITHUB_NPX = {
  type: 'stdio',
  command: 'npx',
  args: ['-y', '@github/github-mcp-server'],
  env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' },
}

export const homeWith = (files: { claude?: unknown; codex?: Record<string, unknown>; opencode?: string }) => {
  const home = mkdtempSync(join(tmpdir(), 'althar-sync-'))
  if (files.claude !== undefined) writeFileSync(join(home, '.claude.json'), JSON.stringify(files.claude, null, 2))
  if (files.codex !== undefined) {
    mkdirSync(join(home, '.codex'), { recursive: true })
    writeFileSync(join(home, '.codex', 'config.toml'), stringify(files.codex))
  }
  if (files.opencode !== undefined) {
    mkdirSync(join(home, '.config', 'opencode'), { recursive: true })
    writeFileSync(join(home, '.config', 'opencode', 'opencode.json'), files.opencode)
  }
  return home
}

/** Claude Code's and Codex's commands, as they write their own files; each call kept. */
export const fakeAgents = (home: string, fails: ReadonlyArray<string> = []) => {
  const calls: Array<string> = []
  const claudeFile = join(home, '.claude.json')
  const codexFile = join(home, '.codex', 'config.toml')
  /** Codex's config as its file says it now, read back the way Althar reads it. */
  const codexConfig = (): Record<string, unknown> => {
    const found = agentServers('codex', { homeDir: home }).servers
    return {
      mcp_servers: Object.fromEntries(
        found.map(({ name, tokenVariable, off, ...spec }) => [
          name,
          {
            ...withoutTransport(spec),
            ...(tokenVariable === undefined ? {} : { bearer_token_env_var: tokenVariable }),
            ...(off === true ? { enabled: false } : {}),
          },
        ]),
      ),
    }
  }
  const run: SyncIo['run'] = async (command, args) => {
    calls.push([command, ...args].join(' '))
    if (fails.includes(command)) return { code: 1, output: `${command}: couldn't write its settings` }
    if (command === 'claude') {
      const config = existsSync(claudeFile) ? (JSON.parse(readFileSync(claudeFile, 'utf8')) as Record<string, any>) : {}
      const servers = { ...config['mcpServers'] }
      if (args[1] === 'add-json') servers[args[4]!] = JSON.parse(args[5]!)
      else if (args[1] === 'remove') delete servers[args[4]!]
      writeFileSync(claudeFile, JSON.stringify({ ...config, mcpServers: servers }, null, 2))
      return { code: 0, output: '' }
    }
    const config = codexConfig()
    const servers: Record<string, unknown> = { ...(config['mcp_servers'] as Record<string, unknown> | undefined) }
    if (args[1] === 'add') {
      const name = args[2]!
      const rest = args.slice(3)
      const url = rest.indexOf('--url')
      if (url >= 0) {
        const bearer = rest.indexOf('--bearer-token-env-var')
        servers[name] = { url: rest[url + 1], ...(bearer >= 0 ? { bearer_token_env_var: rest[bearer + 1] } : {}) }
      } else {
        const dash = rest.indexOf('--')
        const env = Object.fromEntries(
          rest.slice(0, dash).flatMap((arg, at, all) => (arg === '--env' ? [all[at + 1]!.split('=') as [string, string]] : [])),
        )
        const [cmd, ...cmdArgs] = rest.slice(dash + 1)
        servers[name] = { command: cmd, args: cmdArgs, ...(Object.keys(env).length === 0 ? {} : { env }) }
      }
    } else if (args[1] === 'remove') delete servers[args[2]!]
    mkdirSync(join(home, '.codex'), { recursive: true })
    writeFileSync(codexFile, stringify({ ...config, mcp_servers: servers }))
    return { code: 0, output: '' }
  }
  let tick = 0
  const io: SyncIo = {
    home: { homeDir: home, env: {} },
    folder: join(home, 'althar-profile'),
    run,
    now: () => `2026-11-07T10:00:${String(tick++).padStart(2, '0')}.000Z`,
  }
  return { io, calls }
}
