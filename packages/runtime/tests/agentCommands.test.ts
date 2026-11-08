import { execFile, execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { agentServers } from '@althar/provider-adapters'
import { expect, it } from 'vitest'

import { keepOut, readRecord, type SyncIo, turnOff, turnOn } from '../src/mcpSync'
import { homeWith } from './agentHome'

/*
 * Sync through the real `claude` and `codex` commands, where both are on
 * this computer: in a home of the test's own (HOME and CODEX_HOME), never the
 * person's. It shows each command takes the arguments sync gives it, and
 * that what it writes reads back as the same server.
 */

const PATH = `${process.env['HOME']}/.local/bin:/opt/homebrew/bin:/usr/local/bin:${process.env['PATH']}`
const installed = (command: string) => {
  try {
    execFileSync('which', [command], { env: { ...process.env, PATH } })
    return true
  } catch {
    return false
  }
}

it.skipIf(!installed('claude') || !installed('codex'))('writes and takes back through the real agents’ commands', async () => {
  const home = homeWith({
    claude: {
      mcpServers: {
        local: { type: 'stdio', command: 'npx', args: ['-y', '@upstash/context7-mcp'], env: { MODE: 'quiet' } },
        remote: { type: 'http', url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer ${EXAMPLE_TOKEN}' } },
      },
    },
    codex: { mcp_servers: { fromcodex: { command: 'uvx', args: ['some-mcp'] } } },
  })
  const env = { ...process.env, HOME: home, CODEX_HOME: join(home, '.codex'), XDG_CONFIG_HOME: join(home, '.config'), PATH }
  const said: Array<string> = []
  const run: SyncIo['run'] = (command, args) =>
    new Promise((resolve) =>
      execFile(command, [...args], { env }, (error, stdout, stderr) => {
        said.push(`$ ${command} ${args.join(' ')}\n${stdout}${stderr}`.trim())
        resolve({ code: error === null ? 0 : typeof error.code === 'number' ? error.code : 1, output: `${stdout}${stderr}` })
      }),
    )
  const io: SyncIo = {
    home: { homeDir: home, env },
    folder: mkdtempSync(join(tmpdir(), 'althar-sync-record-')),
    run,
    now: () => '2026-11-07T17:00:00.000Z',
  }
  const { errors } = await turnOn(io)
  expect(errors).toEqual([])
  expect(
    agentServers('codex', { homeDir: home })
      .servers.map((one) => one.name)
      .sort(),
  ).toEqual(['fromcodex', 'local', 'remote'])
  expect(
    agentServers('claude', { homeDir: home })
      .servers.map((one) => one.name)
      .sort(),
  ).toEqual(['fromcodex', 'local', 'remote'])
  await keepOut(io, 'codex', 'remote')
  expect(
    agentServers('codex', { homeDir: home })
      .servers.map((one) => one.name)
      .sort(),
  ).toEqual(['fromcodex', 'local'])
  const off = await turnOff(io, true)
  expect(off.errors).toEqual([])
  expect(agentServers('codex', { homeDir: home }).servers.map((one) => one.name)).toEqual(['fromcodex'])
  expect(
    agentServers('claude', { homeDir: home })
      .servers.map((one) => one.name)
      .sort(),
  ).toEqual(['local', 'remote'])
  expect(readRecord(io).added).toEqual([])
})
