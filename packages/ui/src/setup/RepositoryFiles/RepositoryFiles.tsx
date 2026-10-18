import { useId } from 'react'

import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { FieldError } from '../../primitives/Field/Field'
import { Switch } from '../../primitives/Switch/Switch'
import s from './RepositoryFiles.module.css'

/*
 * Skill and OpenSpec files in a project's repositories, in its settings:
 * three separate permissions, each off until the person turns it on. Althar
 * never writes such files into a repository itself; an agent may, and
 * commit them with a task's work. Off, a push of a task's commits that hold
 * them is held back, so they stay on the device. Allowing a kind of file in
 * the repository never allows pushing it, which is a switch of its own.
 * Each switch is a new revision of the project's rules. The device is named
 * as the consumer names it (this Mac, this PC), through `repositoryFilesWords`.
 */

/** Which of the three permissions. */
export type RepositoryFile = 'writeSkills' | 'writeOpenSpec' | 'pushProtected'

export type RepositoryFilesValue = Readonly<Record<RepositoryFile, boolean>>

export interface RepositoryFilesText {
  /** What they are, above them. */
  line: string
  /** Each switch's name. The runtime's refused push names them as they are here, so they stay as they are. */
  title: Record<RepositoryFile, string>
  /** What each allows, under its name. */
  allows: Record<RepositoryFile, string>
  /** Where each stands, off and on. */
  off: Record<RepositoryFile, string>
  on: Record<RepositoryFile, string>
  /** In a line, for the module in the settings that opens out to them. */
  summary: (value: RepositoryFilesValue) => string
}

/** The words, with the device named as the consumer names it: "this Mac". */
export const repositoryFilesWords = (device: string): RepositoryFilesText => ({
  line: `Skill and OpenSpec files a task commits stay on ${device} unless you allow them here. Each choice is for this project only.`,
  title: {
    writeSkills: 'Write Althar-managed skills',
    writeOpenSpec: 'Write OpenSpec artifacts',
    pushProtected: 'Push skill/OpenSpec files',
  },
  allows: {
    writeSkills:
      'Skill files in the agents’ own folders (.claude/skills, .agents/skills, .opencode/skills) may be part of a task’s commits. Althar never puts them there itself; while this is off, a push with them is held back.',
    writeOpenSpec: 'Files in an openspec/ folder may be part of a task’s commits. While this is off, a push with them is held back.',
    pushProtected:
      'Those skill and OpenSpec files may be pushed with a task’s branch, each kind once its own switch above is on too. Neither of those allows pushing on its own.',
  },
  off: { writeSkills: 'Held back', writeOpenSpec: 'Held back', pushProtected: 'Blocked' },
  on: { writeSkills: 'In commits', writeOpenSpec: 'In commits', pushProtected: 'Allowed' },
  summary: (value) => {
    const kinds = [value.writeSkills ? 'skills' : null, value.writeOpenSpec ? 'OpenSpec' : null].filter((kind) => kind !== null)
    if (kinds.length === 0) return `Kept on ${device}`
    const named = kinds.join(' and ')
    const first = `${named.charAt(0).toUpperCase()}${named.slice(1)} in commits`
    return value.pushProtected ? `${first}, pushed` : `${first}, kept on ${device}`
  },
})

/** The words for a device with no name of its own. */
export const repositoryFilesText: RepositoryFilesText = repositoryFilesWords('this computer')

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
