import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { locate, namesOf, usingLocated, usualDirs } from '../src/installs'
import { agents } from '../src/registry'

/*
 * Finding a command with what this computer has, where the caller says
 * nothing of it: its own system, environment, usual folders and files; and
 * the defaults on Windows where its environment leaves things out.
 */

const none = { bundled: null, kept: null }
const folders: Array<string> = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

describe('finding a command with this computer’s own defaults', () => {
  it.skipIf(process.platform === 'win32')('takes only a file it may run, on the PATH it is given', () => {
    const dir = mkdtempSync(join(tmpdir(), 'althar-locate-'))
    folders.push(dir)
    writeFileSync(join(dir, 'althar-fake-agent'), '#!/bin/sh\n')
    chmodSync(join(dir, 'althar-fake-agent'), 0o755)
    writeFileSync(join(dir, 'althar-fake-notes'), 'not a program')
    chmodSync(join(dir, 'althar-fake-notes'), 0o644)
    expect(locate('althar-fake-agent', none, { env: { PATH: dir }, dirs: [] })).toEqual({ command: 'althar-fake-agent', whose: 'theirs' })
    expect(locate('althar-fake-notes', none, { env: { PATH: dir }, dirs: [] })).toBeNull()
  })

  it('looks on this process’s own PATH where it is given no environment', () => {
    expect(locate('althar-no-such-command', none, { dirs: [], isExecutable: () => false })).toBeNull()
  })

  it('looks in the person’s usual folders where it is told of none, and on no PATH where the environment has none', () => {
    const installed = join(homedir(), '.local', 'bin', 'opencode')
    expect(locate('opencode', none, { env: {}, platform: 'linux', isExecutable: (path) => path === installed })).toEqual({
      command: installed,
      whose: 'theirs',
    })
  })

  it('on Windows, reads a program by its usual endings where PATHEXT isn’t set, and looks in no npm folder without APPDATA', () => {
    expect(namesOf('opencode', 'win32', {})).toEqual(['opencode.com', 'opencode.exe'])
    expect(usualDirs('win32', 'C:\\Users\\me', {})).toEqual([
      'C:\\Users\\me\\.local\\bin',
      'C:\\Users\\me\\.opencode\\bin',
      'C:\\Users\\me\\.grok\\bin',
      'C:\\Users\\me\\.kimi-code\\bin',
      'C:\\Users\\me\\.bun\\bin',
      'C:\\Users\\me\\scoop\\shims',
    ])
  })

  it('leaves an agent with no command of its own as it is, and gives one with no version command none', () => {
    const { cli: _cli, ...commandless } = agents.opencode
    expect(usingLocated(commandless, () => ({ command: '/kept/opencode', whose: 'althar' }))).toBe(commandless)
    const { version: _version, ...versionless } = agents.opencode
    const pointed = usingLocated(versionless, () => ({ command: '/kept/opencode', whose: 'althar' }))
    expect(pointed.launch('node').command).toBe('/kept/opencode')
    expect(pointed.version).toBeUndefined()
  })
})
