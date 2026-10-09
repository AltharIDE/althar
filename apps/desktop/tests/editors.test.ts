import { describe, expect, it } from 'vitest'

import { editorsHere, fileLink } from '../src/runtime/editors'
import { isGenerated } from '../src/renderer/shared/generated'

describe('the editors here', () => {
  it('are the ones whose app is on this Mac, in the order offered, then Finder; none elsewhere', () => {
    const installed = new Set(['/Applications/Zed.app', '/Users/me/Applications/Cursor.app'])
    expect(editorsHere('/Users/me', (path) => installed.has(path), 'darwin')).toEqual([
      { id: 'cursor', name: 'Cursor' },
      { id: 'zed', name: 'Zed' },
      { id: 'finder', name: 'Finder' },
    ])
    expect(editorsHere('/home/me', () => true, 'linux')).toEqual([])
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
