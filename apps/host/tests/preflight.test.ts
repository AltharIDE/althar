import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'

import metadata from '../package.json'
import { type StartPty, verifyBundledPrograms } from '../src/updates/preflight'
import { runCommand } from '../src/commands'
import { parseOptions } from '../src/options'
import { temporary } from './support'

const fixture = () => {
  const root = temporary()
  for (const name of ['@agentclientprotocol/claude-agent-acp', '@agentclientprotocol/codex-acp'] as const) {
    const folder = join(root, 'node_modules', name)
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'package.json'), JSON.stringify({ version: metadata.dependencies[name] }), { mode: 0o600 })
  }
  return { root, entry: join(root, 'host.js') }
}

/** A pseudo-terminal that prints what it is given and ends with the code given. */
const pty =
  (printed: string, code: number): StartPty =>
  () => {
    const exits: Array<(exit: { exitCode: number }) => void> = []
    const data: Array<(text: string) => void> = []
    queueMicrotask(() => {
      for (const listener of data) listener(printed)
      for (const listener of exits) listener({ exitCode: code })
    })
    return {
      pid: 1,
      process: 'sh',
      onData: (listener) => void data.push(listener),
      onExit: (listener) => void exits.push(listener),
      write: () => {},
      resize: () => {},
      pause: () => {},
      resume: () => {},
      kill: () => {},
    }
  }
const shell = pty('althar-pty\r\n', 0)

describe('portable release provider preflight', () => {
  it('takes adapters of this release and a pinned program for its system, and says what it is from the command line', async () => {
    const at = fixture()
    await verifyBundledPrograms(at.entry, shell, { platform: 'linux', arch: 'x64' })
    await verifyBundledPrograms(at.entry, shell, { platform: 'linux', arch: 'arm64' })
    // verify-release itself starts a real shell, through the runtime's own node-pty, on the system it runs on.
    if (process.platform === 'linux') {
      const commandOutput: string[] = []
      await Effect.runPromise(
        runCommand(parseOptions(['verify-release', '--json'], {}, at.root), {
          entry: at.entry,
          node: process.execPath,
          path: '/usr/bin:/bin',
          out: (text: string) => {
            commandOutput.push(text)
          },
        }),
      )
      expect(JSON.parse(commandOutput.join(''))).toMatchObject({ updaterProtocol: 1, platform: 'linux' })
    }
  })

  it('refuses a system no program is pinned for, and adapters of another version', async () => {
    const at = fixture()
    await expect(verifyBundledPrograms(at.entry, shell, { platform: 'freebsd', arch: 'x64' })).rejects.toMatchObject({
      code: 'UpdateFailed',
      message: expect.stringContaining('no pinned provider CLI'),
    })
    writeFileSync(join(at.root, 'node_modules/@agentclientprotocol/codex-acp/package.json'), '{"version":"0.0.0"}')
    await expect(verifyBundledPrograms(at.entry, shell, { platform: 'linux', arch: 'x64' })).rejects.toMatchObject({
      code: 'ReleaseRejected',
    })
  })

  it('refuses a release whose terminals can’t start a shell: a node-pty missing or that won’t load, or a shell that ends badly', async () => {
    const at = fixture()
    const terminal = { code: 'UpdateFailed', message: expect.stringContaining('can’t start a terminal') }
    const refusing: StartPty = () => {
      throw new Error('posix_spawnp failed.')
    }
    await expect(verifyBundledPrograms(at.entry, refusing)).rejects.toMatchObject(terminal)
    await expect(verifyBundledPrograms(at.entry, pty('', 1))).rejects.toMatchObject(terminal)
  })

  it('refuses a release that carries the worker but not its sandbox’s programs, its own', async () => {
    const at = fixture()
    const entry = join(at.root, 'dist', 'host.js')
    const linux = { platform: 'linux', arch: 'x64' }
    await verifyBundledPrograms(entry, shell, linux)
    writeFileSync(join(at.root, 'althar-worker'), '', { mode: 0o700 })
    await expect(verifyBundledPrograms(entry, shell, linux)).rejects.toMatchObject({
      code: 'UpdateFailed',
      message: expect.stringContaining('bwrap'),
    })
    const shipped = ['bwrap', 'rg', 'socat'].map((name) => join(at.root, 'tools', 'bin', name))
    for (const program of shipped) {
      mkdirSync(join(program, '..'), { recursive: true })
      writeFileSync(program, '', { mode: 0o600 })
    }
    // There but not runnable is missing too.
    await expect(verifyBundledPrograms(entry, shell, linux)).rejects.toMatchObject({ code: 'UpdateFailed' })
    for (const program of shipped) chmodSync(program, 0o700)
    await verifyBundledPrograms(entry, shell, linux)
  })
})
