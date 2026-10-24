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

  it('gives the sandbox neither the SSH agent’s socket nor ~/.ssh, and ships the ssh that stands for them (ADR-061)', () => {
    const finish = manifest.slice(manifest.indexOf('finish-args:'), manifest.indexOf('modules:'))
    expect(finish).not.toMatch(/^\s*-\s+--socket=ssh-auth/m)
    expect(finish).not.toMatch(/^\s*-\s+--filesystem=[^\n]*\.ssh/m)
    expect(manifest).toContain('- install -Dm644 known_hosts /app/share/althar/ssh/known_hosts\n')
    expect(manifest).toContain('- install -Dm755 ssh.sh /app/bin/ssh\n')
    // The path git.ts names for Althar's own git.
    expect(manifest).toContain('- install -Dm755 host-ssh.sh /app/bin/althar-host-ssh\n')
    for (const file of ['known_hosts', 'ssh.sh', 'host-ssh.sh']) expect(manifest).toContain(`        path: ${file}\n`)
  })
})
