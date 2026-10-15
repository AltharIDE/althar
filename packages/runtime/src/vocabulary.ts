import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'

import { Effect } from 'effect'

import { git } from './git'

/*
 * A project's own words, for dictation (ADR-017): the names its code uses
 * that a speech model would write as ordinary words, such as `RefundLedger`,
 * `useEffect`, `idempotency_key` or `charges-api.ts`, so the window can write
 * them as the project does. Read from git when asked, never kept: the files a
 * repository tracks, and the names in those it changed most recently. Only
 * names with parts count (two words or more, by their case, `_` or `-`);
 * a single word the model writes well enough.
 */

/** How many of the most recently changed files are read for their names, how much of each, and how many words are said at most. */
const FILES_READ = 300
const READ_AT_MOST = 256 * 1024
const WORDS_AT_MOST = 3_000

/** Files whose text holds names worth reading: source, not data or lockfiles. */
const SOURCE = new Set(
  [
    'ts',
    'tsx',
    'mts',
    'cts',
    'js',
    'jsx',
    'mjs',
    'cjs',
    'py',
    'go',
    'rs',
    'rb',
    'java',
    'kt',
    'swift',
    'cs',
    'c',
    'h',
    'cc',
    'cpp',
    'hpp',
    'php',
    'scala',
    'ex',
    'exs',
    'vue',
    'svelte',
    'dart',
    'lua',
    'sql',
    'sh',
  ].map((ext) => `.${ext}`),
)

/*
 * Names with parts, in code: camelCase, PascalCase with two humps or more,
 * snake_case and SCREAMING_SNAKE. Not kebab-case, which in code is as often a
 * subtraction.
 */
const NAMES = /\b(?:[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+|[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+|[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+)\b/g

/** A file or folder name with parts: those, and kebab-case too. */
const hasParts = (name: string) => /[a-z][A-Z]|[A-Za-z0-9][_-][A-Za-z0-9]/.test(name)

const nul = (output: string) => output.split('\0').filter((part) => part !== '')

/** The start of a file's text, without following a link; nothing for a binary or what isn't a file. */
const textOf = (path: string): Effect.Effect<string> =>
  Effect.promise(async () => {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const buffer = Buffer.alloc(READ_AT_MOST)
      const { bytesRead } = await handle.read(buffer, 0, READ_AT_MOST, 0)
      const bytes = buffer.subarray(0, bytesRead)
      return bytes.subarray(0, 8_000).includes(0) ? '' : bytes.toString('utf8')
    } finally {
      await handle.close()
    }
  }).pipe(Effect.catchDefect(() => Effect.succeed('')))

/** One repository's words, counted: its file names with parts, and the names in its most recently changed source files. */
const repositoryWords = (root: string, within: string | null): Effect.Effect<Map<string, number>> =>
  Effect.gen(function* () {
    const scope = within === null ? [] : ['--', within]
    const tracked = nul(yield* git(root, '-c', 'core.quotePath=false', 'ls-files', '-z', ...scope))
    const recent = (yield* git(
      root,
      '-c',
      'core.quotePath=false',
      'log',
      '--name-only',
      '--format=',
      '--no-renames',
      '-n',
      '300',
      ...scope,
    )).split('\n')
    const known = new Set(tracked)
    // The most recently changed first, then the rest as git lists them.
    const read = [...new Set([...recent, ...tracked])].filter((path) => known.has(path) && SOURCE.has(extname(path))).slice(0, FILES_READ)
    const counts = new Map<string, number>()
    const count = (word: string, by = 1) => counts.set(word, (counts.get(word) ?? 0) + by)
    for (const path of tracked) {
      const name = basename(path)
      // A file with parts, with and without what it ends in.
      if (hasParts(name.slice(0, name.length - extname(name).length) || name)) {
        count(name, 2)
        count(name.slice(0, name.length - extname(name).length), 2)
      }
    }
    const texts = yield* Effect.forEach(read, (path) => textOf(join(root, path)), { concurrency: 8 })
    for (const text of texts) for (const [name] of text.matchAll(NAMES)) count(name)
    return counts
  }).pipe(Effect.catch(() => Effect.succeed(new Map<string, number>())))

/**
 * The project's words: its name and its repositories' names where they have
 * parts, then the names its code uses most, at most a few thousand.
 */
export const vocabulary = (
  project: string,
  repositories: ReadonlyArray<{ readonly name: string; readonly path: string; readonly within: string | null }>,
): Effect.Effect<ReadonlyArray<string>> =>
  Effect.gen(function* () {
    const counts = new Map<string, number>()
    for (const one of yield* Effect.forEach(repositories, (repository) => repositoryWords(repository.path, repository.within), {
      concurrency: 2,
    }))
      for (const [word, n] of one) counts.set(word, (counts.get(word) ?? 0) + n)
    const named = [project, ...repositories.map((repository) => repository.name)].filter(hasParts)
    const used = [...counts]
      .filter(([word]) => word.length > 3)
      .toSorted(([a, x], [b, y]) => y - x || a.localeCompare(b))
      .map(([word]) => word)
    return [...new Set([...named, ...used])].slice(0, WORDS_AT_MOST)
  })
