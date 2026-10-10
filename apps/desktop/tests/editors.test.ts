import { describe, expect, it } from 'vitest'

import { Effect } from 'effect'

import { argsAt, bundleOf, editorsHere, fileLink, fileManagerOf, openInEditor, start } from '../src/runtime/editors'
import { deviceWords } from '../src/renderer/shared/device'
import { isGenerated } from '../src/renderer/shared/generated'

describe('the editors here', () => {
  it('are the ones whose app is on a Mac, in the order offered, then Finder', () => {
    const installed = new Set(['/Applications/Zed.app', '/Users/me/Applications/Cursor.app'])
    expect(editorsHere('/Users/me', (path) => installed.has(path), 'darwin')).toEqual([
      { id: 'cursor', name: 'Cursor' },
      { id: 'zed', name: 'Zed' },
      { id: 'finder', name: 'Finder' },
    ])
  })

  it('on Windows and Linux, the ones whose command is there, then the system’s file manager; no Mac-only editor', () => {
    const commands = new Map([
      ['code', 'C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd'],
      ['zed', '/usr/bin/zed'],
    ])
    const find = (known: { cli?: { name: string } }) => (known.cli === undefined ? null : (commands.get(known.cli.name) ?? null))
    expect(editorsHere('C:\\Users\\me', () => true, 'win32', find)).toEqual([
      { id: 'vscode', name: 'VS Code' },
      { id: 'zed', name: 'Zed' },
      { id: 'explorer', name: 'File Explorer' },
    ])
    expect(
      editorsHere(
        '/home/me',
        () => true,
        'linux',
        () => null,
      ),
    ).toEqual([{ id: 'files', name: 'Files' }])
    expect(fileManagerOf('linux').name).toBe('Files')
  })

  it('tell each editor’s command a file and line the way it takes one', () => {
    expect(argsAt('goto', '/w/a.ts', 12)).toEqual(['-g', '/w/a.ts:12'])
    expect(argsAt('colon', '/w/a.ts', 12)).toEqual(['/w/a.ts:12'])
    expect(argsAt('flag', '/w/a.ts', 12)).toEqual(['--line', '12', '/w/a.ts'])
    expect(argsAt('none', '/w/a.ts', 12)).toEqual(['/w/a.ts'])
  })

  it('draw icons from a Mac app’s bundle, and none elsewhere', () => {
    expect(bundleOf('finder', '/Users/me', () => false, 'darwin')).toBe('/System/Library/CoreServices/Finder.app')
    expect(bundleOf('zed', '/Users/me', (path) => path === '/Applications/Zed.app', 'darwin')).toBe('/Applications/Zed.app')
    expect(bundleOf('zed', '/home/me', () => true, 'linux')).toBeNull()
  })

  it('open nothing for an editor they don’t know, or one a system doesn’t have, and say a command that won’t start', async () => {
    expect(await Effect.runPromise(openInEditor('emacs', '/w', null, null, 'linux'))).toBe(false)
    expect(await Effect.runPromise(openInEditor('xcode', '/w', null, null, 'linux'))).toBe(false)
    expect(await Effect.runPromise(openInEditor('emacs', '/w', null, null, 'darwin'))).toBe(false)
    expect(await Effect.runPromise(start('/nowhere/althar-no-such-editor', ['/w'], 'linux'))).toBe(false)
  })

  it('refuse to hand a Windows shell a path it would read as more than a path', async () => {
    expect(await Effect.runPromise(start('C:\\x\\code.cmd', ['C:\\a "b"'], 'win32'))).toBe(false)
    expect(await Effect.runPromise(start('C:\\x\\code.cmd', ['%PATH%'], 'win32'))).toBe(false)
  })

  it('link to a file at a line with each part of its path encoded, so a # or ? stays in its name', () => {
    expect(fileLink('zed')('/w/my app/a#b?.ts', 12)).toBe('zed://file/w/my%20app/a%23b%3F.ts:12')
  })
})

describe('generated files', () => {
  it('are what a tool made: lockfiles, snapshots, minified and mapped files, build output, and files named so', () => {
    expect(
      [
        'bun.lock',
        'web/package-lock.json',
        'go.sum',
        'src/__snapshots__/a.snap',
        'app.min.js',
        'app.js.map',
        'dist/index.js',
        'api/generated/types.ts',
        'user.pb.go',
      ].map(isGenerated),
    ).toEqual([true, true, true, true, true, true, true, true, true])
    expect(['src/checkout.ts', 'README.md', 'distance.ts', 'src/build.ts'].map(isGenerated)).toEqual([false, false, false, false])
  })
})

describe('this computer, as each system calls it', () => {
  it('is a Mac with a Dock, a PC with no count on its icon, or a computer with a launcher', () => {
    expect(deviceWords('darwin')).toEqual({ this: 'this Mac', This: 'This Mac', the: 'the Mac', count: 'the Dock icon' })
    expect(deviceWords('win32')).toEqual({ this: 'this PC', This: 'This PC', the: 'the PC', count: null })
    expect(deviceWords('linux')).toMatchObject({ this: 'this computer', count: 'the launcher icon' })
  })
})
