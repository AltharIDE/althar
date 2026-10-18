import { useId } from 'react'

import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { FieldError } from '../../primitives/Field/Field'
import { Switch } from '../../primitives/Switch/Switch'
import s from './RepositoryFiles.module.css'

/*
 * Skill and OpenSpec files in a project's repositories, in its settings:
 * three separate permissions, each off until the person turns it on. Off,
 * Althar keeps its skills and OpenSpec artifacts in its own store and a push
 * that holds such a file is refused; writing them into the repository never
 * allows pushing them, which is a switch of its own. Each switch is a new
 * revision of the project's rules.
 */

/** Which of the three permissions. */
export type RepositoryFile = 'writeSkills' | 'writeOpenSpec' | 'pushProtected'

export type RepositoryFilesValue = Readonly<Record<RepositoryFile, boolean>>

export interface RepositoryFilesText {
  /** What they are, above them. */
  line: string
  title: Record<RepositoryFile, string>
  /** What each allows, under its name. */
  allows: Record<RepositoryFile, string>
  /** Where each stands, off and on. */
  off: Record<RepositoryFile, string>
  on: Record<RepositoryFile, string>
  /** In a line, for the module in the settings that opens out to them. */
  summary: (value: RepositoryFilesValue) => string
}

export const repositoryFilesText: RepositoryFilesText = {
  line: 'Skill and OpenSpec files stay on this computer unless you allow them here. Each choice is for this project only.',
  title: {
    writeSkills: 'Write Althar-managed skills',
    writeOpenSpec: 'Write OpenSpec artifacts',
    pushProtected: 'Push skill/OpenSpec files',
  },
  allows: {
    writeSkills:
      'When a task asks, its skills are written into the agents’ own folders in the repository (.claude/skills, .agents/skills, .opencode/skills) and may be committed there.',
    writeOpenSpec: 'OpenSpec’s openspec/ folder may live in the repository and be committed with it.',
    pushProtected:
      'Changes to those skill folders and openspec/ may be pushed with a task’s branch. Neither switch above allows this on its own.',
  },
  off: { writeSkills: 'In Althar', writeOpenSpec: 'In Althar', pushProtected: 'Blocked' },
  on: { writeSkills: 'In the repository', writeOpenSpec: 'In the repository', pushProtected: 'Allowed' },
  summary: (value) => {
    const written = [value.writeSkills && 'skills', value.writeOpenSpec && 'OpenSpec'].filter(Boolean).join(' and ')
    const push = value.pushProtected ? 'pushing allowed' : 'pushing blocked'
    return written === '' ? `Kept on this computer, ${push}` : `${written[0]!.toUpperCase()}${written.slice(1)} written, ${push}`
  },
}

const ORDER: ReadonlyArray<RepositoryFile> = ['writeSkills', 'writeOpenSpec', 'pushProtected']

export type RepositoryFilesProps = RootProps<
  'div',
  {
    value: RepositoryFilesValue
    /** Turns one on or off. */
    onChange: (file: RepositoryFile, on: boolean) => void
    /** Why the last one switched didn't hold. */
    error?: string
    text?: Partial<RepositoryFilesText>
  }
>

/** The three permissions, each a switch with what it allows under its name. */
export function RepositoryFiles({ value, onChange, error, text, className, ...rest }: RepositoryFilesProps) {
  const t = { ...repositoryFilesText, ...text }
  const id = useId()
  return (
    <div className={cx(s.files, className)} {...rest}>
      <p className={s.line}>{t.line}</p>
      <ul className={s.list}>
        {ORDER.map((file) => (
          <li key={file} className={s.row}>
            <div className={s.words}>
              <span id={`${id}-${file}`} className={s.title}>
                {t.title[file]}
              </span>
              <span id={`${id}-${file}-allows`} className={s.allows}>
                {t.allows[file]}
              </span>
            </div>
            <span className={cx(s.state, value[file] && s.stateOn)}>{value[file] ? t.on[file] : t.off[file]}</span>
            <Switch
              checked={value[file]}
              onChange={(on) => onChange(file, on)}
              labelledBy={`${id}-${file}`}
              describedBy={`${id}-${file}-allows`}
            />
          </li>
        ))}
      </ul>
      {error !== undefined && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  )
}
