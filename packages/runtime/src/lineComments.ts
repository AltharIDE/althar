import { existsSync } from 'node:fs'
import { join } from 'node:path'

import type { LineComment, LineCommentNow, QuotedLine, SentLineComment } from '@althar/contracts'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { gitExactly, treeOf } from './git'
import { carriedLine, type Hunk, hunksOf } from './taskFindings'

/*
 * Comments the person makes on lines of a task's diff (DEV-175, ADR-105).
 * Sent with a message, each is kept on the person's message item with the
 * files of its worktree as they were then (a tree git keeps, `treeOf`), and
 * the lead reads it after the person's words: its file, its lines and the
 * code quoted, so it never has to guess which line is meant.
 *
 * Read back, each comment's first line is carried from that tree to the
 * worktree as it is now, so the Changes view shows it under the line it
 * means; and once a commit since changed its lines, the tree of the
 * branch's head differs there from the one it was made on, and it is
 * addressed. What isn't committed yet doesn't address it: only a commit
 * since it was made, one that changed its file, does.
 */

/**
 * A comment as the person's message keeps it: what was sent, the tree of its
 * worktree's files as they were then, and the commit its branch was on (each
 * null where it couldn't be read).
 */
export interface KeptLineComment extends LineComment {
  readonly tree: string | null
  readonly head?: string | null
}

/** A worktree of the task's, by its slug, as the Changes view names its files. */
export interface CommentedWorktree {
  readonly slug: string
  readonly path: string
}

const linesWord = (comment: Pick<LineComment, 'start' | 'end'>) =>
  comment.start === comment.end ? `line ${comment.start}` : `lines ${comment.start}–${comment.end}`

/** The language a fence is marked with, from the file's extension: plain where it has none a fence takes. */
const languageOf = (path: string) => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  const extension = dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
  return /^[a-z0-9+#-]{1,12}$/.test(extension) ? extension : ''
}

