import type { ProjectInk as Inks } from '@althar/contracts'
import type { ReactNode } from 'react'
import { LinkButton, ProjectIdentity, type ProjectInk, SettingGroup, SettingList, SettingSwitch } from '@althar/ui'

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
    /** Looks at every open task now, rather than as each default branch moves. */
    look: 'Look for conflicts now',
    looking: 'Looking at each open task now.',
  },
  pushCommits: {
    title: 'Push the lead’s commits automatically',
    line: 'When a lead’s turn ends, what it committed goes up to its pull request, even after you’ve looked. If someone else pushed there, it waits for you.',
  },
  moveIssues: {
    title: 'Move issues along with their tasks',
    line: 'To In Progress when a task starts from an issue; to In Review and Done as its pull request opens and merges.',
  },
  changeIssues: {
    title: 'Change issues without asking',
    line: 'Status, priority, assignee, labels and closing apply at once, instead of waiting for you on a card.',
  },
}

/** A switch's note: when it acts, what it does now where it can, and why it didn't hold where it didn't. */
function SwitchNote({ line, now, failed }: { line: string; now?: ReactNode; failed: string | null }) {
  return (
    <>
      {line}
      {now !== undefined && <> {now}</>}
      {failed !== null && (
        <span className={s.failedLine} role="alert">
          {failed}
        </span>
      )}
    </>
  )
}

/** Turned on, conflicts are looked for as default branches move; this looks at every open task now. */
function LookNow({ model }: { model: ProjectSettingsModel }) {
  if (model.looked === 'asked') return <>{text.conflicts.looking}</>
  return <LinkButton onClick={model.lookForConflicts}>{text.conflicts.look}</LinkButton>
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
          { rule: 'pushCommits', words: text.pushCommits, on: rules.pushCommits, set: model.setPushCommits },
          { rule: 'moveIssues', words: text.moveIssues, on: rules.moveIssues, set: model.setMoveIssues },
          { rule: 'changeIssues', words: text.changeIssues, on: rules.changeIssues, set: model.setChangeIssues },
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
                note={
                  <SwitchNote
                    line={one.words.line}
                    {...(one.rule === 'resolveConflicts' && one.on ? { now: <LookNow model={model} /> } : {})}
                    failed={
                      model.ruleFailed?.rule === one.rule
                        ? model.ruleFailed.message
                        : one.rule === 'resolveConflicts' && model.looked !== null && model.looked !== 'asked'
                          ? model.looked.failed
                          : null
                    }
                  />
                }
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
