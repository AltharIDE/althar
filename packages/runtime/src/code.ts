import { readdirSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'

import type { CodeFile, CodeFound, CodeText } from '@althar/contracts'
import { Effect } from 'effect'

import { NotFound } from './errors'
import { git, gitExactly } from './git'
import { countLines, inside } from './handed'

/*
 * The code an agent names in what it says, for the window to show: a path,
 * a path and its lines, a file's name, a name in code. Read where the
 * thread's agent works: a task's from its worktrees as they are now, what
 * isn't committed and its scratch notes too; the coordinator's from each
 * repository's default branch, as this device last fetched it, and from the
 * commit it was at when the message was said, so that the lines a message
 * named are followed to where they are now. Only read; nothing is kept.
 */

export interface CodeRoot {
  readonly slug: string
  readonly name: string
  readonly branch: string
  /** A task's worktree, read as it is; or the repository's checkout here, read at `commit`. */
  readonly path: string
  readonly commit: string | null
  /** Where its task's change starts, to count what it changed; none on the default branch. */
  readonly base: string | null
  /** The folder inside the repository the project is about, where it is about one. */
  readonly within: string | null
  /** Folders the agent may name a file under, whole: its worktree, or its copy in the coordinator's folder. */
  readonly seen: ReadonlyArray<string>
  /** Where the person's editor opens it: the task's worktree, or their own checkout. */
  readonly editor: string
}

export interface CodeRoots {
  readonly kind: 'task' | 'default'
  readonly roots: ReadonlyArray<CodeRoot>
}

/** Past this, a file is shown by the lines around the one asked for; past LARGE, not at all. */
export const CODE_WHOLE = 1024 * 1024
const LARGE = 8 * 1024 * 1024
/** How many lines either side of the one asked for a file past CODE_WHOLE shows. */
export const CODE_AROUND = 400

/* ——— Names ——— */

export interface Name {
  readonly name: string
  readonly line?: number
  readonly end?: number
}

/**
 * A name as agents write one: a path or a name, then the lines it means
 * (`:12`, `:12-30`, `:12:4`, `#L12-L30`), maybe with a sentence's stop after
 * it. Null for what can't be a name, such as words with a space.
 */
export const parseName = (raw: string): Name | null => {
  let text = raw.trim().replace(/[.,;:]+$/, '')
  // A bracket closing the sentence, not a call's.
  if (text.endsWith(')') && !text.includes('(')) text = text.slice(0, -1)
  if (text === '' || /\s/.test(text) || /^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return null
  const at = /^(.+?)(?::(\d+)(?::\d+)?(?:[-–](\d+))?|#L(\d+)(?:-L?(\d+))?)$/.exec(text)
  if (at === null) return { name: text }
  const name = at[1] ?? text
  const line = Number(at[2] ?? at[4])
  if (line < 1) return { name }
  const end = Number(at[3] ?? at[5] ?? 0)
  return { name, line, ...(end > line ? { end } : {}) }
}

/** A path, or a file's name: with a folder in it, or a kind after a dot. */
export const looksLikePath = (name: string) => name.includes('/') || /(^|[^.])\.[A-Za-z0-9]{1,10}$/.test(name)

const NOT_NAMES = new Set(
  'true false null undefined void never string number boolean object const let var function return import export async await this new type interface enum class'.split(
    ' ',
  ),
)

/** A name in code, as one reads: camelCase, PascalCase of more than a word, snake_case or CONSTANT_CASE, or called(). */
export const looksLikeSymbol = (name: string) => {
  const bare = name.replace(/\(\)$/, '')
  if (!/^[A-Za-z_$][\w$]*$/.test(bare) || bare.length < 4 || NOT_NAMES.has(bare)) return false
  return name.endsWith('()') || /[a-z][A-Z]/.test(bare) || /[A-Za-z0-9]_[A-Za-z]/.test(bare)
}

/** What a declaration of one of `names` starts with, in the languages agents name code in. */
const DECLARING = 'function[*]?|const|let|var|class|interface|type|enum|def|fn|func|struct|trait|protocol|record|object|module|namespace'

/** A test, a story or a fixture: where a name is declared again for its own sake, not where it is defined. */
const ASIDE = /(^|\/)(tests?|__tests__|e2e|fixtures|stories|testing)\/|\.(test|spec|stories)\.[cm]?[jt]sx?$/

/** Where a line of a file was when a message was said is now, through the diff between then and now (`-U0`): null where it was rewritten since. */
export const followLine = (diff: string, line: number): number | null => {
  let offset = 0
  for (const hunk of diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    const from = Number(hunk[1])
    const removed = hunk[2] === undefined ? 1 : Number(hunk[2])
    const added = hunk[4] === undefined ? 1 : Number(hunk[4])
    if (removed === 0) {
      // Lines put in after `from`.
      if (line <= from) break
    } else {
      if (line < from) break
      if (line < from + removed) return null
    }
    offset += added - removed
  }
  return line + offset
}

const stemOf = (path: string) =>
  basename(path)
    .replace(/\.[^.]+$/, '')
    .replace(/^\d+[-_]?/, '')
    .toLowerCase()

/** Files of nearly a path's name, for one that isn't there: the same name elsewhere, the same words after a number, or a name it starts. */
export const nearNames = (files: ReadonlyArray<string>, path: string): ReadonlyArray<string> => {
  const name = basename(path)
  const same = files.filter((file) => basename(file) === name)
  if (same.length > 0) return same.slice(0, 4)
  const stem = stemOf(path)
  if (stem.length < 3) return []
  const stemmed = files.filter((file) => stemOf(file) === stem)
  return (stemmed.length > 0 ? stemmed : files.filter((file) => stemOf(file).startsWith(stem))).slice(0, 4)
}

/** The folders a message names, which a file's name alone is looked for in first. */
const hintsOf = (names: ReadonlyArray<Name>) =>
  names.flatMap(({ name }) => (name.includes('/') ? [name.replace(/\/[^/]*\.[^/]*$/, '').replace(/^\.\/|\/$/g, '')] : []))

const split = (listed: string) => listed.split('\0').filter((entry) => entry !== '')

/* ——— Reading ——— */

type Read =
  | { readonly kind: 'text'; readonly text: string; readonly bytes: number }
  | { readonly kind: 'binary' | 'large'; readonly bytes: number }
  | null

const looksBinary = (text: string) => text.slice(0, 8000).includes('\0')

/** A file of a root: from the worktree as it is, never by a link out of it; or as git has it at `commit`. Null where it isn't a file there. */
const readIn = (root: CodeRoot, path: string, commit: string | null = root.commit): Effect.Effect<Read> =>
  commit === null
    ? Effect.gen(function* () {
        const real = yield* inside(join(root.path, path), [root.path])
        if (real === null) return null
        const found = yield* Effect.promise(() => stat(real).catch(() => null))
        if (found === null || !found.isFile()) return null
        if (found.size > LARGE) return { kind: 'large', bytes: found.size }
        const text = yield* Effect.promise(() => readFile(real, 'utf8').catch(() => null))
        if (text === null) return null
        return looksBinary(text) ? { kind: 'binary', bytes: found.size } : { kind: 'text', text, bytes: found.size }
      })
    : Effect.gen(function* () {
        const object = `${commit}:${path}`
        const kind = yield* git(root.path, 'cat-file', '-t', object).pipe(Effect.orElseSucceed(() => ''))
        if (kind !== 'blob') return null
        const bytes = Number(yield* git(root.path, 'cat-file', '-s', object))
        if (bytes > LARGE) return { kind: 'large', bytes } as const
        const text = yield* gitExactly(root.path, 'cat-file', 'blob', object)
        return looksBinary(text) ? ({ kind: 'binary', bytes } as const) : ({ kind: 'text', text, bytes } as const)
      }).pipe(Effect.orElseSucceed(() => null))

/** What git ignores in a task's scratch folder (`.althar/scratch`), where a lead keeps its notes: a few levels, a few thousand files at most. */
const scratchOf = (worktree: string): ReadonlyArray<string> => {
  const found: string[] = []
  const walk = (folder: string, depth: number) => {
    if (depth > 6 || found.length >= 2000) return
    let entries
    try {
      entries = readdirSync(join(worktree, folder), { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.isSymbolicLink()) continue
      const path = `${folder}/${entry.name}`
      if (entry.isDirectory()) walk(path, depth + 1)
      else if (entry.isFile()) found.push(path)
    }
  }
  walk('.althar/scratch', 0)
  return found
}

interface Listed {
  /** Every file, by its path from the root. */
  readonly files: ReadonlyArray<string>
  /** Those git doesn't track yet, which a task added. */
  readonly added: ReadonlySet<string>
}

/** A root's files: what git tracks and what a task added, and its scratch notes; or the tree at the default branch's commit. */
const listedIn = (root: CodeRoot): Effect.Effect<Listed> =>
  root.commit === null
    ? Effect.gen(function* () {
        const [tracked, added] = yield* Effect.all(
          [
            git(root.path, 'ls-files', '-z', '--cached').pipe(Effect.orElseSucceed(() => '')),
            git(root.path, 'ls-files', '-z', '--others', '--exclude-standard').pipe(Effect.orElseSucceed(() => '')),
          ],
          { concurrency: 'unbounded' },
        )
        const others = split(added)
        return { files: [...new Set([...split(tracked), ...others, ...scratchOf(root.path)])], added: new Set(others) }
      })
    : Effect.map(git(root.path, 'ls-tree', '-r', '-z', '--name-only', root.commit).pipe(Effect.orElseSucceed(() => '')), (listed) => ({
        files: split(listed),
        added: new Set<string>(),
      }))

/** What a task changed in each file git tracks, against where its change starts: lines added and removed, by path. */
const changesIn = (root: CodeRoot): Effect.Effect<ReadonlyMap<string, { readonly add: number; readonly del: number }>> =>
  root.base === null
    ? Effect.succeed(new Map())
    : Effect.map(git(root.path, 'diff', '--numstat', '-z', '--no-renames', root.base).pipe(Effect.orElseSucceed(() => '')), (listed) => {
        const changes = new Map<string, { readonly add: number; readonly del: number }>()
        for (const entry of split(listed)) {
          const [add = '', del = '', ...path] = entry.split('\t')
          changes.set(path.join('\t'), { add: Number(add) || 0, del: Number(del) || 0 })
        }
        return changes
      })

/** Where each of `names` is declared in a root, the first line of each file that declares it: by name. */
const declaredIn = (root: CodeRoot, names: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const found = new Map<string, Array<{ readonly path: string; readonly line: number }>>()
    if (names.length === 0) return found
    const alternatives = names.map((name) => name.replaceAll('$', '[$]')).join('|')
    const pattern = `(^|[^[:alnum:]_$])(${DECLARING})[[:space:]]+(${alternatives})([^[:alnum:]_$]|$)`
    // In a worktree, the files a task added too, which git doesn't track yet. Every declaring line of a file, as a cap would
    // count all the names together and lose those declared below it; of each, only the words that declare, however long the line.
    const where = root.commit === null ? ['--untracked'] : [root.commit]
    const output = yield* git(root.path, 'grep', '-z', '-n', '-o', '-I', '-E', '-e', pattern, ...where).pipe(
      // No line matches: git says so by failing.
      Effect.orElseSucceed(() => ''),
    )
    const declares = new RegExp(
      `(?:^|[^\\w$])(?:${DECLARING.replace('[*]', '\\*')})\\s+(${names.map((name) => name.replaceAll('$', '\\$')).join('|')})(?![\\w$])`,
    )
    for (const row of output.split('\n')) {
      const [named = '', line = '', text = ''] = row.split('\0')
      const path = root.commit === null ? named : named.slice(root.commit.length + 1)
      const name = declares.exec(text)?.[1]
      if (name === undefined || path === '') continue
      const places = found.get(name) ?? []
      if (!places.some((place) => place.path === path)) places.push({ path, line: Number(line) })
      found.set(name, places)
    }
    return found
  })

/* ——— Finding ——— */

export interface Asked {
  /** When the message was said, where it is one that was; null for what is said now. */
  readonly at: string | null
  readonly names: ReadonlyArray<string>
}

/**
 * What each message's names name in a place: for each message, in the order
 * asked, each name that names a file, a path that isn't there, or a name
 * several files have. A name that names none of these isn't code, and isn't
 * answered. Each root's files are listed once for all the messages.
 */
export const findCode = (place: CodeRoots, messages: ReadonlyArray<Asked>): Effect.Effect<ReadonlyArray<ReadonlyArray<CodeFound>>> =>
  Effect.gen(function* () {
    // Asked only where the place is, nothing is listed.
    if (messages.length === 0) return []
    const several = place.roots.length > 1
    const prefixOf = (root: CodeRoot) => (several ? `${root.slug}/` : '')
    const listed = yield* Effect.forEach(place.roots, listedIn, { concurrency: 'unbounded' })
    const changes = yield* Effect.forEach(place.roots, changesIn, { concurrency: 'unbounded' })
    const all = place.roots.flatMap((root, at) => (listed[at]?.files ?? []).map((file) => `${prefixOf(root)}${file}`))
    const known = new Set(all)
    const parsed = messages.map((message) => message.names.map(parseName).filter((name) => name !== null))

    // Every message's names in code, looked for at once in each root.
    const symbols = [
      ...new Set(parsed.flat().flatMap(({ name }) => (!looksLikePath(name) && looksLikeSymbol(name) ? [name.replace(/\(\)$/, '')] : []))),
    ]
    const declared = yield* Effect.forEach(place.roots, (root) => declaredIn(root, symbols), { concurrency: 'unbounded' })

    /** A root and its path inside it, for a path as the place names it. */
    const rootOf = (path: string) => {
      const index = several ? place.roots.findIndex((root) => path.startsWith(`${root.slug}/`)) : 0
      const root = place.roots[index]
      return root === undefined ? null : { root, index, path: path.slice(prefixOf(root).length) }
    }

    // A message's lines are followed from the commit each root was at when it was said; one look per root and time.
    const thens = new Map<string, string | null>()
    const thenOf = (root: CodeRoot, at: string) =>
      Effect.gen(function* () {
        const key = `${root.slug}\0${at}`
        const kept = thens.get(key)
        if (kept !== undefined) return kept
        const then =
          root.commit === null
            ? null
            : (yield* git(root.path, 'rev-list', '-1', '--first-parent', `--before=${at}`, root.commit).pipe(
                Effect.orElseSucceed(() => ''),
              )) || null
        thens.set(key, then === root.commit ? null : then)
        return then === root.commit ? null : then
      })

    const sinceOf = (root: CodeRoot, path: string, at: string | null, named: Name) =>
      Effect.gen(function* () {
        if (at === null || root.commit === null) return null
        const then = yield* thenOf(root, at)
        if (then === null) return null
        const was = yield* git(root.path, 'cat-file', '-e', `${then}:${path}`).pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false),
        )
        if (!was) return null
        const diff = yield* gitExactly(root.path, 'diff', '-U0', '--no-color', '--no-ext-diff', then, root.commit, '--', path).pipe(
          Effect.orElseSucceed(() => ''),
        )
        if (diff.trim() === '') return null
        if (named.line === undefined) return { commit: then, said: at }
        const line = followLine(diff, named.line)
        const end = named.end === undefined ? undefined : followLine(diff, named.end)
        return { commit: then, said: at, now: line === null || end === null ? null : { line, ...(end === undefined ? {} : { end }) } }
      })

    const fileAt = (
      path: string,
      raw: string,
      named: Name,
      at: string | null,
      more: { readonly symbol?: string; readonly byName: boolean },
    ) =>
      Effect.gen(function* () {
        const found = rootOf(path)
        if (found === null) return null
        const { root, index, path: inRoot } = found
        const read = yield* readIn(root, inRoot)
        if (read === null) return { kind: 'missing', name: raw, path, near: [] } as const
        const lines = read.kind === 'text' ? countLines(read.text) : 0
        const changed =
          root.base === null || inRoot.startsWith('.althar/scratch/')
            ? null
            : (changes[index]?.get(inRoot) ?? (listed[index]?.added.has(inRoot) === true ? { add: lines, del: 0 } : null))
        return {
          kind: 'file',
          name: raw,
          path,
          ...(named.line === undefined ? {} : { line: named.line }),
          ...(named.end === undefined ? {} : { end: named.end }),
          ...(more.symbol === undefined ? {} : { symbol: more.symbol }),
          byName: more.byName,
          bytes: read.bytes,
          lines,
          content: read.kind,
          changed,
          since: read.kind === 'text' ? yield* sinceOf(root, inRoot, at, named) : null,
        } satisfies CodeFile
      })

    /** Paths as the place names them that a path an agent wrote may be: as written, under each repository, and under the folder a project is about. */
    const candidatesOf = (path: string) => {
      if (isAbsolute(path)) {
        for (const root of place.roots)
          for (const folder of [root.path, ...root.seen])
            if (path.startsWith(`${folder}/`)) return [`${prefixOf(root)}${path.slice(folder.length + 1)}`]
        return []
      }
      return [
        ...new Set([
          path,
          ...place.roots.flatMap((root) => [
            `${prefixOf(root)}${path}`,
            ...(root.within === null ? [] : [`${prefixOf(root)}${root.within}/${path}`]),
          ]),
        ]),
      ]
    }

    /** Whether a task's worktree has a file at a path that git doesn't list, such as one it ignores. */
    const onDisk = (path: string) =>
      Effect.gen(function* () {
        const found = rootOf(path)
        if (found === null || found.root.commit !== null) return false
        return (yield* readIn(found.root, found.path)) !== null
      })

    const one = (raw: string, named: Name, at: string | null, hints: ReadonlyArray<string>): Effect.Effect<CodeFound | null> =>
      Effect.gen(function* () {
        const name = named.name.replace(/^\.\//, '')
        const lines = { ...(named.line === undefined ? {} : { line: named.line }), ...(named.end === undefined ? {} : { end: named.end }) }
        if (!looksLikePath(name)) {
          if (!looksLikeSymbol(name)) return null
          const bare = name.replace(/\(\)$/, '')
          const places = place.roots.flatMap((root, index) =>
            (declared[index]?.get(bare) ?? []).map((where) => ({ ...where, path: `${prefixOf(root)}${where.path}` })),
          )
          const kept = places.filter((where) => !ASIDE.test(where.path))
          const chosen = kept.length > 0 ? kept : places
          const hinted = chosen.filter((where) =>
            hints.some((hint) => where.path.startsWith(`${hint}/`) || where.path.includes(`/${hint}/`)),
          )
          const where = chosen.length === 1 ? chosen[0] : hinted.length === 1 ? hinted[0] : undefined
          if (where === undefined) return null
          return yield* fileAt(where.path, raw, { name: where.path, line: where.line }, null, { symbol: bare, byName: false })
        }

        const candidates = candidatesOf(name.replace(/\/$/, ''))
        if (candidates.length === 0) return null
        const exact = candidates.filter((candidate) => known.has(candidate))
        if (exact.length === 1) return yield* fileAt(exact[0] ?? '', raw, named, at, { byName: false })
        if (exact.length > 1) return { kind: 'several', name: raw, ...lines, paths: exact.slice(0, 8) }
        // In a task's worktree, what is there by that path, git's or not: what a build wrote, what git ignores.
        for (const candidate of candidates) if (yield* onDisk(candidate)) return yield* fileAt(candidate, raw, named, at, { byName: false })
        if (isAbsolute(name)) return { kind: 'missing', name: raw, path: candidates[0] ?? name, near: nearNames(all, name) }

        // Part of a path, or a file's name alone: the files whose path ends with it.
        const tail = name.replace(/\/$/, '')
        const ending = all.filter((file) => file.endsWith(`/${tail}`))
        const kept = ending.filter((file) => !ASIDE.test(file))
        const chosen = kept.length > 0 ? kept : ending
        const hinted = chosen.filter((file) => hints.some((hint) => file.startsWith(`${hint}/`) || file.includes(`/${hint}/`)))
        if (chosen.length === 1 || hinted.length === 1)
          return yield* fileAt((chosen.length === 1 ? chosen[0] : hinted[0]) ?? '', raw, named, at, { byName: !tail.includes('/') })
        if (chosen.length > 1) return { kind: 'several', name: raw, ...lines, paths: chosen.slice(0, 8) }
        // A folder isn't a file to show; a word with a slash in it, like and/or, isn't a path that went missing.
        const folder = all.some((file) => file.startsWith(`${tail}/`) || file.includes(`/${tail}/`))
        if (folder || !tail.includes('/') || !(/\.[A-Za-z0-9]{1,10}$/.test(tail) || tail.split('/').length > 2)) return null
        return { kind: 'missing', name: raw, path: tail, near: nearNames(all, tail) }
      })

    return yield* Effect.forEach(
      messages,
      (message, at) =>
        Effect.gen(function* () {
          const names = parsed[at] ?? []
          const hints = hintsOf(names)
          const found = yield* Effect.forEach(
            message.names.flatMap((raw) => {
              const named = parseName(raw)
              return named === null ? [] : [{ raw, named }]
            }),
            ({ raw, named }) => one(raw, named, message.at, hints),
            { concurrency: 8 },
          )
          return found.filter((one) => one !== null)
        }),
      { concurrency: 4 },
    )
  })

/* ——— Reading one ——— */

/** A root and the path inside it, for a path as a place names it; null for one that climbs out, starts at the top, or names no repository. */
export const codeRootOf = (place: CodeRoots, path: string) => {
  if (path === '' || isAbsolute(path) || path.split('/').includes('..')) return null
  const several = place.roots.length > 1
  const root = several ? place.roots.find((one) => path.startsWith(`${one.slug}/`)) : place.roots[0]
  return root === undefined ? null : { root, path: several ? path.slice(root.slug.length + 1) : path }
}

/**
 * A file as FindCode named it, for the window to show: as it is now, or at
 * a commit of its default branch, when a message was said. Whole up to
 * CODE_WHOLE; past it, the lines around `line`. Only text.
 */
export const readCode = (place: CodeRoots, path: string, commit?: string, line?: number): Effect.Effect<CodeText, NotFound> =>
  Effect.gen(function* () {
    const found = codeRootOf(place, path)
    if (found === null) return yield* new NotFound({ kind: 'file', id: path })
    const { root } = found
    if (commit !== undefined) {
      // Only a commit the default branch has had: what it was when a message was said.
      const had =
        root.commit !== null &&
        /^[0-9a-f]{7,64}$/.test(commit) &&
        (yield* git(root.path, 'merge-base', '--is-ancestor', commit, root.commit).pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false),
        ))
      if (!had) return yield* new NotFound({ kind: 'file', id: path })
    }
    const read = yield* readIn(root, found.path, commit ?? root.commit)
    if (read === null || read.kind !== 'text') return yield* new NotFound({ kind: 'file', id: path })
    const total = countLines(read.text)
    if (read.bytes <= CODE_WHOLE) return { path, text: read.text, from: 1, total, cut: false }
    const from = Math.max(1, Math.min((line ?? 1) - CODE_AROUND, total - CODE_AROUND * 2 + 1))
    const text = read.text
      .split('\n')
      .slice(from - 1, from - 1 + CODE_AROUND * 2)
      .join('\n')
    return { path, text, from, total, cut: true }
  })