/** A fence longer than any run of backticks in what it holds, so the code can't close it. */
const fenceFor = (texts: ReadonlyArray<string>) => {
  const longest = Math.max(0, ...texts.flatMap((text) => [...text.matchAll(/`+/g)].map((run) => run[0].length)))
  return '`'.repeat(Math.max(3, longest + 1))
}

const SIGNS: Readonly<Record<QuotedLine['kind'], string>> = { context: ' ', added: '+', removed: '-' }

/**
 * The code a comment is on, fenced: as the file has it, in its language,
 * where every line is one the file has now; as a diff, each line signed,
 * where any was taken out.
 */
export const quoted = (comment: Pick<LineComment, 'path' | 'code'>): string => {
  const asDiff = comment.code.some((line) => line.kind === 'removed')
  const lines = comment.code.map((line) => (asDiff ? `${SIGNS[line.kind]} ${line.text}` : line.text))
  const fence = fenceFor(lines)
  return [`${fence}${asDiff ? 'diff' : languageOf(comment.path)}`, ...lines, fence].join('\n')
}

/** Where a comment is, as the lead reads it: its file, its lines, and for lines only taken out, that they were. */
export const placeSaid = (comment: Pick<LineComment, 'path' | 'side' | 'start' | 'end'>): string =>
  comment.side === 'old'
    ? `\`${comment.path}\`, ${linesWord(comment)} as the file was before the change (taken out by it)`
    : `\`${comment.path}\`, ${linesWord(comment)}`

/** What the lead reads of the comments: each in turn, where it is, the code it is on, and what the person said. */
export const lineCommentsSaid = (comments: ReadonlyArray<LineComment>): string => {
  const heading = comments.length === 1 ? 'A comment on the diff:' : `${comments.length} comments on the diff:`
  const each = comments.map((comment, index) =>
    [`Comment ${index + 1}, on ${placeSaid(comment)}:`, quoted(comment), ...(comment.note.trim() === '' ? [] : [comment.note.trim()])].join(
      '\n\n',
    ),
  )
  return [heading, ...each].join('\n\n')
}

/** The person's words, then their comments: what the agent reads of a message that has any. */
export const withLineComments = (body: string, comments: ReadonlyArray<LineComment>): string =>
  comments.length === 0 ? body : [body.trim(), lineCommentsSaid(comments)].filter((part) => part !== '').join('\n\n')

/** The worktree a path the Changes view names is in, and the path within it: under its slug, in a task of several. */
export const worktreeOf = <W extends CommentedWorktree>(
  worktrees: ReadonlyArray<W>,
  path: string,
): { readonly worktree: W; readonly inside: string } | null => {
  if (worktrees.length === 1) return worktrees[0] === undefined ? null : { worktree: worktrees[0], inside: path }
  const slash = path.indexOf('/')
  const worktree = slash > 0 ? worktrees.find((one) => one.slug === path.slice(0, slash)) : undefined
  return worktree === undefined ? null : { worktree, inside: path.slice(slash + 1) }
}

/** Each comment with the tree of its worktree's files as they are now: one tree a worktree, however many comments are in it. */
export const keepLineComments = (worktrees: ReadonlyArray<CommentedWorktree>, comments: ReadonlyArray<LineComment>) =>
  Effect.gen(function* () {
    const read = new Map<string, { readonly tree: string | null; readonly head: string | null }>()
    const kept: Array<KeptLineComment> = []
    for (const comment of comments) {
      const path = worktreeOf(worktrees, comment.path)?.worktree.path
      if (path !== undefined && !read.has(path))
        read.set(path, {
          tree: yield* treeOf(path).pipe(
            Effect.map((tree) => tree.trim()),
            Effect.orElseSucceed(() => null),
          ),
          head: yield* gitExactly(path, 'rev-parse', '--verify', 'HEAD').pipe(
            Effect.map((head) => head.trim()),
            Effect.orElseSucceed(() => null),
          ),
        })
      const at = path === undefined ? undefined : read.get(path)
      kept.push({ ...comment, tree: at?.tree ?? null, head: at?.head ?? null })
    }
    return kept
  })

/**
 * Whether the hunks between two versions of a file change any of the old
 * one's lines `start` to `end`: replace or take out one of them, or put
 * something in between two of them.
 */
export const touches = (hunks: ReadonlyArray<Hunk>, start: number, end: number): boolean =>
  hunks.some((hunk) =>
    hunk.oldCount === 0
      ? hunk.oldStart >= start && hunk.oldStart < end
      : hunk.oldStart <= end && hunk.oldStart + hunk.oldCount - 1 >= start,
  )

/** Whether they change the place lines were taken out at, after the file's line `under` (0 at its top): put something there, or change a line beside it. */
export const touchesAt = (hunks: ReadonlyArray<Hunk>, under: number): boolean =>
  hunks.some((hunk) =>
    hunk.oldCount === 0 ? hunk.oldStart === under : hunk.oldStart <= under + 1 && hunk.oldStart + hunk.oldCount - 1 >= under,
  )

/** A message item's comments as its content keeps them: what can't be read is left out. */
export const keptIn = (comments: unknown): ReadonlyArray<KeptLineComment> =>
  (Array.isArray(comments) ? comments : []).flatMap((one: unknown): ReadonlyArray<KeptLineComment> => {
    if (typeof one !== 'object' || one === null) return []
    const read = one as Record<string, unknown>
    const { path, side, start, end, under, code, note, tree, head } = read
    if (typeof path !== 'string' || (side !== 'new' && side !== 'old') || typeof start !== 'number' || typeof end !== 'number') return []
    if (typeof note !== 'string' || !Array.isArray(code)) return []
    const lines = code.flatMap((line: unknown): ReadonlyArray<QuotedLine> => {
      const { kind, text } = (line ?? {}) as Record<string, unknown>
      return (kind === 'context' || kind === 'added' || kind === 'removed') && typeof text === 'string' ? [{ kind, text }] : []
    })
    return [
      {
        path,
        side,
        start,
        end,
        ...(typeof under === 'number' ? { under } : {}),
        code: lines,
        note,
        tree: typeof tree === 'string' ? tree : null,
        head: typeof head === 'string' ? head : null,
      },
    ]
  })

/** The id a comment goes by: its message's item, and its place among the message's comments, from 1. */
export const commentId = (itemId: string, index: number) => `${itemId}:${index + 1}`

/** A kept comment as the thread shows it: by its id, without the tree it was made on. */
export const sentOf = (itemId: string, comments: ReadonlyArray<KeptLineComment>): ReadonlyArray<SentLineComment> =>
  comments.map(({ tree: _tree, head: _head, ...comment }, index) => ({ id: commentId(itemId, index), ...comment }))

/**
 * Every comment the person sent on a task's diff, oldest first, each where
 * its lines are in the change now and whether a commit since changed them.
 * A message taken back from the queue, or replaced, took its comments with it.
 */
export const lineCommentsOf = (taskId: string, worktrees: ReadonlyArray<CommentedWorktree>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ id: string; content: string; createdAt: string }>`
      SELECT i.id, i.content, i.created_at FROM thread_items i JOIN threads t ON t.id = i.thread_id
      LEFT JOIN user_inputs u ON u.id = i.user_input_id
      WHERE t.task_id = ${taskId} AND i.kind = 'user_message' AND json_type(i.content, '$.comments') = 'array'
        AND (u.state IS NULL OR u.state NOT IN ('withdrawn', 'superseded'))
      ORDER BY i.sequence`
    if (rows.length === 0) return { comments: [] }

    // Each worktree's files as they are, what isn't committed among them, and as its branch's head has them: read once.
    const nows = new Map<string, string | null>()
    const heads = new Map<string, string | null>()
    const once = (cache: Map<string, string | null>, key: string, read: Effect.Effect<string, unknown>) =>
      Effect.gen(function* () {
        if (!cache.has(key))
          cache.set(
            key,
            yield* read.pipe(
              Effect.map((tree) => tree.trim()),
              Effect.orElseSucceed(() => null),
            ),
          )
        return cache.get(key) ?? null
      })
    // What changed in a file between two trees: one diff each, however many comments are on it; null where git can't say.
    const diffs = new Map<string, ReadonlyArray<Hunk> | null>()
    const between = (cwd: string, from: string, to: string, path: string) =>
      Effect.gen(function* () {
        const key = `${cwd}\0${from}\0${to}\0${path}`
        if (!diffs.has(key))
          diffs.set(
            key,
            from === to
              ? []
              : yield* gitExactly(
                  cwd,
                  '--literal-pathspecs',
                  'diff',
                  '--no-color',
                  '--no-ext-diff',
                  '--no-textconv',
                  '-U0',
                  from,
                  to,
                  '--',
                  path,
                ).pipe(
                  Effect.map(hunksOf),
                  // A tree git has since let go of: the comment stays where it was made, not addressed.
                  Effect.orElseSucceed(() => null),
                ),
          )
        return diffs.get(key) ?? null
      })

    const comments: Array<LineCommentNow> = []
    for (const row of rows) {
      let content: unknown
      try {
        content = JSON.parse(row.content)
      } catch {
        continue
      }
      const kept = keptIn((content as { comments?: unknown }).comments)
      for (const [index, { tree, head: made, ...comment }] of kept.entries()) {
        const found = worktreeOf(worktrees, comment.path)
        let at: LineCommentNow['at'] = { path: comment.path, line: comment.start }
        let addressed = false
        if (found !== null && tree !== null) {
          const cwd = found.worktree.path
          const now = yield* once(nows, cwd, treeOf(cwd))
          const head = yield* once(heads, cwd, gitExactly(cwd, 'rev-parse', 'HEAD^{tree}'))
          // A commit since changed its file: what isn't committed yet, the lead's or what the comment was made on, doesn't count.
          const committed = head === null || made == null ? null : yield* between(cwd, made, head, found.inside)
          // And as committed, its lines aren't as they were when it was made.
          const sinceCommitted =
            head === null || committed === null || committed.length === 0 ? null : yield* between(cwd, tree, head, found.inside)
          // What changed in its file since, as it is now: committed or not.
          const since = now === null ? null : yield* between(cwd, tree, now, found.inside)
          const touched = (hunks: NonNullable<typeof since>) =>
            comment.side === 'new'
              ? touches(hunks, comment.start, comment.end)
              : touchesAt(hunks, comment.under ?? Math.max(0, comment.start - 1))
          // Its lines changed as committed, and still as the files are: a commit of another part of the file, its lines left
          // uncommitted as they were, doesn't address it.
          if (sinceCommitted !== null && since !== null) addressed = touched(sinceCommitted) && touched(since)
          if (comment.side === 'new') {
            // Its file gone since, it has no line to be under.
            if (!existsSync(join(cwd, found.inside))) at = null
            else if (since !== null) at = { path: comment.path, line: carriedLine(since, comment.start).line }
          }
        }
        comments.push({ id: commentId(row.id, index), ...comment, itemId: row.id, sentAt: row.createdAt, at, addressed })
      }
    }
    return { comments }
  })
