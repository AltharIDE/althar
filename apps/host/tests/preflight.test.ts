import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'

import metadata from '../package.json'
import { verifyBundledPrograms } from '../src/updates/preflight'
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
describe('portable release provider preflight', () => {
  it('takes adapters of this release and a pinned program for its system, and says what it is from the command line', async () => {
    const at = fixture()
    await verifyBundledPrograms(at.entry, { platform: 'linux', arch: 'x64' })
    await verifyBundledPrograms(at.entry, { platform: 'linux', arch: 'arm64' })
    // The system it runs on, as a release for it is checked.
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
    await expect(verifyBundledPrograms(at.entry, { platform: 'freebsd', arch: 'x64' })).rejects.toMatchObject({
      code: 'UpdateFailed',
      message: expect.stringContaining('no pinned provider CLI'),
    })
    writeFileSync(join(at.root, 'node_modules/@agentclientprotocol/codex-acp/package.json'), '{"version":"0.0.0"}')
    await expect(verifyBundledPrograms(at.entry, { platform: 'linux', arch: 'x64' })).rejects.toMatchObject({ code: 'ReleaseRejected' })
  })

  it('refuses a release that carries the worker but not its sandbox’s programs, its own', async () => {
    const at = fixture()
    const entry = join(at.root, 'dist', 'host.js')
    const linux = { platform: 'linux', arch: 'x64' }
    await verifyBundledPrograms(entry, linux)
    writeFileSync(join(at.root, 'althar-worker'), '', { mode: 0o700 })
    await expect(verifyBundledPrograms(entry, linux)).rejects.toMatchObject({
      code: 'UpdateFailed',
      message: expect.stringContaining('bwrap'),
    })
    const shipped = ['bwrap', 'rg', 'socat'].map((name) => join(at.root, 'tools', 'bin', name))
    for (const program of shipped) {
      mkdirSync(join(program, '..'), { recursive: true })
      writeFileSync(program, '', { mode: 0o600 })
    }
    // There but not runnable is missing too.
    await expect(verifyBundledPrograms(entry, linux)).rejects.toMatchObject({ code: 'UpdateFailed' })
    for (const program of shipped) chmodSync(program, 0o700)
    await verifyBundledPrograms(entry, linux)
  })
})
