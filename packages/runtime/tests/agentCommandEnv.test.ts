import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { agentServers } from '@althar/provider-adapters'
import { afterEach, describe, expect, it } from 'vitest'

import { commandEnv, runIn } from '../src/agentTools'
import { readRecord, type SyncIo, turnOff, turnOn } from '../src/mcpSync'
import { homeWith } from './agentHome'

/*
 * Sync's own way of running an agent's command, in a home of the test's
 * own, with what Althar inherited pointing somewhere else: CODEX_HOME,
 * XDG_CONFIG_HOME and CLAUDE_CONFIG_DIR naming another folder. A command
 * writes where sync read, and nothing in that other folder changes. Fakes
 * of `claude` and `codex`, first on the PATH, write their files where their
 * environment says, as the agents do.
 */

// The fake agent commands are scripts started by their shebang, which Windows doesn't read.

const fakeBin = () => {
  const bin = mkdtempSync(join(tmpdir(), 'althar-fake-bin-'))
  const script = (body: string) => `#!${process.execPath}\nconst fs = require('node:fs'); const path = require('node:path');\n${body}\n`
  writeFileSync(
    join(bin, 'claude'),
    script(`
const [, , , verb, , , name, json] = process.argv
const file = process.env.CLAUDE_CONFIG_DIR ? path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json') : path.join(process.env.HOME, '.claude.json')
const config = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
config.mcpServers = { ...config.mcpServers }
if (verb === 'remove') delete config.mcpServers[name]
else config.mcpServers[name] = JSON.parse(json)
fs.mkdirSync(path.dirname(file), { recursive: true })
fs.writeFileSync(file, JSON.stringify(config))`),
  )
  writeFileSync(
    join(bin, 'codex'),
    script(`
const args = process.argv.slice(2)
const name = args[2]
const dash = args.indexOf('--')
const [command, ...rest] = args.slice(dash + 1)
const dir = process.env.CODEX_HOME || path.join(process.env.HOME, '.codex')
fs.mkdirSync(dir, { recursive: true })
fs.appendFileSync(path.join(dir, 'config.toml'), '\\n[mcp_servers.' + name + ']\\ncommand = ' + JSON.stringify(command) + '\\nargs = ' + JSON.stringify(rest) + '\\n')`),
  )
  chmodSync(join(bin, 'claude'), 0o755)
  chmodSync(join(bin, 'codex'), 0o755)
  return bin
}

const PLACES = ['CODEX_HOME', 'XDG_CONFIG_HOME', 'CLAUDE_CONFIG_DIR'] as const
const before = Object.fromEntries(PLACES.map((key) => [key, process.env[key]]))
afterEach(() => {
  for (const key of PLACES)
    if (before[key] === undefined) delete process.env[key]
    else process.env[key] = before[key]
})

describe('an agent’s command, as sync runs it', () => {
  it('runs in the configured home and places, never those Althar inherited', () => {
    const env = commandEnv(
      '/h',
      { PATH: '/bin' },
      { CODEX_HOME: '/elsewhere/codex', XDG_CONFIG_HOME: '/elsewhere', CLAUDE_CONFIG_DIR: '/elsewhere/claude', HOME: '/other', LANG: 'C' },
    )
    expect([env['HOME'], env['CODEX_HOME'], env['XDG_CONFIG_HOME'], env['CLAUDE_CONFIG_DIR'], env['LANG']]).toEqual([
      '/h',
      join('/h', '.codex'),
      undefined,
      undefined,
      'C',
    ])
    expect(commandEnv('/h', { CODEX_HOME: '/h/codex-home' })['CODEX_HOME']).toBe('/h/codex-home')
  })

  it.skipIf(process.platform === 'win32')(
    'writes where sync read, through the agents’ commands, and nothing where the inherited places point',
    async () => {
      const elsewhere = mkdtempSync(join(tmpdir(), 'althar-elsewhere-'))
      mkdirSync(join(elsewhere, 'codex'))
      process.env['CODEX_HOME'] = join(elsewhere, 'codex')
      process.env['XDG_CONFIG_HOME'] = elsewhere
      process.env['CLAUDE_CONFIG_DIR'] = join(elsewhere, 'claude')
      const home = homeWith({
        claude: { mcpServers: { fromclaude: { type: 'stdio', command: 'one', args: [] } } },
        codex: { mcp_servers: { fromcodex: { command: 'two', args: [] } } },
      })
      const env = { PATH: fakeBin() }
      const io: SyncIo = {
        home: { homeDir: home, env },
        folder: join(home, 'profile'),
        run: runIn(home, env),
        now: () => '2026-11-07T18:00:00.000Z',
      }
      const { errors } = await turnOn(io)
      expect(errors).toEqual([])
      expect(
        agentServers('codex', { homeDir: home, env })
          .servers.map((one) => one.name)
          .sort(),
      ).toEqual(['fromclaude', 'fromcodex'])
      expect(
        agentServers('claude', { homeDir: home, env })
          .servers.map((one) => one.name)
          .sort(),
      ).toEqual(['fromclaude', 'fromcodex'])
      expect(
        readRecord(io)
          .added.map((one) => `${one.spec.name}→${one.agent}`)
          .sort(),
      ).toEqual(['fromclaude→codex', 'fromclaude→opencode', 'fromcodex→claude', 'fromcodex→opencode'])
      // Nothing went where Althar's inherited places pointed.
      expect(readdirSync(elsewhere).sort()).toEqual(['codex'])
      expect(readdirSync(join(elsewhere, 'codex'))).toEqual([])
      expect(existsSync(join(elsewhere, 'claude'))).toBe(false)
    },
  )
  it.skipIf(process.platform === 'win32')(
    'reads, backs up and takes back Claude Code’s servers where a configured CLAUDE_CONFIG_DIR keeps them, as its command writes',
    async () => {
      const home = homeWith({ codex: { mcp_servers: { fromcodex: { command: 'two', args: [] } } } })
      const claudeDir = join(home, 'claude-config')
      mkdirSync(claudeDir)
      writeFileSync(
        join(claudeDir, '.claude.json'),
        JSON.stringify({ mcpServers: { fromclaude: { type: 'stdio', command: 'one', args: [] } } }),
      )
      const env = { PATH: fakeBin(), CLAUDE_CONFIG_DIR: claudeDir }
      const io: SyncIo = {
        home: { homeDir: home, env },
        folder: join(home, 'profile'),
        run: runIn(home, env),
        now: () => '2026-11-07T18:00:00.000Z',
      }
      expect(agentServers('claude', { homeDir: home, env }).servers.map((one) => one.name)).toEqual(['fromclaude'])
      const { errors } = await turnOn(io)
      expect(errors).toEqual([])
      expect(
        agentServers('claude', { homeDir: home, env })
          .servers.map((one) => one.name)
          .sort(),
      ).toEqual(['fromclaude', 'fromcodex'])
      // Nothing in the home's own file, and the copy kept is of the configured one.
      expect(existsSync(join(home, '.claude.json'))).toBe(false)
      expect(readRecord(io).backups.claude).toMatch(/claude-/)
      const off = await turnOff(io, true)
      expect(off.errors).toEqual([])
      expect(agentServers('claude', { homeDir: home, env }).servers.map((one) => one.name)).toEqual(['fromclaude'])
    },
  )
})
