import { constants } from 'node:fs'
import { lstat, open, readlink } from 'node:fs/promises'
import { join } from 'node:path'

import { Effect } from 'effect'

import { NotFound } from './errors'
import { git, gitExactly } from './git'

/*
 * What a task changed, from its base to its worktree as it stands, read from
 * git when it is asked for and never kept: the record holds no file contents
 * (docs/architecture/07). The list says, for each file, how it changed, how
 * much, and whether some of that isn't committed yet, so isn't in what
 * Althar pushes. A file's diff is its lines in hunks, with the stretch of a
 * changed line that differs marked; only a file on the list can be asked for.
 *
 * The base is where the task's branch meets its default branch, so what the
 * lead merged in from upstream isn't counted as the task's, as the pull
 * request wouldn't. A new file nobody has added yet is read as git would add
 * it: a link as its target, never what it points at, and anything that isn't
 * a file or a link not at all. Only the first few dozen are read to count
 * their lines, so an output folder `.gitignore` misses doesn't slow every
 * read of the task.
 */

/** A file a task changed: where it is, and was when it moved; how; how much; and whether it holds changes not committed yet. */
export interface ChangedFile {
  readonly path: string
  readonly from: string | null
  readonly status: 'added' | 'modified' | 'deleted' | 'renamed'
  readonly add: number
  readonly del: number
  readonly binary: boolean
  readonly uncommitted: boolean
}

export type DiffLine =
  | { readonly kind: 'hunk'; readonly text: string }
  | { readonly kind: 'context'; readonly old: number; readonly new: number; readonly text: string }
  | { readonly kind: 'added'; readonly new: number; readonly text: string; readonly changed?: ReadonlyArray<string> }
  | { readonly kind: 'removed'; readonly old: number; readonly text: string; readonly changed?: ReadonlyArray<string> }

/** One file's diff: its lines, or that it is binary; cut short past a limit, and saying so. */
export interface FileDiff {
  readonly file: ChangedFile
  readonly lines: ReadonlyArray<DiffLine>
  readonly truncated: boolean
}

/**
 * How many lines a file's diff shows before it is cut short, how much of a
 * new file is read, and how many new files are read to count their lines.
 * A diff holds its whole file, the unchanged lines too, so the window can
 * fold them away and open them in place, up to WHOLE_LINES; a longer one is
 * read in hunks instead, so its changes are never lost behind its context.
 */
const LINES_SHOWN = 4_000
const WHOLE_LINES = 20_000
const READ_AT_MOST = 2 * 1024 * 1024
const NEW_FILES_COUNTED = 50

/** Whether bytes look like a binary file: git's own test, a NUL early on. */
const looksBinary = (bytes: Uint8Array) => bytes.subarray(0, 8_000).includes(0)

const split = (output: string) => output.split('\0').filter((part) => part !== '')

/** NUL-separated output, read a word at a time. */
const reader = (output: string) => {
  const parts = split(output)
  let at = 0
  return {
    more: () => at < parts.length,
    // `more` says there is one.
    next: () => parts[at++] as string,
  }
}

/** What a new file nobody has added yet holds, as git would add it: a file's text, or that it is binary; a link's target; or nothing git adds. */
type NewFile =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'binary' }
  | { readonly kind: 'link'; readonly target: string }
  | { readonly kind: 'other' }

/** Reads a new file as git would add it, without following a link, and without waiting on anything that isn't a file. */
const newFile = (worktree: string, path: string, read: boolean): Effect.Effect<NewFile> =>
  Effect.promise(async (): Promise<NewFile> => {
    const at = join(worktree, path)
    const stats = await lstat(at)
    if (stats.isSymbolicLink()) return { kind: 'link', target: await readlink(at) }
    if (!stats.isFile()) return { kind: 'other' }
    if (!read) return { kind: 'text', text: '' }
    // Not following a link, should the file become one between the look and the read.
    const handle = await open(at, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const buffer = Buffer.alloc(Math.min(READ_AT_MOST, stats.size))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      const bytes = buffer.subarray(0, bytesRead)
      return looksBinary(bytes) ? { kind: 'binary' } : { kind: 'text', text: bytes.toString('utf8') }
    } finally {
      await handle.close()
    }
  }).pipe(Effect.catchDefect(() => Effect.succeed({ kind: 'other' } as const)))

const linesIn = (text: string) => (text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0))

/**
 * Where a task's change starts: where its branch meets the default branch it
 * goes into, so upstream work the lead merged in isn't counted as the task's;
 * where its worktree started, when that can't be told, as offline.
 */
export const baseOf = (worktree: string, baseRef: string | null, started: string): Effect.Effect<string> =>
  baseRef === null ? Effect.succeed(started) : git(worktree, 'merge-base', baseRef, 'HEAD').pipe(Effect.orElseSucceed(() => started))

