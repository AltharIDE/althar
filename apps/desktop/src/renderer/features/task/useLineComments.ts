import { useCallback, useEffect, useState } from 'react'

import { LINE_COMMENTS, type LineComment, type LineCommentNow } from '@althar/contracts'
import type { NewComment, ViewedComment } from '@althar/ui'

import { useServices } from '../../data/services'
import { ago } from '../../shared/time'

/*
 * The person's comments on lines of a task's diff (DEV-175; decisions: desktop-app § Comments on the diff): those
 * they wrote and gathered, waiting to go, kept for each task while the window
 * is open; and those sent, read from the runtime each time the Changes view
 * opens and as the change moves, each where it is now and addressed once a
 * commit since changed its lines.
 */

/** A comment waiting to go, by an id of the window's own. */
export interface DraftComment extends NewComment {
  readonly id: string
}

export interface LineCommentsModel {
  /** Every comment on the task's diff, as the Changes view shows them: those waiting first, numbered, then those sent, oldest first. */
  readonly comments: ReadonlyArray<ViewedComment>
  /** How many wait to go. */
  readonly waiting: number
  readonly add: (comment: NewComment) => void
  readonly edit: (id: string, note: string) => void
  readonly remove: (id: string) => void
  /** Takes those waiting, as many as a message takes, as they go: given back with `giveBack` where Althar doesn't take them. */
  readonly take: () => ReadonlyArray<LineComment>
  readonly giveBack: (comments: ReadonlyArray<LineComment>) => void
  /** Reads the sent ones again: once a message with some is accepted. */
  readonly reread: () => void
}

/** A comment as it goes to the runtime: no id, no more than it says. */
export const sentOf = ({ path, side, start, end, under, code, note }: NewComment): LineComment => ({
  path,
  side,
  start,
  end,
  ...(under === undefined ? {} : { under }),
  code,
  note,
})

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

/** A comment waiting to go, as the Changes view shows it: numbered as it will be in the message. */
export const viewedDraft = (comment: DraftComment, index: number): ViewedComment => ({
  ...comment,
  state: 'draft',
  n: index + 1,
  line: comment.end,
})

// Those waiting, by task, kept while the window is open: the view can close and the task change without losing them.
const gathered = new Map<string, ReadonlyArray<DraftComment>>()
let made = 0

export const useLineComments = (taskId: string | null, open: boolean, moved = ''): LineCommentsModel => {
  const { client } = useServices()
  const [drafts, setDraftsState] = useState<ReadonlyArray<DraftComment>>(() => (taskId === null ? [] : (gathered.get(taskId) ?? [])))
  const [shownFor, setShownFor] = useState(taskId)
  const [sent, setSent] = useState<{ readonly taskId: string; readonly comments: ReadonlyArray<LineCommentNow> } | null>(null)
  const [attempt, setAttempt] = useState(0)
  if (shownFor !== taskId) {
    setShownFor(taskId)
    setDraftsState(taskId === null ? [] : (gathered.get(taskId) ?? []))
  }
  const setDrafts = useCallback(
    (next: (now: ReadonlyArray<DraftComment>) => ReadonlyArray<DraftComment>) =>
      setDraftsState((now) => {
        const changed = next(now)
        if (taskId !== null) gathered.set(taskId, changed)
        return changed
      }),
    [taskId],
  )

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
  return {
    comments: [...drafts.map(viewedDraft), ...own.map((comment) => viewedSent(comment))],
    waiting: drafts.length,
    add: useCallback(
      (comment: NewComment) => {
        made += 1
        setDrafts((now) => [...now, { ...comment, id: `draft-${made}` }])
      },
      [setDrafts],
    ),
    edit: useCallback(
      (id: string, note: string) => setDrafts((now) => now.map((one) => (one.id === id ? { ...one, note } : one))),
      [setDrafts],
    ),
    remove: useCallback((id: string) => setDrafts((now) => now.filter((one) => one.id !== id)), [setDrafts]),
    // As many as one message takes: any more wait for the next Send.
    take: () => {
      setDrafts((now) => now.slice(LINE_COMMENTS.count))
      return drafts.slice(0, LINE_COMMENTS.count).map(sentOf)
    },
    giveBack: (comments) =>
      setDrafts((now) => [
        ...comments.map((comment) => {
          made += 1
          return { ...comment, id: `draft-${made}` }
        }),
        ...now,
      ]),
    reread: useCallback(() => setAttempt((count) => count + 1), []),
  }
}
