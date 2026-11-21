import { useId } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { Button } from '../../primitives/Button/Button'
import { SettingRow } from '../Preferences/Preferences'
import s from './TaskFolderLocation.module.css'

/*
 * Where new tasks' folders go, as one row of Work on this computer: the folder
 * as it stands, and Change, which opens a folder picker. It says what the
 * choice leaves alone: folders already made stay where they are. Where the
 * environment sets the folder (ALTHAR_WORKTREES), the row says so and Change
 * is off. A chosen folder that can't be used now is a lasting state, said calmly
 * in a line of its own that Use the default answers; a pick Althar refused is the
 * answer to what the person just did, in red, and goes with the next try.
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
  /** After the note, where the person chose a folder: what the default is. */
  theDefault: (folder: string) => string
}

export const taskFolderLocationText: TaskFolderLocationText = {
  title: 'Task folders',
  note: 'New tasks’ folders are made here, in a folder named Althar inside the one you choose. Folders already made stay where they are, with their copies; the command line keeps using the default.',
  change: 'Change',
  useDefault: 'Use the default',
  fromEnvironment: 'Set by ALTHAR_WORKTREES in the environment, so it can’t be changed here.',
  theDefault: (folder) => `The default is ${folder}.`,
}

export interface TaskFolderLocationProps {
  folder: string
  from: TaskFolderFrom
  /** Where the platform keeps them, to say what Use the default goes back to. */
  defaultFolder?: string
  onChange: () => void
  /** Goes back to the platform's default; the button shows only where the person chose a folder. */
  onUseDefault?: () => void
  /** The chosen folder can't be used now (gone missing, or read-only): what has happened, what it stops, and the way out, in a line. */
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
  defaultFolder,
  onChange,
  onUseDefault,
  problem,
  busy = false,
  refusal,
  text = taskFolderLocationText,
}: TaskFolderLocationProps) {
  const fixed = from === 'environment'
  const own = useId()
  const problemId = `${own}-problem`
  const changeId = `${own}-change`
  const defaultId = `${own}-default`
  return (
    <SettingRow
      title={text.title}
      glyph={<Icon name="folder" size={15} />}
      note={
        <>
          {text.note}
          {fixed && <span className={s.line}>{text.fromEnvironment}</span>}
          {from === 'setting' && defaultFolder !== undefined && <span className={s.line}>{text.theDefault(defaultFolder)}</span>}
        </>
      }
      under={
        (problem !== undefined || refusal !== undefined) && (
          <div className={s.lines}>
            {problem !== undefined && (
              <p className={s.problem} id={problemId}>
                <Icon name="offline" size={13} />
                <span>{problem}</span>
              </p>
            )}
            {refusal !== undefined && (
              <p className={s.refusal} role="alert">
                {refusal}
              </p>
            )}
          </div>
        )
      }
    >
      {(ids) => (
        <span className={s.control}>
          <code className={s.folder} title={folder}>
            {folder}
          </code>
          <Button
            size="small"
            variant={problem === undefined ? 'default' : 'quiet'}
            onClick={onChange}
            disabled={fixed || busy}
            busy={busy}
            id={changeId}
            aria-labelledby={`${ids.labelledBy} ${changeId}`}
            aria-describedby={[ids.describedBy, problem === undefined ? undefined : problemId].filter(Boolean).join(' ')}
          >
            {text.change}
          </Button>
          {from === 'setting' && onUseDefault !== undefined && (
            <Button
              size="small"
              variant={problem === undefined ? 'quiet' : 'default'}
              onClick={onUseDefault}
              disabled={busy}
              id={defaultId}
              aria-labelledby={`${defaultId} ${ids.labelledBy}`}
            >
              {text.useDefault}
            </Button>
          )}
        </span>
      )}
    </SettingRow>
  )
}
