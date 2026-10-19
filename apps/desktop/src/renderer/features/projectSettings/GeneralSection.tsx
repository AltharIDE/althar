import type { ProjectInk as Inks } from '@althar/contracts'
import {
  ProjectIdentity,
  type ProjectInk,
  RepositoryFiles,
  repositoryFilesWords,
  SettingGroup,
  SettingList,
  SettingSwitch,
} from '@althar/ui'

import { device } from '../../shared/device'

import { contractInk, kitInk } from '../../shared/inks'
import s from './ProjectSettings.module.css'
import { HEADING } from './sections'
import type { ProjectSettingsModel, RuleSwitch } from './useProjectSettings'

/*
 * What a project is, and how its tasks work: its name and the ink its mark
 * is drawn in, changed in place; then the switches every task follows, each
 * saying what happens with it on and, on a line of its own, with it off, for
 * someone who has never seen them. One that didn't hold says why under it.
 * Whether skill and OpenSpec files a task commits may stay in its
 * repositories' commits, and be pushed, are three switches below, each off
 * until turned on. Allowing everything is a rule, so it is with the rules.
 */

export const text = {
  tasks: 'How its tasks work',
  tasksNote: (project: string) => `For every task in ${project}, from its next step on.`,
  off: 'Off:',
  conflicts: {
    title: 'Resolve merge conflicts automatically',
    on: 'When the default branch moves on and a task’s change no longer merges cleanly, its lead brings the default branch into the task’s branch, fixes the clashing lines and runs the checks again, then tells you what it did.',
    off: 'the task says it conflicts, and waits until you ask its lead to fix it.',
  },
  moveIssues: {
    title: 'Move issues to In Progress',
    on: 'When a task starts from a Linear, Jira or Trello issue, Althar moves the issue to In Progress, so whoever looks at the tracker sees it’s being worked on. A Trello card goes to its board’s Doing or In progress list. GitHub and GitLab issues have no In Progress, so they stay as they are.',
    off: 'issues stay where they are, and you move them yourself.',
  },
  repositoryFiles: 'Repository files',
}

/** The repository files' words, with this device named as the rest of the window names it. */
const filesText = repositoryFilesWords(device.this)

/** A switch's note: what it does on, then what happens off, and why it didn't hold where it didn't. */
function SwitchNote({ on, off, failed }: { on: string; off: string; failed: string | null }) {
  return (
    <>
      {on}
      <span className={s.offLine}>
        <b className={s.off}>{text.off}</b> {off}
      </span>
      {failed !== null && (
        <span className={s.failedLine} role="alert">
          {failed}
        </span>
      )}
    </>
  )
}

/** A switch, in the order they are shown: its rule, its words, and how it stands. */
interface Shown {
  readonly rule: RuleSwitch
  readonly words: { readonly title: string; readonly on: string; readonly off: string }
  readonly on: boolean
  readonly set: (on: boolean) => void
}

export function GeneralSection({ model, seed }: { model: ProjectSettingsModel; seed: string }) {
  const name = model.name ?? ''
  const rules = model.rules
  // Another project's ink says whose it is, and can still be chosen.
  const taken: Partial<Record<ProjectInk, string>> = {}
  for (const [ink, project] of Object.entries(model.taken) as ReadonlyArray<[Inks, string | undefined]>)
    if (project !== undefined) taken[kitInk(ink)] = project
  const switches: ReadonlyArray<Shown> =
    rules === null
      ? []
      : [
          { rule: 'resolveConflicts', words: text.conflicts, on: rules.resolveConflicts, set: model.setResolveConflicts },
          { rule: 'moveIssues', words: text.moveIssues, on: rules.moveIssues, set: model.setMoveIssues },
        ]
  return (
    <>
      <ProjectIdentity
        name={name}
        seed={seed}
        ink={kitInk(model.ink ?? 'clay')}
        taken={taken}
        onRename={model.rename}
        onInk={(next) => model.setInk(contractInk(next))}
        {...(model.failed === null ? {} : { error: model.failed })}
      />
      {switches.length > 0 && (
        <SettingGroup title={text.tasks} note={text.tasksNote(name)} headingLevel={HEADING.part}>
          <SettingList>
            {switches.map((one) => (
              <SettingSwitch
                key={one.rule}
                title={one.words.title}
                note={
                  <SwitchNote
                    on={one.words.on}
                    off={one.words.off}
                    failed={model.ruleFailed?.rule === one.rule ? model.ruleFailed.message : null}
                  />
                }
                checked={one.on}
                onChange={one.set}
              />
            ))}
          </SettingList>
        </SettingGroup>
      )}
      {rules !== null && (
        <SettingGroup title={text.repositoryFiles} headingLevel={HEADING.part}>
          <RepositoryFiles
            value={rules.repositoryFiles}
            onChange={model.setRepositoryFile}
            text={filesText}
            {...(model.ruleFailed?.rule === 'repositoryFiles' ? { error: model.ruleFailed.message } : {})}
          />
        </SettingGroup>
      )}
    </>
  )
}
