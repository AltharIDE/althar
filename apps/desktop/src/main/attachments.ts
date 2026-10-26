import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'

import { measure } from '@althar/runtime/attachments'

/*
 * A file or folder the person adds to a message (ADR-060), as the window is
 * told of it: measured here, where the path is, so a folder too large is
 * refused as it is dropped rather than when it is sent, and granted to the
 * runtime, which copies it as the message goes. The window gets its name,
 * what it is and how large, and the grant; never its path.
 *
 * Pasting a file copied in the file manager (⌘C in Finder, Ctrl+C in
 * Explorer or Files) works as dropping it: the clipboard names it by its
 * path, read here as each system puts it there.
 */

/** What the window is told of a file or folder added to a message. */
export type Attached =
  | {
      readonly ok: true
      readonly grant: string
      readonly name: string
      readonly kind: 'file' | 'folder'
      readonly bytes: number
      readonly entries: number | null
    }
  | { readonly ok: false; readonly name: string; readonly why: 'too_large' | 'too_many_files' | 'unreadable' }

/** Measures what is at `path` and grants it: what the window is told of it. */
export const attachedOf = async (path: string, allow: (path: string) => Promise<string | null>): Promise<Attached> => {
  const name = basename(path)
  const measured = measure(path)
  if (!measured.ok) return { ok: false, name, why: measured.why }
  const grant = await allow(path)
  if (grant === null) return { ok: false, name, why: 'unreadable' }
  return { ok: true, grant, name, kind: measured.kind, bytes: measured.bytes, entries: measured.entries }
}

/**
 * The clipboard, by a format's name: its bytes, where it holds that format,
 * whether as a MIME type or as the system's own (`raw`); null where it doesn't.
 */
export type ClipboardBytes = (format: string, raw: boolean) => Promise<Buffer | null>

/** How Electron's clipboard names a format of the system's own, which it reads as it is. */
export const rawFormat = (format: string) => `electron application/osclipboard;format="${format}"`

const fromUrls = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('file://'))
    .flatMap((line) => {
      try {
        return [fileURLToPath(line)]
      } catch {
        return []
      }
    })

const unescaped = (text: string) =>
  text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&amp;', '&')

/** The paths a property list of Finder's names: each in a `<string>`. */
export const pathsInList = (list: string): ReadonlyArray<string> =>
  [...list.matchAll(/<string>([^<]*)<\/string>/g)].map((match) => unescaped(match[1] ?? '')).filter((path) => path !== '')

/** The paths in Explorer's names: UTF-16, each ended by a NUL. */
export const pathsInNames = (names: Buffer): ReadonlyArray<string> =>
  names
    .toString('utf16le')
    .split('\0')
    .filter((path) => path !== '')

/**
 * The files on the clipboard, by their paths, as the file manager copied
 * them: the addresses any system lists (`text/uri-list`); else Finder's list
 * of names, or its one address; Explorer's names; a Linux file manager's
 * addresses. None where what was copied isn't files.
 */
export const clipboardPaths = async (bytes: ClipboardBytes, platform: string): Promise<ReadonlyArray<string>> => {
  const text = async (format: string, raw: boolean) => (await bytes(format, raw).catch(() => null))?.toString('utf8') ?? ''
  const listed = fromUrls(await text('text/uri-list', false))
  if (listed.length > 0) return listed
  if (platform === 'darwin') {
    const names = pathsInList(await text('NSFilenamesPboardType', true))
    return names.length > 0 ? names : fromUrls(await text('public.file-url', true))
  }
  if (platform === 'win32') {
    const names = await bytes('FileNameW', true).catch(() => null)
    return names === null ? [] : pathsInNames(names)
  }
  return fromUrls(await text('x-special/gnome-copied-files', true))
}
