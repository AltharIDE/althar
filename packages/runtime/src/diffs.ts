import { open } from 'node:fs/promises'
import { join } from 'node:path'

import { Effect } from 'effect'

import { NotFound } from './errors'
import { git, gitExactly } from './git'

/*
 * What a task changed, from its base to its worktree as it stands, read from
 * git when it is asked for and never kept: the record holds no file contents
 * (docs/architecture/07). The list says, for each file, how it changed, how
 * much, and whether some of that isn't committed yet, so isn't in what
 * Charrette pushes. A file's diff is its lines in hunks, with the stretch of a
 * changed line that differs marked; only a file on the list can be asked for.
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

/** How many lines a file's diff shows before it is cut short, and how much of a new file is read. */
const LINES_SHOWN = 4_000
const READ_AT_MOST = 2 * 1024 * 1024

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

/** A new file nobody has added yet: its lines, all added, or that it is binary. */
const untrackedText = (worktree: string, path: string) =>
  Effect.promise(async () => {
    const handle = await open(join(worktree, path), 'r')
    try {
      const buffer = Buffer.alloc(READ_AT_MOST)
      const { bytesRead } = await handle.read(buffer, 0, READ_AT_MOST, 0)
      const bytes = buffer.subarray(0, bytesRead)
      return looksBinary(bytes) ? null : bytes.toString('utf8')
    } finally {
      await handle.close()
    }
  })

const linesIn = (text: string) => (text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0))

/** The files a task changed since `base`, committed or not, in path order. */
export const changedFiles = (worktree: string, base: string): Effect.Effect<ReadonlyArray<ChangedFile>, unknown> =>
  Effect.gen(function* () {
    const statuses = reader(yield* git(worktree, 'diff', '--name-status', '-z', '-M', base))
    const counts = reader(yield* git(worktree, 'diff', '--numstat', '-z', '-M', base))
    const dirty = new Set(split(yield* git(worktree, 'diff', '--name-only', '-z', 'HEAD')))
    const untracked = split(yield* git(worktree, 'ls-files', '--others', '--exclude-standard', '-z'))

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
    for (const path of untracked) {
      const text = yield* untrackedText(worktree, path).pipe(Effect.orElseSucceed(() => null))
      files.push({
        path,
        from: null,
        status: 'added',
        add: text === null ? 0 : linesIn(text),
        del: 0,
        binary: text === null,
        uncommitted: true,
      })
    }
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
    const file = (yield* changedFiles(worktree, base)).find((candidate) => candidate.path === path)
    if (file === undefined) return yield* new NotFound({ kind: 'changed file', id: path })
    if (file.binary) return { file, lines: [], truncated: false }
    const untracked = (yield* git(worktree, 'ls-files', '--others', '--exclude-standard', '-z', '--', path)) !== ''
    if (untracked) {
      // Not added to git yet, so git has no diff for it: all of it is new.
      // A binary file was answered above, so this one reads as text.
      const content = (yield* untrackedText(worktree, path)) as string
      const all = content.endsWith('\n') ? content.slice(0, -1).split('\n') : content.split('\n')
      return { file, ...parseDiff(`@@ -0,0 +1,${all.length} @@\n${all.map((line) => `+${line}`).join('\n')}`) }
    }
    const text = yield* gitExactly(
      worktree,
      'diff',
      '--no-color',
      '--no-ext-diff',
      '--no-textconv',
      '-U3',
      '-M',
      base,
      '--',
      ...(file.from === null ? [path] : [file.from, path]),
    )
    return { file, ...parseDiff(text) }
  })