/** The files git tracks that a task changed since `base`, committed or not: without reading any of them. Its three diffs run at once. */
const trackedFiles = (worktree: string, base: string) =>
  Effect.gen(function* () {
    const [named, numbered, uncommitted] = yield* Effect.all(
      [
        git(worktree, 'diff', '--name-status', '-z', '-M', base),
        git(worktree, 'diff', '--numstat', '-z', '-M', base),
        git(worktree, 'diff', '--name-only', '-z', 'HEAD'),
      ],
      { concurrency: 'unbounded' },
    )
    const statuses = reader(named)
    const counts = reader(numbered)
    const dirty = new Set(split(uncommitted))

    // Sizes, by the path a file has now: `add del path`, or for a move `add del` then its old and new paths.
    const sizes = new Map<string, { readonly add: number; readonly del: number; readonly binary: boolean }>()
    while (counts.more()) {
      const [add, del, named] = counts.next().split('\t') as [string, string, string]
      let path = named
      if (path === '') {
        counts.next()
        path = counts.next()
      }
      sizes.set(path, { add: Number(add) || 0, del: Number(del) || 0, binary: add === '-' })
    }

    const files: Array<ChangedFile> = []
    while (statuses.more()) {
      const code = statuses.next()
      const from = code.startsWith('R') || code.startsWith('C') ? statuses.next() : null
      const path = statuses.next()
      // Both lists come from the same diff, so every file has its size.
      const size = sizes.get(path) as { readonly add: number; readonly del: number; readonly binary: boolean }
      files.push({
        path,
        from: code.startsWith('R') ? from : null,
        status:
          code.startsWith('A') || code.startsWith('C')
            ? 'added'
            : code.startsWith('D')
              ? 'deleted'
              : code.startsWith('R')
                ? 'renamed'
                : 'modified',
        ...size,
        uncommitted: dirty.has(path) || (from !== null && dirty.has(from)),
      })
    }
    return files
  })

/** The new files nobody has added yet, by path. */
const untrackedPaths = (worktree: string, path?: string) =>
  Effect.map(
    git(worktree, '--literal-pathspecs', 'ls-files', '--others', '--exclude-standard', '-z', ...(path === undefined ? [] : ['--', path])),
    split,
  )

/** A new file as the list shows it; nothing for what git wouldn't add. A link counts as its one line, its target. */
const newEntry = (path: string, content: NewFile): ChangedFile | null =>
  content.kind === 'other'
    ? null
    : {
        path,
        from: null,
        status: 'added',
        add: content.kind === 'text' ? linesIn(content.text) : content.kind === 'link' ? 1 : 0,
        del: 0,
        binary: content.kind === 'binary',
        uncommitted: true,
      }

/** How many new files are looked at at once. */
const NEW_FILES_AT_ONCE = 16

/** The files a task changed since `base`, committed or not, in path order. Git's lists are read at once, then the new files a few at a time. */
export const changedFiles = (worktree: string, base: string): Effect.Effect<ReadonlyArray<ChangedFile>, unknown> =>
  Effect.gen(function* () {
    const [tracked, untracked] = yield* Effect.all([trackedFiles(worktree, base), untrackedPaths(worktree)], { concurrency: 'unbounded' })
    const added = yield* Effect.forEach(
      untracked,
      // Past the first few dozen, a new file is listed without its lines counted.
      (path, index) => Effect.map(newFile(worktree, path, index < NEW_FILES_COUNTED), (content) => newEntry(path, content)),
      { concurrency: NEW_FILES_AT_ONCE },
    )
    const files = [...tracked, ...added.filter((entry) => entry !== null)]
    // Paths are unique, so two are never equal.
    return files.toSorted((a, b) => (a.path < b.path ? -1 : 1))
  })

/**
 * Marks what differs between a removed line and the added line that took
 * its place: the stretch between what they share at either end, when they
 * share enough for the mark to help.
 */
export const changedStretch = (removed: string, added: string): readonly [ReadonlyArray<string>, ReadonlyArray<string>] => {
  let start = 0
  while (start < removed.length && start < added.length && removed[start] === added[start]) start += 1
  let end = 0
  while (end < removed.length - start && end < added.length - start && removed[removed.length - 1 - end] === added[added.length - 1 - end])
    end += 1
  // Whole words: `100` to `250` marks both numbers, not the `10` and `25` before a shared `0`.
  const word = (char: string | undefined) => char !== undefined && /\w/.test(char)
  while (start > 0 && word(removed[start - 1]) && (word(removed[start]) || word(added[start]))) start -= 1
  while (end > 0 && word(removed[removed.length - end]) && (word(removed[removed.length - end - 1]) || word(added[added.length - end - 1])))
    end -= 1
  const kept = start + end
  // Lines that share little are simply different: marking nearly all of them helps nobody.
  if (kept < Math.max(removed.length, added.length) * 0.3) return [[], []]
  const was = removed.slice(start, removed.length - end)
  const now = added.slice(start, added.length - end)
  return [was.trim() === '' ? [] : [was], now.trim() === '' ? [] : [now]]
}

