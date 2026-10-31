import {
  closeSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { lstat, mkdir, open, readdir, rm, stat } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'

import { MESSAGE_FILES } from '@althar/contracts'

/*
 * The person's files and folders sent with a message, on disk (ADR-064):
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

/** How much one copy may hold: its bytes, and a folder's files. */
export type Budget = { readonly bytes: number; readonly entries: number }

// A link put where a file was, after the folder was listed, isn't followed (where the system can say so).
const READ = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
const PIECE = 1024 * 1024

/**
 * Copies a file or a folder to `target`, which isn't there yet, counting
 * what it copies against `budget`: what it was measured at before may have
 * grown since, so a file is copied a piece at a time, and the copy stops,
 * and goes, as soon as it is over. What is dropped is followed if it is a
 * link; a folder's links, sockets and devices are left out. What was
 * copied, as `measure` says it; or why not, with nothing left at `target`.
 * Throws where it can't be read or written.
 */
export const copyTo = async (dropped: string, target: string, budget: Budget = MESSAGE_FILES): Promise<Measured> => {
  const source = realpathSync(dropped)
  let bytes = 0
  let entries = 0
  // Only what this copy made is taken away: never something already at `target`.
  let made = false
  /** Copies one file, false as soon as it takes the copy over. */
  const copyFile = async (from: string, to: string) => {
    const input = await open(from, READ)
    try {
      const output = await open(to, 'wx', (await input.stat()).mode & 0o777)
      made = true
      try {
        const piece = Buffer.alloc(PIECE)
        for (;;) {
          const { bytesRead } = await input.read(piece, 0, PIECE, null)
          if (bytesRead === 0) return true
          bytes += bytesRead
          if (bytes > budget.bytes) return false
          await output.write(piece, 0, bytesRead)
        }
      } finally {
        await output.close()
      }
    } finally {
      await input.close()
    }
  }
  const copied = async (): Promise<Measured> => {
    const top = await stat(source)
    await mkdir(dirname(target), { recursive: true })
    if (top.isFile())
      return (await copyFile(source, target)) ? { ok: true, kind: 'file', bytes, entries: null } : { ok: false, why: 'too_large' }
    if (!top.isDirectory()) return { ok: false, why: 'unreadable' }
    await mkdir(target)
    made = true
    const folders: Array<readonly [string, string]> = [[source, target]]
    while (folders.length > 0) {
      const [from, to] = folders.pop() ?? [source, target]
      for (const entry of await readdir(from, { withFileTypes: true })) {
        const inside = join(from, entry.name)
        const copy = join(to, entry.name)
        if (entry.isDirectory()) {
          // Listed as a folder; one that is a link by now isn't walked.
          if ((await lstat(inside)).isSymbolicLink()) continue
          await mkdir(copy)
          folders.push([inside, copy])
        } else if (entry.isFile()) {
          entries += 1
          if (entries > budget.entries) return { ok: false, why: 'too_many_files' }
          if (!(await copyFile(inside, copy))) return { ok: false, why: 'too_large' }
        }
      }
    }
    return { ok: true, kind: 'folder', bytes, entries }
  }
  // What was copied for one refused goes as best it can, tried again over a moment as cleanUp is, and the refusal stands.
  // Not cleanUp itself: this is plain Node, shared with the app's main process, which takes no Effect.
  const gone = () =>
    made
      ? // oxlint-disable-next-line althar/one-removal
        rm(target, { recursive: true, force: true, maxRetries: 5 }).catch((error: unknown) =>
          console.warn(`Could not remove ${target}, what was copied of a file refused; it is left there`, error),
        )
      : Promise.resolve()
  try {
    const done = await copied()
    if (!done.ok) await gone()
    return done
  } catch (error) {
    await gone()
    throw error
  }
}

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
