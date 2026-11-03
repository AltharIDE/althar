import { Button } from '../../primitives/Button/Button'
import { Dialog } from '../../primitives/Dialog/Dialog'
import s from './RemoveProject.module.css'

/*
 * Taking a project out of Althar, asked first: what stops, what goes and what
 * stays. It is the one step; nothing goes until it is pressed, and Cancel,
 * first, has focus as it opens.
 */

export interface RemoveProjectText {
  title: (project: string) => string
  /** Its tasks under way, by how many, which stop. */
  working: (tasks: number) => string
  /** What goes, and what stays: with its tasks' worktrees, or with none. */
  kept: string
  keptFolders: string
  remove: string
  cancel: string
}

export const removeProjectText: RemoveProjectText = {
  title: (project) => `Remove ${project} from Althar?`,
  working: (tasks) => (tasks === 1 ? 'Its task under way stops.' : `Its ${tasks} tasks under way stop.`),
  kept: 'Its conversation and tasks go. Its folders, worktrees and branches stay.',
  keptFolders: 'Its conversation and tasks go. Its folders stay.',
  remove: 'Remove project',
  cancel: 'Cancel',
}

export interface RemoveProjectProps {
  project: string
  /** Its tasks under way: running, or waiting on the person. */
  working: number
  /** Where its tasks' worktrees are; null where it has none. */
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
        {working > 0 && <li>{t.working(working)}</li>}
        <li>{worktrees === null ? t.keptFolders : t.kept}</li>
      </ul>
      {error !== undefined && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
    </Dialog>
  )
}
