import { lstat, open, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import { Effect } from 'effect'

import { whileCopyHolds } from './coordinatorFolder'

/*
 * What a project's repositories tell the agents that work in them, for the
 * coordinator's brief. A lead's agent loads its repository's AGENTS.md or
 * CLAUDE.md from its worktree itself. The coordinator's loads no settings
 * file from a repository (`settingSources: []`), so that no hook or
 * permission of the repository's reaches it, and its instructions went with
 * them: it knew nothing of how the code is laid out or how its team works
 * until it grepped for it, every session. So Althar reads them from the
 * coordinator's copies and puts them in its brief.
 *
 * Only a regular file inside the copy is read, never a link, which could
 * point at anything on the computer. An import on a line of its own
 * (`@AGENTS.md`, as Claude Code reads one) is put in place once, from inside
 * the copy, and a file already read is named rather than said again.
 */

/** The files a repository's instructions for agents are in, in the order they are read. */
export const INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md']

/** How much of one file a brief carries, and of all of them: the rest is read from the copy, where the brief says it is. */
export const INSTRUCTIONS_EACH = 10_000
export const INSTRUCTIONS_ALL = 20_000

/** How much of a file is read at all: a brief carries less, and a file this large isn't instructions written for agents. */
const READ_AT_MOST = 64 * 1024

/** An import on a line of its own, as Claude Code reads one: `@AGENTS.md`, `@docs/agents.md`. */
const IMPORT = /^@(\S+)\s*$/

/** A path in the copy as its repository writes it, with forward slashes on every system. */
const named = (root: string, path: string) => relative(root, path).split(sep).join('/')

/** Whether a path is inside a folder, not the folder itself. */
const inside = (folder: string, path: string) => {
  const between = relative(folder, path)
  return between !== '' && !between.startsWith('..') && !isAbsolute(between)
}

/** A regular file inside the copy, as text, as far as READ_AT_MOST; none where there is no such file. */
const fileIn = (root: string, path: string) =>
  Effect.tryPromise(async () => {
    if (!inside(root, path)) return undefined
    const found = await lstat(path)
    if (!found.isFile()) return undefined
    // A folder on the way there may be a link: the file, as the filesystem finds it, is still in the copy.
    const real = await realpath(path)
    if (!inside(await realpath(root), real)) return undefined
    const file = await open(path, 'r')
    try {
      const buffer = Buffer.alloc(Math.min(found.size, READ_AT_MOST))
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
      return { real, text: buffer.subarray(0, bytesRead).toString('utf8') }
    } finally {
      await file.close()
    }
  }).pipe(Effect.orElseSucceed(() => undefined))

/** One instructions file, its imports put in place; none where it isn't there or says nothing it hasn't already. */
const instructionsAt = (root: string, path: string, seen: Set<string>) =>
  Effect.gen(function* () {
    const file = yield* fileIn(root, path)
    if (file === undefined || seen.has(file.real)) return undefined
    seen.add(file.real)
    let said = false
    const lines = yield* Effect.forEach(file.text.split('\n'), (line) =>
      Effect.gen(function* () {
        const imported = IMPORT.exec(line.trim())?.[1]
        if (imported === undefined) {
          if (line.trim() !== '') said = true
          return line
        }
        const at = resolve(dirname(path), imported)
        const read = yield* fileIn(root, at)
        if (read === undefined) return line
        if (seen.has(read.real)) return `(${named(root, at)}, above)`
        seen.add(read.real)
        said = true
        return read.text.trimEnd()
      }),
    )
    return said ? { name: named(root, path), text: lines.join('\n').trim() } : undefined
  })

const cut = (text: string, length: number, where: string) =>
  text.length <= length ? text : `${text.slice(0, length)}… (cut here: the rest is in ${where})`

/**
 * What each repository's instructions for agents say, read from the
 * coordinator's copy of it: its root's, and the project's folder's where the
 * project is one folder of the repository. Empty where none has any.
 */
export const repositoryInstructions = (
  repositories: ReadonlyArray<{ readonly name: string; readonly root: string; readonly within: string | null }>,
) =>
  Effect.gen(function* () {
    const read = yield* Effect.forEach(
      repositories,
      (repository) =>
        whileCopyHolds(
          repository.root,
          Effect.gen(function* () {
            const seen = new Set<string>()
            const folders = [repository.root, ...(repository.within === null ? [] : [join(repository.root, repository.within)])]
            const files = []
            for (const folder of folders)
              for (const name of INSTRUCTION_FILES) {
                const found = yield* instructionsAt(repository.root, join(folder, name), seen)
                if (found !== undefined) files.push({ ...found, path: join(repository.root, found.name) })
              }
            return { name: repository.name, files }
          }),
        ),
      { concurrency: 4 },
    )
    let room = INSTRUCTIONS_ALL
    const parts: Array<string> = []
    for (const repository of read)
      for (const file of repository.files) {
        if (room <= 0) {
          parts.push(`${repository.name}, ${file.name}: left out for room; it is at ${file.path}`)
          continue
        }
        const text = cut(file.text, Math.min(INSTRUCTIONS_EACH, room), file.path)
        room -= text.length
        parts.push(`${repository.name}, ${file.name} (${file.path}):\n${text}`)
      }
    return parts.join('\n\n')
  })

/** The repositories' instructions, as a brief holds them; none where no repository has any. */
export const instructionsSection = (instructions: string) =>
  instructions === ''
    ? []
    : [
        `What the project's repositories tell the agents that work in them, as their people wrote it: how the code is laid out, how the team works and what it calls things. Plan by it and brief leads by it; their agents read it too, from their worktrees. Where it says how to change code, that is for the leads: you still change none. Your role above, the project's notes and the person's word come first.\n\n${instructions}`,
      ]
