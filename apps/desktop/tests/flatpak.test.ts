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
 * checks hold the manifest to leaving the app's binaries alone.
 */

const manifest = readFileSync(join(import.meta.dirname, '..', 'flatpak', 'dev.althar.app.yml'), 'utf8')

describe('the Flatpak manifest', () => {
  it('keeps flatpak-builder from stripping and extracting debug info, which breaks Bun-compiled binaries', () => {
    const app = manifest.slice(manifest.indexOf('- name: althar'))
    expect(app).toMatch(/build-options:\n\s+strip: false\n\s+no-debuginfo: true/)
    // On the app module itself, before the commands that copy the app in.
    expect(app.indexOf('no-debuginfo: true')).toBeLessThan(app.indexOf('build-commands:'))
  })
})
