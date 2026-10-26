// @vitest-environment node
import { mkdirSync, mkdtempSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MESSAGE_FILES } from '@althar/contracts'
import { describe, expect, it, vi } from 'vitest'

import { attachedOf, clipboardPaths, pastedOf, pathsInNames, rawFormat } from '../src/main/attachments'
import { fileAttachments, metaOf } from '../src/renderer/shared/files'

describe('a file or folder added to a message, as main tells the window of it', () => {
  it('measures it and grants it, a folder by its files; never telling its path', async () => {
    const downloads = mkdtempSync(join(tmpdir(), 'althar-downloads-'))
    writeFileSync(join(downloads, 'spec.pdf'), '%PDF-1.7')
    mkdirSync(join(downloads, 'logs', 'old'), { recursive: true })
    writeFileSync(join(downloads, 'logs', 'a.log'), 'aa')
    writeFileSync(join(downloads, 'logs', 'old', 'b.log'), 'b')
    const allow = vi.fn(async (path: string) => `grant_${path.length}`)
    expect(await attachedOf(join(downloads, 'spec.pdf'), allow)).toEqual({
      ok: true,
      grant: `grant_${join(downloads, 'spec.pdf').length}`,
      name: 'spec.pdf',
      kind: 'file',
      bytes: 8,
      entries: null,
    })
    expect(await attachedOf(join(downloads, 'logs'), allow)).toMatchObject({ ok: true, name: 'logs', kind: 'folder', bytes: 3, entries: 2 })
    // One too large is refused as it is added, and nothing is granted for it.
    const huge = join(downloads, 'disk.img')
    writeFileSync(huge, '')
    truncateSync(huge, MESSAGE_FILES.bytes + 1)
    allow.mockClear()
    expect(await attachedOf(huge, allow)).toEqual({ ok: false, name: 'disk.img', why: 'too_large' })
    expect(await attachedOf(join(downloads, 'gone.txt'), allow)).toEqual({ ok: false, name: 'gone.txt', why: 'unreadable' })
    expect(allow).not.toHaveBeenCalled()
  })

  it('gives a picture copied in the file manager its bytes, to go as an image; anything else as it is', async () => {
    const copied = mkdtempSync(join(tmpdir(), 'althar-copied-'))
    writeFileSync(join(copied, 'Shot.PNG'), 'png bytes')
    writeFileSync(join(copied, 'run.log'), 'log')
    const allow = async () => 'grant'
    expect(await pastedOf(join(copied, 'Shot.PNG'), allow)).toEqual({
      ok: true,
      grant: 'grant',
      name: 'Shot.PNG',
      kind: 'file',
      bytes: 9,
      entries: null,
      picture: { type: 'image/png', data: new Uint8Array(Buffer.from('png bytes')) },
    })
    expect(await pastedOf(join(copied, 'run.log'), allow)).not.toHaveProperty('picture')
  })

  it('reads the files the file manager copied off the clipboard, as each system puts them', async () => {
    const clipboard =
      (formats: Readonly<Record<string, string | Buffer>>) =>
      async (format: string, raw: boolean): Promise<Buffer | null> => {
        const held = formats[raw ? rawFormat(format) : format]
        return held === undefined ? null : Buffer.isBuffer(held) ? held : Buffer.from(held)
      }
    expect(
      await clipboardPaths(clipboard({ 'text/uri-list': 'file:///Users/me/Q3%20report.pdf\r\nfile:///Users/me/logs\r\n' }), 'darwin'),
    ).toEqual(['/Users/me/Q3 report.pdf', '/Users/me/logs'])
    const finder =
      '<?xml version="1.0"?><plist><array><string>/Users/me/a &amp; b.csv</string><string>/Users/me/c.txt</string></array></plist>'
    expect(await clipboardPaths(clipboard({ [rawFormat('NSFilenamesPboardType')]: finder }), 'darwin')).toEqual([
      '/Users/me/a & b.csv',
      '/Users/me/c.txt',
    ])
    expect(await clipboardPaths(clipboard({ [rawFormat('public.file-url')]: 'file:///Users/me/one.log' }), 'darwin')).toEqual([
      '/Users/me/one.log',
    ])
    expect(pathsInNames(Buffer.from('C:\\Users\\me\\spec.pdf\0', 'utf16le'))).toEqual(['C:\\Users\\me\\spec.pdf'])
    expect(
      await clipboardPaths(clipboard({ [rawFormat('x-special/gnome-copied-files')]: 'copy\nfile:///home/me/notes.md' }), 'linux'),
    ).toEqual(['/home/me/notes.md'])
    // Words copied, not files: none.
    expect(await clipboardPaths(clipboard({ 'text/plain': 'just words' }), 'darwin')).toEqual([])
  })
})

describe('a file or folder on a message, as the window shows it', () => {
  it('says a file’s size, and a folder’s files and size', () => {
    expect(metaOf({ kind: 'file', bytes: 48 * 1024, entries: null })).toBe('48 KB')
    expect(metaOf({ kind: 'folder', bytes: 2048, entries: 14 })).toBe('14 files · 2 KB')
    expect(
      fileAttachments([
        {
          id: 'input_1:1',
          name: 'spec.pdf',
          kind: 'file',
          mediaType: 'application/pdf',
          bytes: 1_258_291,
          entries: null,
          path: '/t/spec.pdf',
        },
        { id: 'input_1:2', name: 'logs', kind: 'folder', mediaType: null, bytes: 3, entries: 1, path: '/t/logs' },
      ]),
    ).toEqual([
      { id: 'input_1:1:0', kind: 'file', name: 'spec.pdf', meta: '1.2 MB' },
      { id: 'input_1:2:1', kind: 'folder', name: 'logs', meta: '1 file · 3 B' },
    ])
  })
})
