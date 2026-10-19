import type { ProjectInk as Inks } from '@althar/contracts'
import { ProjectIdentity, type ProjectInk, SettingGroup, SettingList, SettingSwitch } from '@althar/ui'

import { contractInk, kitInk } from '../../shared/inks'
import s from './ProjectSettings.module.css'
import { HEADING } from './sections'
import type { ProjectSettingsModel, RuleSwitch } from './useProjectSettings'

/*
 * What a project is, and how its tasks work: its name and the ink its mark
 * is drawn in, changed in place; then the switches every task follows, each
 * with one line on when it acts. One that didn't hold says why under it.
 * Allowing everything is a rule, so it is with the rules.
 */

export const text = {
  tasks: 'Tasks',
  conflicts: {
    title: 'Resolve merge conflicts automatically',
    line: 'When a task’s branch stops merging cleanly, its lead fixes it and runs the checks again.',
  },
  moveIssues: {
    title: 'Move issues to In Progress',
    line: 'When a task starts from a Linear, Jira or Trello issue.',
  },
}

/** A switch's note: when it acts, and why it didn't hold where it didn't. */
function SwitchNote({ line, failed }: { line: string; failed: string | null }) {
  return (
    <>
      {line}
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
  readonly words: { readonly title: string; readonly line: string }
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
        <SettingGroup title={text.tasks} headingLevel={HEADING.part}>
          <SettingList>
            {switches.map((one) => (
              <SettingSwitch
                key={one.rule}
                title={one.words.title}
                note={<SwitchNote line={one.words.line} failed={model.ruleFailed?.rule === one.rule ? model.ruleFailed.message : null} />}
                checked={one.on}
                onChange={one.set}
              />
            ))}
          </SettingList>
        </SettingGroup>
      )}
    </>
  )
}
