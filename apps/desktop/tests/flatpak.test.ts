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
 * checks hold the manifest to leaving the app's binaries alone, and to the
 * keyring's talk permissions (ADR-028).
 */

const manifest = readFileSync(join(import.meta.dirname, '..', 'flatpak', 'dev.althar.app.yml'), 'utf8')

describe('the Flatpak manifest', () => {
  it('keeps flatpak-builder from stripping and extracting debug info, which breaks Bun-compiled binaries', () => {
    const app = manifest.slice(manifest.indexOf('- name: althar'))
    expect(app).toMatch(/build-options:\n\s+strip: false\n\s+no-debuginfo: true/)
    // On the app module itself, before the commands that copy the app in.
    expect(app.indexOf('no-debuginfo: true')).toBeLessThan(app.indexOf('build-commands:'))
  })

  it('reaches KWallet itself, which keeps the sealing key across restarts on KDE, and the secret service elsewhere', () => {
    const finish = manifest.slice(manifest.indexOf('finish-args:'), manifest.indexOf('modules:'))
    for (const name of ['org.freedesktop.secrets', 'org.kde.kwalletd6', 'org.kde.kwalletd5'])
      expect(finish).toContain(`- --talk-name=${name}\n`)
    // Talking to the wallet is all it needs: it owns no name of KWallet's, and sees no more of the bus.
    expect(finish).not.toMatch(/--own-name=org\.kde|--talk-name=org\.kde\.\*|--socket=session-bus/)
  })
})
