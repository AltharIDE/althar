import { useState } from 'react'

import { Button } from '../../primitives/Button/Button'
import { CheckList } from '../../primitives/CheckList/CheckList'
import { Dialog } from '../../primitives/Dialog/Dialog'
import s from './AbandonTask.module.css'

/*
 * Abandoning a task, asked first: the one thing said is that its branch and
 * worktree stay (a plain task's worktree alone: it has no branch yet). A pull request it has open is offered to close on its host, on as
 * the dialog opens, with its branch there to delete too, off: only what
 * the person leaves on is done, as they press. A merged task abandons only
 * the commits after its pull request: that stays merged, and its lead
 * carries on when the person writes to it. It is the one step; nothing
 * happens until it is pressed, and Cancel, first, has focus as it opens.
 * Abandoned, but a pull request it was to close still open (the host said
 * no), it says so, and offers to close what is left again.
 */

export interface AbandonTaskText {
  title: string
  /** What stays: its branch and worktree, or its worktree alone. */
  kept: string
  keptWorktree: string
  /** What its open pull requests are, for a screen reader. */
  changes: string
  /** Closing a pull request, by name, on its host. */
  close: (name: string, host: string) => string
  /** Deleting that pull request's branch on its host. */
  deleteBranch: (host: string) => string
  /** For a merged task: its pull request, which stays merged, and the commits after it, left out. */
  mergedDescription: (change: string) => string
  mergedCommits: (count: number) => string
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
  kept: 'Its branch and worktree stay.',
  keptWorktree: 'Its worktree stays.',
  changes: 'Its pull requests',
  close: (name, host) => `Close ${name} on ${host}`,
  deleteBranch: (host) => `Delete its branch on ${host}`,
  mergedDescription: (change) => `${change} stays merged.`,
  mergedCommits: (count) =>
    count === 1 ? 'The commit after it goes in no pull request.' : `The ${count} commits after it go in no pull request.`,
  abandon: 'Abandon task',
  cancel: 'Cancel',
  abandonedTitle: 'Task abandoned',
  abandonedDescription: 'Its pull request is still open.',
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
  /** Where its worktree is, as the person would find it; null where it has none. */
  worktree: string | null
  /** Its branch; null where it has none yet. */
  branch: string | null
  /** Its open pull requests, each offered to close on its host. */
  changes?: ReadonlyArray<AbandonChange>
  /** Abandoned already, with these pull requests still open: only closing them is offered. */
  abandoned?: boolean
  /** Its change merged: its last pull request, by name, and how many commits after it are left out. */
  merged?: { readonly name: string; readonly commits: number }
  onAbandon: (choices: AbandonChoices) => void
  onClose: () => void
  busy?: boolean
  error?: string
  text?: Partial<AbandonTaskText>
}

/** A choice's id in the list: closing a pull request, or deleting its branch. */
const closeId = (id: string) => `close:${id}`
const branchId = (id: string) => `branch:${id}`

export function AbandonTask({
  worktree,
  branch,
  changes = [],
  abandoned = false,
  merged,
  onAbandon,
  onClose,
  busy = false,
  error,
  text,
}: AbandonTaskProps) {
  const t = { ...abandonTaskText, ...text }
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
      description={abandoned ? t.abandonedDescription : merged === undefined ? undefined : t.mergedDescription(merged.name)}
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
      {!abandoned && (merged !== undefined || worktree !== null) && (
        <ul className={s.list}>
          {merged !== undefined && <li>{t.mergedCommits(merged.commits)}</li>}
          {worktree !== null && <li>{branch === null ? t.keptWorktree : t.kept}</li>}
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
