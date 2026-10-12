import { TaskActivity, unreachable } from '../../foundations/vocabulary'
import { Button } from '../../primitives/Button/Button'
import { Dialog } from '../../primitives/Dialog/Dialog'
import s from './AbandonTask.module.css'

/*
 * Abandoning a task, said in full before it happens: what stops, that its
 * worktree and branch stay where they are, untouched, and that it can be
 * reopened on them. A pull request it opened stays open on its host. It is
 * the one step; nothing happens until it is pressed, and Cancel, first, has
 * focus as it opens.
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
  /** Its pull request, by name, and the host it stays open on. */
  change: (name: string, host: string) => string
  reopen: string
  abandon: string
  cancel: string
}

export const abandonTaskText: AbandonTaskText = {
  title: 'Abandon this task?',
  description: 'The task ends here, and its change isn’t merged.',
  working: 'The agents on it stop.',
  planned: 'Its plan doesn’t start.',
  worktree: (where) => `Its worktree stays in ${where}, as it is.`,
  noWorktree: 'It has no worktree to leave behind.',
  branch: (name) => `Its branch ${name} stays. Nothing is pushed or deleted.`,
  change: (name, host) => `${name} stays open on ${host}.`,
  reopen: 'You can reopen it later, on the same worktree and branch.',
  abandon: 'Abandon task',
  cancel: 'Cancel',
}

export interface AbandonTaskProps {
  /** What it has going: agents on it, a plan waiting to start, or nothing. */
  activity: TaskActivity
  /** Where its worktree is, as the person would find it; null where it has none. */
  worktree: string | null
  /** Its branch; null where it has none yet. */
  branch: string | null
  /** Its open pull request, by name, and the host it is on. */
  change?: { readonly name: string; readonly host: string }
  onAbandon: () => void
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

export function AbandonTask({ activity, worktree, branch, change, onAbandon, onClose, busy = false, error, text }: AbandonTaskProps) {
  const t = { ...abandonTaskText, ...text }
  const stopping = stops(activity, t)
  return (
    <Dialog
      title={t.title}
      description={t.description}
      onClose={onClose}
      width={460}
      actions={
        <>
          <Button variant="quiet" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button variant="danger" busy={busy} onClick={onAbandon}>
            {t.abandon}
          </Button>
        </>
      }
    >
      <ul className={s.list}>
        {stopping !== null && <li>{stopping}</li>}
        <li>{worktree === null ? t.noWorktree : t.worktree(worktree)}</li>
        {branch !== null && <li>{t.branch(branch)}</li>}
        {change !== undefined && <li>{t.change(change.name, change.host)}</li>}
        <li>{t.reopen}</li>
      </ul>
      {error !== undefined && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
    </Dialog>
  )
}
