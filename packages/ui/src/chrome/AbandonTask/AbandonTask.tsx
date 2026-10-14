import { useState } from 'react'

import { TaskActivity, unreachable } from '../../foundations/vocabulary'
import { Button } from '../../primitives/Button/Button'
import { CheckList } from '../../primitives/CheckList/CheckList'
import { Dialog } from '../../primitives/Dialog/Dialog'
import s from './AbandonTask.module.css'

/*
 * Abandoning a task, said in full before it happens: what stops, that its
 * worktree and branch stay where they are, untouched, and that it can be
 * reopened on them (a plain task, on its worktree alone: it has no branch
 * yet). A pull request it has open is offered to close on its host, on as
 * the dialog opens, with its branch there to delete too, off: only what
 * the person leaves on is done, as they press. It is the one step; nothing
 * happens until it is pressed, and Cancel, first, has focus as it opens.
 * Abandoned, but a pull request it was to close still open (the host said
 * no), it says so, and offers to close what is left again.
 */

export interface AbandonTaskText {
  title: string
  description: string
  /** What stops, by what the task has going; nothing is said when nothing runs. */
  working: string
  planned: string
  /** Where its worktree stays, as the person would find it. */
  worktree: (where: string) => string
  noWorktree: string
  /** Its branch, which stays, with nothing pushed or deleted. */
  branch: (name: string) => string
  /** Its branch, which stays here while its copy on the host is deleted. */
  branchHere: (name: string) => string
  /** What its open pull requests are, for a screen reader. */
  changes: string
  /** Closing a pull request, by name, on its host. */
  close: (name: string, host: string) => string
  /** Deleting that pull request's branch on its host. */
  deleteBranch: (host: string) => string
  reopen: string
  /** For a task with a worktree and no branch yet, a plain one. */
  reopenWorktree: string
  /** For a task with neither yet. */
  reopenLater: string
  abandon: string
  cancel: string
  /** Abandoned, with a pull request it was to close still open. */
  abandonedTitle: string
  abandonedDescription: string
  closeAgain: string
  leaveOpen: string
}

export const abandonTaskText: AbandonTaskText = {
  title: 'Abandon this task?',
  description: 'The task ends here, and its change isn’t merged.',
  working: 'The agents on it stop.',
  planned: 'Its plan doesn’t start.',
  worktree: (where) => `Its worktree stays in ${where}, as it is.`,
  noWorktree: 'It has no worktree to leave behind.',
  branch: (name) => `Its branch ${name} stays. Nothing is pushed or deleted.`,
  branchHere: (name) => `Its branch ${name} stays on this Mac.`,
  changes: 'Its pull requests',
  close: (name, host) => `Close ${name} on ${host}`,
  deleteBranch: (host) => `Delete its branch on ${host}`,
  reopen: 'You can reopen it later, on the same worktree and branch.',
  reopenWorktree: 'You can reopen it later, on the same worktree.',
  reopenLater: 'You can reopen it later.',
  abandon: 'Abandon task',
  cancel: 'Cancel',
  abandonedTitle: 'Task abandoned',
  abandonedDescription: 'Its pull request is still open on its host.',
  closeAgain: 'Try again',
  leaveOpen: 'Leave it open',
}

/** An open pull request of the task: an id of the caller's, its name in the host's words, and its host. */
export interface AbandonChange {
  readonly id: string
  readonly name: string
  readonly host: string
}

/** What the person left on: the pull requests to close, and those whose branch goes too, by id. */
export interface AbandonChoices {
  readonly close: ReadonlyArray<string>
  readonly deleteBranch: ReadonlyArray<string>
}

export interface AbandonTaskProps {
  /** What it has going: agents on it, a plan waiting to start, or nothing. */
  activity: TaskActivity
  /** Where its worktree is, as the person would find it; null where it has none. */
  worktree: string | null
  /** Its branch; null where it has none yet. */
  branch: string | null
  /** Its open pull requests, each offered to close on its host. */
  changes?: ReadonlyArray<AbandonChange>
  /** Abandoned already, with these pull requests still open: only closing them is offered. */
  abandoned?: boolean
  onAbandon: (choices: AbandonChoices) => void
  onClose: () => void
  busy?: boolean
  error?: string
  text?: Partial<AbandonTaskText>
}

/** What stops, in words; nothing when nothing runs. */
const stops = (activity: TaskActivity, t: AbandonTaskText): string | null => {
  switch (activity) {
    case TaskActivity.Working:
      return t.working
    case TaskActivity.Planned:
      return t.planned
    case TaskActivity.Still:
      return null
    default:
      return unreachable(activity)
  }
}

/** A choice's id in the list: closing a pull request, or deleting its branch. */
const closeId = (id: string) => `close:${id}`
const branchId = (id: string) => `branch:${id}`

export function AbandonTask({
  activity,
  worktree,
  branch,
  changes = [],
  abandoned = false,
  onAbandon,
  onClose,
  busy = false,
  error,
  text,
}: AbandonTaskProps) {
  const t = { ...abandonTaskText, ...text }
  const stopping = stops(activity, t)
  // Each pull request closed unless the person says not; no branch deleted unless they say.
  const [on, setOn] = useState<ReadonlyArray<string>>(() => changes.map((change) => closeId(change.id)))
  const closing = changes.filter((change) => on.includes(closeId(change.id)))
  // A branch goes only with its pull request closed: turning closing off takes it off too.
  const deleting = closing.filter((change) => on.includes(branchId(change.id)))
  const items = changes.flatMap((change) => [
    { id: closeId(change.id), label: t.close(change.name, change.host) },
    ...(closing.includes(change) ? [{ id: branchId(change.id), label: t.deleteBranch(change.host) }] : []),
  ])
  const choices: AbandonChoices = { close: closing.map((change) => change.id), deleteBranch: deleting.map((change) => change.id) }
  return (
    <Dialog
      title={abandoned ? t.abandonedTitle : t.title}
      description={abandoned ? t.abandonedDescription : t.description}
      onClose={onClose}
      width={460}
      actions={
        <>
          <Button variant="quiet" onClick={onClose}>
            {abandoned ? t.leaveOpen : t.cancel}
          </Button>
          <Button
            variant={abandoned ? 'default' : 'danger'}
            busy={busy}
            disabled={abandoned && closing.length === 0}
            onClick={() => onAbandon(choices)}
          >
            {abandoned ? t.closeAgain : t.abandon}
          </Button>
        </>
      }
    >
      {!abandoned && (
        <ul className={s.list}>
          {stopping !== null && <li>{stopping}</li>}
          <li>{worktree === null ? t.noWorktree : t.worktree(worktree)}</li>
          {branch !== null && <li>{deleting.length > 0 ? t.branchHere(branch) : t.branch(branch)}</li>}
          <li>{branch !== null ? t.reopen : worktree !== null ? t.reopenWorktree : t.reopenLater}</li>
        </ul>
      )}
      {changes.length > 0 && (
        <CheckList
          className={s.changes}
          label={t.changes}
          items={items}
          value={on}
          onChange={(next) => setOn(next.filter((id) => !id.startsWith('branch:') || next.includes(closeId(id.slice('branch:'.length)))))}
          disabled={busy}
        />
      )}
      {error !== undefined && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
    </Dialog>
  )
}
