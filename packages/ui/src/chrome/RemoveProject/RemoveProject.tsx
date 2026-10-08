import { Button } from '../../primitives/Button/Button'
import { Dialog } from '../../primitives/Dialog/Dialog'
import s from './RemoveProject.module.css'

/*
 * Taking a project out of Althar, said in full before anything goes: what
 * stops, what stays where, and that the person's own folders are not
 * touched. It is the one step; nothing goes until it is pressed, and Cancel,
 * first, has focus as it opens.
 */

export interface RemoveProjectText {
  title: (project: string) => string
  description: string
  /** Its tasks under way, by how many: what happens to them. */
  working: (tasks: number) => string
  idle: string
  /** Where its tasks' worktrees and branches stay. */
  worktrees: (where: string) => string
  noWorktrees: string
  again: string
  remove: string
  cancel: string
}

export const removeProjectText: RemoveProjectText = {
  title: (project) => `Remove ${project} from Althar?`,
  description: 'It leaves the window and the home. Nothing in its folders changes.',
  working: (tasks) =>
    tasks === 1
      ? 'Its task under way stops: the agents on it stop, and nothing it planned starts.'
      : `Its ${tasks} tasks under way stop: the agents on them stop, and nothing it planned starts.`,
  idle: 'Its conversation and its tasks go with it.',
  worktrees: (where) => `Its tasks’ worktrees and branches stay in ${where}, for you to keep or delete.`,
  noWorktrees: 'It has no worktrees to leave behind.',
  again: 'Opening its folder again makes a new project, without this one’s history.',
  remove: 'Remove project',
  cancel: 'Cancel',
}

export interface RemoveProjectProps {
  project: string
  /** Its tasks under way: running, or waiting on the person. */
  working: number
  /** Where its tasks' worktrees are, as the person would find them; null where it has none. */
  worktrees: string | null
  onRemove: () => void
  onClose: () => void
  busy?: boolean
  error?: string
  text?: Partial<RemoveProjectText>
}

export function RemoveProject({ project, working, worktrees, onRemove, onClose, busy = false, error, text }: RemoveProjectProps) {
  const t = { ...removeProjectText, ...text }
  return (
    <Dialog
      title={t.title(project)}
      description={t.description}
      onClose={onClose}
      width={460}
      actions={
        <>
          <Button variant="quiet" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button variant="danger" busy={busy} onClick={onRemove}>
            {t.remove}
          </Button>
        </>
      }
    >
      <ul className={s.list}>
        <li>{working > 0 ? t.working(working) : t.idle}</li>
        <li>{worktrees === null ? t.noWorktrees : t.worktrees(worktrees)}</li>
        <li>{t.again}</li>
      </ul>
      {error !== undefined && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
    </Dialog>
  )
}
