import { useQueries, type UseQueryResult } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { ApiError, LINE_COMMENTS, type FileDiff, type LineComment, type LineCommentNow } from '@althar/contracts'
import type { NewComment, ViewedComment } from '@althar/ui'

import { useServices } from '../../data/services'
import { drop, gather, type GatheredComment, isDiffDraft, markEarlier, rewrite } from '../../shared/comments'
import { ago } from '../../shared/time'

/*
 * The person's comments on lines of a task's diff (DEV-175; decisions: desktop-app § Comments on the diff): those
 * they wrote and gathered in the thread's draft, and those sent, read from the runtime each time the Changes view
 * opens and as the change moves, each where it is now and addressed once a
 * commit since changed its lines.
 */

export interface LineCommentsModel {
  /** Every comment on the task's diff, as the Changes view shows them: those waiting first, numbered, then those sent, oldest first. */
  readonly comments: ReadonlyArray<ViewedComment>
  readonly add: (comment: NewComment) => void
  readonly edit: (id: string, note: string) => void
  readonly remove: (id: string) => void
  /** Reads the sent ones again: once a message with some is accepted. */
  readonly reread: () => void
}

/** The line a comment goes under: the last of its lines, where its first is now. */
const lastLine = (first: number, comment: Pick<LineComment, 'start' | 'end'>) => first + (comment.end - comment.start)

/** A comment sent, as the Changes view shows it. */
export const viewedSent = (comment: LineCommentNow, now?: Date): ViewedComment => ({
  id: comment.id,
  path: comment.path,
  side: comment.side,
  start: comment.start,
  end: comment.end,
  ...(comment.under === undefined ? {} : { under: comment.under }),
  code: comment.code,
  note: comment.note,
  state: comment.addressed ? 'addressed' : 'sent',
  line: comment.at === null ? null : lastLine(comment.at.line, comment),
  sentAt: ago(comment.sentAt, now),
})

/** The saved quote must still be on the same side and at the same coordinates. */
export const lineIsEarlier = (comment: Omit<LineComment, 'note'>, diff: FileDiff): boolean | undefined => {
  const numbers = new Map<number, string>()
  for (const line of diff.lines) {
    if (line.kind === 'hunk') continue
    if (comment.side === 'old' && line.kind !== 'added') numbers.set(line.old, line.text)
    if (comment.side === 'new' && line.kind !== 'removed') numbers.set(line.new, line.text)
  }
  let number = comment.start
  for (const line of comment.code) {
    if (line.kind === (comment.side === 'old' ? 'added' : 'removed')) continue
    const seen = numbers.get(number)
    if (seen === undefined) return diff.truncated ? undefined : true
    if (seen.slice(0, LINE_COMMENTS.lineText) !== line.text) return true
    number += 1
  }
  return numbers.has(comment.end) ? false : diff.truncated ? undefined : true
}

export const useLineComments = (
  key: string,
  drafts: ReadonlyArray<GatheredComment>,
  taskId: string | null,
  open: boolean,
  moved = '',
): LineCommentsModel => {
  const { client } = useServices()
  const [sent, setSent] = useState<{ readonly taskId: string; readonly comments: ReadonlyArray<LineCommentNow> } | null>(null)
  const [attempt, setAttempt] = useState(0)

  const diffDrafts = useMemo(() => drafts.filter(isDiffDraft), [drafts])
  const paths = useMemo(() => [...new Set(diffDrafts.map((one) => one.on.line.path))], [diffDrafts])
  const diffs = useQueries({
    queries: paths.map((path) => ({
      queryKey: ['draft-diff', taskId, path, moved],
      queryFn: () => client.behind(() => client.getFileDiff(taskId ?? '', path)),
      enabled: taskId !== null,
      gcTime: 0,
    })),
    combine: useCallback((results: ReadonlyArray<UseQueryResult<FileDiff>>) => results.map(({ data, error }) => ({ data, error })), []),
  })
  useEffect(() => {
    const earlier = new Map<string, boolean>()
    for (const one of diffDrafts) {
      const read = diffs[paths.indexOf(one.on.line.path)]
      const state =
        read?.data !== undefined
          ? lineIsEarlier(one.on.line, read.data)
          : read?.error instanceof ApiError && read.error.reason === 'NotFound'
            ? true
            : undefined
      if (state !== undefined) earlier.set(one.id, state)
    }
    if (earlier.size > 0) markEarlier(key, earlier)
  }, [key, diffDrafts, paths, diffs])

  useEffect(() => {
    if (!open || taskId === null) return
    let current = true
    client.getLineComments(taskId).then(
      (answer) => {
        if (current) setSent({ taskId, comments: answer.comments })
      },
      // Without them, the diff shows those waiting only.
      () => {
        if (current) setSent({ taskId, comments: [] })
      },
    )
    return () => {
      current = false
    }
  }, [client, open, taskId, moved, attempt])

  const own = sent?.taskId === taskId ? sent.comments : []
  const waiting = drafts.flatMap((one, index): ViewedComment[] =>
    isDiffDraft(one)
      ? [{ ...one.on.line, note: one.note, id: one.id, state: 'draft', n: index + 1, line: one.earlier ? null : one.on.line.end }]
      : [],
  )
  return {
    comments: [...waiting, ...own.map((comment) => viewedSent(comment))],
    add: useCallback(
      ({ note, ...line }: NewComment) => gather(key, { id: crypto.randomUUID(), note, on: { kind: 'diff', line }, crop: null }),
      [key],
    ),
    edit: useCallback((id: string, note: string) => rewrite(key, id, note), [key]),
    remove: useCallback((id: string) => drop(key, id), [key]),
    reread: useCallback(() => setAttempt((count) => count + 1), []),
  }
}
