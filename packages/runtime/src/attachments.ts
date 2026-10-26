import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readSync, statSync, writeFileSync } from 'node:fs'
import { cp } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'

import { MESSAGE_FILES } from '@althar/contracts'

/*
 * The person's files and folders sent with a message, on disk (ADR-060):
 * what one is and how large, read before it is copied, and its copy, where
 * the thread's agent reads. Pure Node, shared with the app's main process,
 * which measures what is dropped before the window shows it, so the window
 * says at once what is too large. A folder is walked without following a
 * link in it, and stops being walked as soon as it is over: a dropped home
 * folder costs no more than the limit to refuse.
 *
 * The copies are kept in `.althar/attachments` in the folder the agent
 * starts from (the task's worktree, the folder that holds a task's several,
 * or the coordinator's), whose own `.gitignore` ignores everything in it, so
 * none is ever committed or pushed, and each goes with its folder.
 */

/** Where in a thread's folder the copies are kept. */
export const ATTACHMENTS = join('.althar', 'attachments')

/** What a file or folder on disk is, as a message may carry it; or why it can't. */
export type Measured =
  | { readonly ok: true; readonly kind: 'file' | 'folder'; readonly bytes: number; readonly entries: number | null }
  | { readonly ok: false; readonly why: 'too_large' | 'too_many_files' | 'unreadable' }

/** Measures what is at `path`, a link followed only there: a file's size, or a folder's files at every depth, until either is over. */
export const measure = (path: string): Measured => {
  let top
  try {
    top = statSync(path)
  } catch {
    return { ok: false, why: 'unreadable' }
  }
  if (top.isFile())
    return top.size > MESSAGE_FILES.bytes ? { ok: false, why: 'too_large' } : { ok: true, kind: 'file', bytes: top.size, entries: null }
  if (!top.isDirectory()) return { ok: false, why: 'unreadable' }
  let bytes = 0
  let entries = 0
  const folders = [path]
  while (folders.length > 0) {
    const folder = folders.pop() ?? path
    let names: ReadonlyArray<string>
    try {
      names = readdirSync(folder)
    } catch {
      return { ok: false, why: 'unreadable' }
    }
    for (const name of names) {
      const inside = join(folder, name)
      const found = lstatSync(inside, { throwIfNoEntry: false })
      // A link, a socket or a device isn't copied, nor counted.
      if (found === undefined || found.isSymbolicLink()) continue
      if (found.isDirectory()) folders.push(inside)
      else if (found.isFile()) {
        entries += 1
        bytes += found.size
        if (entries > MESSAGE_FILES.entries) return { ok: false, why: 'too_many_files' }
        if (bytes > MESSAGE_FILES.bytes) return { ok: false, why: 'too_large' }
      }
    }
  }
  return { ok: true, kind: 'folder', bytes, entries }
}

/** The folder its copies are kept in, in a thread's folder: made where it isn't, with the `.gitignore` that keeps them out of git. */
export const attachmentsIn = (root: string) => {
  const folder = join(root, ATTACHMENTS)
  mkdirSync(folder, { recursive: true })
  const ignore = join(folder, '.gitignore')
  if (!existsSync(ignore)) writeFileSync(ignore, '*\n')
  return folder
}

// eslint-disable-next-line no-control-regex -- a name's control characters are what is taken out
const UNSAFE = /[\u0000-\u001f<>:"|?*]/g

/**
 * A name a copy can have: the file's own, but for what a path or the system
 * can't hold (separators, control characters, a name of dots), cut to 200
 * characters with its extension kept.
 */
export const copyName = (name: string) => {
  const plain = basename(name.replaceAll('\\', '/')).replace(UNSAFE, '_').trim()
  const named = plain.replace(/^\.+$/, '') === '' ? 'file' : plain
  if (named.length <= 200) return named
  const extension = extname(named).slice(0, 20)
  return `${named.slice(0, 200 - extension.length)}${extension}`
}

/** Copies a file or a folder to `target`, which isn't there yet: a folder's links, sockets and devices are left out. */
export const copyTo = (source: string, target: string) =>
  cp(source, target, {
    recursive: true,
    dereference: false,
    errorOnExist: true,
    force: false,
    // What is dropped is followed if it is a link; inside a folder, a link isn't.
    filter: (from) => {
      if (from === source) return true
      const found = lstatSync(from, { throwIfNoEntry: false })
      return found !== undefined && (found.isFile() || found.isDirectory())
    },
  })

/** What a file's name says it is, for the few kinds an agent reads differently; null where it says nothing Althar knows. */
export const mediaTypeOf = (name: string): string | null => MEDIA_TYPES[extname(name).toLowerCase()] ?? null

const MEDIA_TYPES: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.json': 'application/json',
  '.jsonl': 'application/jsonl',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.toml': 'application/toml',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.ts': 'text/x-typescript',
  '.tsx': 'text/x-typescript',
  '.py': 'text/x-python',
  '.sh': 'text/x-shellscript',
  '.sql': 'application/sql',
  '.diff': 'text/x-diff',
  '.patch': 'text/x-diff',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

const strict = new TextDecoder('utf-8', { fatal: true })

/**
 * A small file's words, where it is text: at most `MESSAGE_FILES.embedded`
 * bytes, UTF-8 throughout, with no NUL in it. Null for anything else, or one
 * that can't be read: it goes as a link alone.
 */
export const wordsOf = (path: string, bytes: number): string | null => {
  if (bytes > MESSAGE_FILES.embedded) return null
  let handle: number | undefined
  try {
    handle = openSync(path, 'r')
    const buffer = Buffer.alloc(bytes + 1)
    const read = readSync(handle, buffer, 0, buffer.length, 0)
    if (read > MESSAGE_FILES.embedded) return null
    const content = buffer.subarray(0, read)
    if (content.includes(0)) return null
    return strict.decode(content)
  } catch {
    return null
  } finally {
    if (handle !== undefined) closeSync(handle)
  }
}
