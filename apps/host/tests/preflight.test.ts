import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import metadata from '../package.json'
import { verifyBundledPrograms } from '../src/updates/preflight'
import { temporary } from './support'

const providers = vi.hoisted(() => ({ claude: vi.fn<() => string | null>(), codex: vi.fn<() => string | null>() }))
vi.mock('@althar/provider-adapters', () => ({
  agents: { 'claude-code': { cli: { bundled: providers.claude } }, codex: { cli: { bundled: providers.codex } } },
}))
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
})
