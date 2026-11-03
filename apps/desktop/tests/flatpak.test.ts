import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/*
 * The Flatpak manifest (flatpak/dev.althar.app.yml). flatpak-builder rewrites
 * every ELF file it finds — stripping it and extracting debug info with
 * eu-strip — unless the module says not to. A Bun-compiled executable keeps
 * its JavaScript in a trailer at the end of the file, which the rewrite
 * drops: Claude Code's bundled `claude` (the Agent SDK's native binary)
 * would run as plain `bun`, so its sign-in and sessions would fail. These
 * checks hold the manifest to leaving the app's binaries alone and keep its
 * keyring access limited to the host Secret Service for safe sync fallback.
 */

const manifest = readFileSync(join(import.meta.dirname, '..', 'flatpak', 'dev.althar.app.yml'), 'utf8')

describe('the Flatpak manifest', () => {
  it('keeps flatpak-builder from stripping and extracting debug info, which breaks Bun-compiled binaries', () => {
    const app = manifest.slice(manifest.indexOf('- name: althar'))
    expect(app).toMatch(/build-options:\n\s+strip: false\n\s+no-debuginfo: true/)
    // On the app module itself, before the commands that copy the app in.
    expect(app.indexOf('no-debuginfo: true')).toBeLessThan(app.indexOf('build-commands:'))
  })

  it('does not grant direct KWallet access; Flatpak sign-ins use the Secret portal on KDE too', () => {
    const finish = manifest.slice(manifest.indexOf('finish-args:'), manifest.indexOf('modules:'))
    expect(finish).toContain('- --talk-name=org.freedesktop.secrets\n')
    expect(finish).not.toMatch(/org\.kde\.kwalletd/)
    // The portal is reachable through the default portal proxy and needs no explicit bus permission.
    expect(finish).not.toMatch(/^\s*-\s+--talk-name=org\.freedesktop\.portal\.Secret/m)
  })

  it("reaches the person's skill folders read-only, and nothing else of the home", () => {
    const finish = manifest.slice(manifest.indexOf('finish-args:'), manifest.indexOf('modules:'))
    expect([...finish.matchAll(/^\s*-\s+--filesystem=(.+)$/gm)].map((grant) => grant[1])).toEqual([
      '~/.claude/skills:ro',
      '~/.codex/skills:ro',
      '~/.agents/skills:ro',
      '~/.config/opencode/skills:ro',
    ])
  })

  it("runs Codex out on the device in the person's own home, where it finds ~/.agents/skills itself", () => {
    const bridge = readFileSync(join(import.meta.dirname, '..', 'flatpak', 'codex-host.sh'), 'utf8')
    expect(bridge).toContain('--env="HOME=${home:-')
    expect(bridge).toContain('--clear-env')
    // The account's home, by name: $CODEX_HOME/skills is how it finds the ones in ~/.codex/skills.
    expect(bridge).toMatch(/for name in CODEX_HOME /)
  })
})
