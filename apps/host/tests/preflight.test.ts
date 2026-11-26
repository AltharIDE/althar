import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'
import { Effect } from 'effect'

import metadata from '../package.json'
import { verifyBundledPrograms } from '../src/updates/preflight'
import { runCommand } from '../src/commands'
import { parseOptions } from '../src/options'
import { temporary } from './support'

const providers = vi.hoisted(() => ({ claude: vi.fn<() => string | null>(), codex: vi.fn<() => string | null>() }))
vi.mock('@althar/provider-adapters', async (importOriginal) => {
  const original = await importOriginal<typeof import('@althar/provider-adapters')>()
  return {
    ...original,
    agents: {
      ...original.agents,
      'claude-code': { ...original.agents['claude-code'], cli: { ...original.agents['claude-code'].cli, bundled: providers.claude } },
      codex: { ...original.agents.codex, cli: { ...original.agents.codex.cli, bundled: providers.codex } },
    },
  }
})
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
  it('probes binaries with no provider credentials or inherited home and removes the probe home', async () => {
    const at = fixture()
    const output = join(at.root, 'probe.json')
    const program = join(at.root, 'probe')
    writeFileSync(
      program,
      `#!/bin/sh\n[ "$1" = '--version' ] || exit 1\n[ -z "\${ANTHROPIC_API_KEY-}" ] || exit 2\n[ -z "\${ALTHAR_HOST_RELEASE_SIGNING_KEY-}" ] || exit 3\nprintf '%s' "$HOME" > '${output}'\n`,
      { mode: 0o700 },
    )
    providers.claude.mockReturnValue(program)
    providers.codex.mockReturnValue(program)
    await verifyBundledPrograms(at.entry)
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
    const home = readFileSync(output, 'utf8')
    expect(home).not.toBe(at.root)
    expect(existsSync(home)).toBe(false)
  })
  it('refuses incomplete, wrong-version and failing native bundles', async () => {
    const at = fixture()
    providers.claude.mockReturnValue(null)
    await expect(verifyBundledPrograms(at.entry)).rejects.toMatchObject({ code: 'UpdateFailed' })
    const failed = join(at.root, 'fail')
    writeFileSync(failed, '#!/bin/sh\nexit 1\n', { mode: 0o700 })
    providers.claude.mockReturnValue(failed)
    await expect(verifyBundledPrograms(at.entry)).rejects.toThrow()
    writeFileSync(join(at.root, 'node_modules/@agentclientprotocol/codex-acp/package.json'), '{"version":"0.0.0"}')
    await expect(verifyBundledPrograms(at.entry)).rejects.toMatchObject({ code: 'ReleaseRejected' })
  })

  it('refuses a release that carries the worker but not its sandbox’s programs', async () => {
    const at = fixture()
    const entry = join(at.root, 'dist', 'host.js')
    const target = join(at.root, 'node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl')
    const codex = join(target, 'bin', 'codex')
    mkdirSync(join(target, 'bin'), { recursive: true })
    writeFileSync(codex, '#!/bin/sh\n[ "$1" = --version ]\n', { mode: 0o700 })
    providers.claude.mockReturnValue(codex)
    providers.codex.mockReturnValue(codex)
    await verifyBundledPrograms(entry)
    writeFileSync(join(at.root, 'althar-worker'), '', { mode: 0o700 })
    await expect(verifyBundledPrograms(entry)).rejects.toMatchObject({ code: 'UpdateFailed', message: expect.stringContaining('bwrap') })
    const shipped = [join(target, 'codex-resources', 'bwrap'), join(target, 'codex-path', 'rg'), join(at.root, 'tools', 'bin', 'socat')]
    for (const program of shipped) {
      mkdirSync(join(program, '..'), { recursive: true })
      writeFileSync(program, '', { mode: 0o600 })
    }
    // There but not runnable is missing too.
    await expect(verifyBundledPrograms(entry)).rejects.toMatchObject({ code: 'UpdateFailed' })
    for (const program of shipped) chmodSync(program, 0o700)
    await verifyBundledPrograms(entry)
  })
})
