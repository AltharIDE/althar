import { Button } from '../../primitives/Button/Button'
import { SettingRow } from '../Preferences/Preferences'
import s from './TaskFolderLocation.module.css'

/*
 * Where new tasks' folders go, as one row of Work on this computer: the folder
 * as it stands, and Change, which opens a folder picker. It says what the
 * choice leaves alone: folders already made stay where they are. Where the
 * environment sets the folder (ALTHAR_WORKTREES), the row says so and Change
 * is off. A folder Althar refused is explained in one line under the row.
 */

/** Who decided: the environment, the person's choice, or where the platform keeps them. */
export type TaskFolderFrom = 'environment' | 'setting' | 'default'

export interface TaskFolderLocationText {
  title: string
  /** What the choice reaches, and what it leaves. */
  note: string
  change: string
  /** Back to where the platform keeps them; shown once the person has chosen another. */
  useDefault: string
  /** Under the folder, where the environment sets it. */
  fromEnvironment: string
}

export const taskFolderLocationText: TaskFolderLocationText = {
  title: 'Task folders',
  note: 'New tasks’ folders are made here. Folders already made stay where they are.',
  change: 'Change',
  useDefault: 'Use the default',
  fromEnvironment: 'Set by ALTHAR_WORKTREES in the environment, so it can’t be changed here.',
}

export interface TaskFolderLocationProps {
  folder: string
  from: TaskFolderFrom
  onChange: () => void
  /** Goes back to the platform's default; the button shows only where the person chose a folder. */
  onUseDefault?: () => void
  /** The chosen folder can't be used now (gone missing, or read-only), in a line. */
  problem?: string
  /** A choice is open in the picker or being checked. */
  busy?: boolean
  /** Why the last choice was refused, in one line. */
  refusal?: string
  text?: TaskFolderLocationText
}

export function TaskFolderLocation({
  folder,
  from,
  onChange,
  onUseDefault,
  problem,
  busy = false,
  refusal,
  text = taskFolderLocationText,
}: TaskFolderLocationProps) {
  const fixed = from === 'environment'
  return (
    <SettingRow
      title={text.title}
      note={
        <>
          {text.note}
          {fixed && <span className={s.line}>{text.fromEnvironment}</span>}
        </>
      }
      under={
        refusal === undefined && problem === undefined ? undefined : (
          <p className={s.refusal} role="alert">
            {refusal ?? problem}
          </p>
        )
      }
    >
      {(ids) => (
        <span className={s.control}>
          <code className={s.folder} title={folder}>
            {folder}
          </code>
          <Button size="small" onClick={onChange} disabled={fixed || busy} busy={busy} aria-labelledby={ids.labelledBy}>
            {text.change}
          </Button>
          {from === 'setting' && onUseDefault !== undefined && (
            <Button size="small" variant="quiet" onClick={onUseDefault} disabled={busy}>
              {text.useDefault}
            </Button>
          )}
        </span>
      )}
    </SettingRow>
  )
}
