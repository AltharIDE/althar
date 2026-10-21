import { readFile, stat } from 'node:fs/promises'
import { extname, isAbsolute, join, relative, sep } from 'node:path'

import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Artifacts } from './Artifacts'
import { DocumentRefused, NotFound } from './errors'
import { gitExactly } from './git'
import { countLines, inside } from './handed'

/*
 * What the window reads of what an agent handed back, past what an item
 * keeps: a command's output from the artifact store, and a markdown
 * document an agent wrote, from the task's worktree as it is now. Neither
 * is kept in a row; both are read when the person opens them.
 */

/** The largest document read for the window: a long one fits; past it, the editor is the place. */
export const DOCUMENT_READ = 1024 * 1024

const MARKDOWN = new Set(['.md', '.markdown', '.mdx'])

/** What a command in a thread printed, as kept when it ended. */
export const outputText = (threadId: string, itemId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ sha256: string | null; dropped: number | null }>`
      SELECT json_extract(content, '$.output.sha256') AS sha256, json_extract(content, '$.output.dropped') AS dropped
      FROM thread_items WHERE id = ${itemId} AND thread_id = ${threadId} AND kind = 'tool_call'`
    if (row === undefined || row.sha256 === null) return yield* new NotFound({ kind: 'output', id: itemId })
    const bytes = yield* (yield* Artifacts).read(row.sha256)
    if (bytes === null) return yield* new NotFound({ kind: 'output', id: itemId })
    return { text: new TextDecoder().decode(bytes), dropped: row.dropped ?? 0 }
  })

/**
 * A markdown document an agent wrote, from the task's worktrees as they are
 * now: by its whole path, or from the first worktree's root, as the window
 * names a file. One path is one file: a file that has gone is not found,
 * never another of the same name in another repository. Only a markdown
 * file inside the worktrees, links followed, and no larger than
 * DOCUMENT_READ.
 */
export const documentText = (path: string, worktrees: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    if (!MARKDOWN.has(extname(path).toLowerCase())) return yield* new DocumentRefused({ path, reason: 'not_markdown' })
    const [first] = worktrees
    const whole = isAbsolute(path) ? path : first === undefined ? null : join(first, path)
    const found = whole === null ? null : yield* Effect.promise(() => stat(whole).catch(() => null))
    if (whole === null || found === null) return yield* new NotFound({ kind: 'document', id: path })
    const real = yield* inside(whole, worktrees)
    if (real === null) return yield* new DocumentRefused({ path, reason: 'outside' })
    if (!found.isFile()) return yield* new NotFound({ kind: 'document', id: path })
    if (found.size > DOCUMENT_READ) return yield* new DocumentRefused({ path, reason: 'too_large' })
    const body = yield* Effect.promise(() => readFile(real, 'utf8'))
    return { path, body, bytes: found.size, lines: countLines(body) }
  })

/**
 * A markdown document an agent wrote, for a task whose folder was removed
 * (ADR-055): from `head`, the commit kept as its folder went, in its
 * repository at `root`, by its path in the worktree that was at `worktree`.
 * One it committed still reads; one it never committed went with the folder.
 */
export const documentKept = (path: string, kept: { readonly root: string; readonly head: string; readonly worktree: string }) =>
  Effect.gen(function* () {
    if (!MARKDOWN.has(extname(path).toLowerCase())) return yield* new DocumentRefused({ path, reason: 'not_markdown' })
    const within = isAbsolute(path) ? relative(kept.worktree, path) : path
    if (within === '' || isAbsolute(within) || within.split(sep).includes('..'))
      return yield* new DocumentRefused({ path, reason: 'outside' })
    const object = `${kept.head}:${within.split(sep).join('/')}`
    const bytes = yield* gitExactly(kept.root, 'cat-file', '-s', object).pipe(
      Effect.map((size) => Number(size.trim())),
      Effect.orElseSucceed(() => null),
    )
    if (bytes === null) return yield* new NotFound({ kind: 'document', id: path })
    if (bytes > DOCUMENT_READ) return yield* new DocumentRefused({ path, reason: 'too_large' })
    const body = yield* gitExactly(kept.root, 'cat-file', 'blob', object).pipe(
      Effect.mapError(() => new NotFound({ kind: 'document', id: path })),
    )
    return { path, body, bytes, lines: countLines(body) }
  })