/** A unified diff's lines, in hunks with their line numbers; a run of removed lines and the added ones after it paired up and marked. */
export const parseDiff = (text: string, limit = LINES_SHOWN): { readonly lines: ReadonlyArray<DiffLine>; readonly truncated: boolean } => {
  const lines: Array<DiffLine> = []
  let old = 0
  let now = 0
  let inHunk = false
  let removed: Array<number> = []
  let added: Array<number> = []
  const pair = () => {
    for (let index = 0; index < Math.min(removed.length, added.length); index += 1) {
      const was = lines[removed[index] ?? -1]
      const is = lines[added[index] ?? -1]
      if (was?.kind !== 'removed' || is?.kind !== 'added') continue
      const [before, after] = changedStretch(was.text, is.text)
      if (before.length > 0) lines[removed[index] ?? -1] = { ...was, changed: before }
      if (after.length > 0) lines[added[index] ?? -1] = { ...is, changed: after }
    }
    removed = []
    added = []
  }
  for (const raw of text.split('\n')) {
    if (lines.length >= limit) {
      pair()
      return { lines, truncated: true }
    }
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw)
    if (hunk !== null) {
      pair()
      old = Number(hunk[1])
      now = Number(hunk[2])
      inHunk = true
      lines.push({ kind: 'hunk', text: raw })
      continue
    }
    // `\ No newline at end of file`, and the empty line after the last newline, are no lines of the file.
    if (!inHunk || raw.startsWith('\\') || raw === '') continue
    if (raw.startsWith('+')) {
      added.push(lines.length)
      lines.push({ kind: 'added', new: now, text: raw.slice(1) })
      now += 1
    } else if (raw.startsWith('-')) {
      if (added.length > 0) pair()
      removed.push(lines.length)
      lines.push({ kind: 'removed', old, text: raw.slice(1) })
      old += 1
    } else if (raw.startsWith(' ')) {
      pair()
      lines.push({ kind: 'context', old, new: now, text: raw.slice(1) })
      old += 1
      now += 1
    } else inHunk = false
  }
  pair()
  return { lines, truncated: false }
}

/** One file's diff, from the task's base to its worktree: only a file the task changed. */
export const fileDiff = (worktree: string, base: string, path: string): Effect.Effect<FileDiff, unknown> =>
  Effect.gen(function* () {
    // A path inside the worktree, never one that climbs out of it or starts at the root.
    if (path === '' || path.startsWith('/') || path.split('/').includes('..'))
      return yield* new NotFound({ kind: 'changed file', id: path })
    const known = (yield* trackedFiles(worktree, base)).find((candidate) => candidate.path === path)
    if (known === undefined) {
      // Not one git tracks: a new file nobody has added yet, read as git would add it, or nothing the task changed.
      const listed = (yield* untrackedPaths(worktree, path)).includes(path)
      const content = listed ? yield* newFile(worktree, path, true) : ({ kind: 'other' } as const)
      const file = newEntry(path, content)
      if (file === null) return yield* new NotFound({ kind: 'changed file', id: path })
      if (content.kind !== 'text' && content.kind !== 'link') return { file, lines: [], truncated: false }
      const text = content.kind === 'link' ? content.target : content.text
      const all = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n')
      return { file, ...parseDiff(`@@ -0,0 +1,${all.length} @@\n${all.map((line) => `+${line}`).join('\n')}`) }
    }
    if (known.binary) return { file: known, lines: [], truncated: false }
    const diff = (context: string) =>
      gitExactly(
        worktree,
        '--literal-pathspecs',
        'diff',
        '--no-color',
        '--no-ext-diff',
        '--no-textconv',
        context,
        '-M',
        base,
        '--',
        ...(known.from === null ? [path] : [known.from, path]),
      )
    // The whole file, unchanged lines and all: the window folds them, and opens them without asking again.
    const whole = yield* diff('-U1000000').pipe(
      Effect.map((text) => parseDiff(text, WHOLE_LINES)),
      Effect.orElseSucceed(() => null),
    )
    if (whole !== null && !whole.truncated) return { file: known, ...whole }
    // Too long to read whole: its hunks, as git gives them, so every change is there.
    return { file: known, ...parseDiff(yield* diff('-U3')) }
  })
