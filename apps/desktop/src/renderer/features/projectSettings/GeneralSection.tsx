import type { ProjectInk as Inks, ProjectRepository, WorksIn } from '@althar/contracts'
import type { ReactNode } from 'react'
import {
  BranchSelect,
  LinkButton,
  ProjectIdentity,
  type ProjectInk,
  Segmented,
  SettingGroup,
  SettingList,
  SettingRow,
  SettingSwitch,
} from '@althar/ui'

import { contractInk, kitInk } from '../../shared/inks'
import s from './ProjectSettings.module.css'
import { HEADING } from './sections'
import type { ProjectSettingsModel, RuleSwitch } from './useProjectSettings'
import { useWorkToward } from '../../shared/useWorkToward'

/*
 * What a project is, and how its tasks work: its name and the ink its mark
 * is drawn in, changed in place; then where new tasks start (ADR-091), the
 * branch they work toward in each repository (ADR-093), and
 * the switches every task follows, each with one line on when it acts. One
 * that didn't hold says why under it. Allowing everything and what agents may
 * do without asking are rules, so they are with the rules.
 */

export const text = {
  tasks: 'Tasks',
  worksIn: {
    title: 'New tasks start in',
    local: 'Local',
    worktree: 'Worktree',
    /** One line for both, which stays put as the choice flips: what each gives up. */
    line: 'Local works in your own checkout, with your builds, simulators and services: one task at a time, beside your own edits. A worktree gives each task a copy of its own, side by side, that builds from cold.',
  },
  workToward: {
    title: 'Work toward',
    /** In a project of several repositories, one row each. */
    titleIn: (repository: string) => `Work toward in ${repository}`,
    line: 'New tasks start from this branch, and their pull requests go into it. Run runs it too.',
    /** Under its list: what changing it leaves as it is. */
    keeps: 'Tasks already made keep theirs. A name it doesn’t have is made from the default branch.',
  },
  conflicts: {
    title: 'Resolve merge conflicts automatically',
    /** Looks at every open task now, rather than as each default branch moves. */
    look: 'Look for conflicts now',
    looking: 'Looking…',
  },
  pushCommits: {
    title: 'Push the lead’s commits automatically',
    line: 'When a lead’s turn ends, what it committed goes up to its pull request, even after you’ve looked. If someone else pushed there, it waits for you.',
  },
  postScreenshots: {
    title: 'Post screenshots to pull requests automatically',
    line: 'A task’s Outputs screenshots go in one comment on its pull request, updated as they change. Off, you post them from Outputs.',
  },
  moveIssues: {
    title: 'Move issues along with their tasks',
    line: 'To In Progress, In Review, then Done',
  },
}

/** A switch's note: when it acts, what it does now where it can, and why it didn't hold where it didn't. */
function SwitchNote({ line, now, failed }: { line?: string; now?: ReactNode; failed: string | null }) {
  return (
    <>
      {line}
      {now !== undefined && (
        <>
          {line === undefined ? '' : ' '}
          {now}
        </>
      )}
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
  readonly words: { readonly title: string; readonly line?: string }
  readonly on: boolean
  readonly set: (on: boolean) => void
}

/** A repository as Work toward reads it: its default branch, the branch kept, and the remote's branches. */
type Toward = Pick<ProjectRepository, 'id' | 'name' | 'defaultBranch' | 'workToward' | 'branches'>

/** The branch a repository's new tasks work toward: a row each, its default first in the list. */
function WorkToward({ projectId, repositories }: { projectId: string; repositories: ReadonlyArray<Toward> }) {
  const toward = useWorkToward(projectId)
  return repositories.map((repository) => {
    const fallback = repository.defaultBranch ?? 'main'
    const branches = repository.branches ?? [fallback]
    const shown = toward.shown(repository.id, repository.workToward ?? null) ?? fallback
    const title = repositories.length > 1 ? text.workToward.titleIn(repository.name) : text.workToward.title
    return (
      <SettingRow
        key={repository.id}
        title={title}
        note={
          <SwitchNote line={text.workToward.line} failed={toward.failed?.repositoryId === repository.id ? toward.failed.message : null} />
        }
      >
        {() => (
          <BranchSelect
            label={title}
            variant="filled"
            value={shown}
            branches={branches}
            defaultBranch={fallback}
            onChange={(next) => toward.change(repository.id, next === fallback ? null : next)}
            onCreate={(name) => toward.create(repository.id, name)}
            note={text.workToward.keeps}
            className={s.branch}
          />
        )}
      </SettingRow>
    )
  })
}

export function GeneralSection({
  model,
  seed,
  repositories,
}: {
  model: ProjectSettingsModel
  seed: string
  /** Its repositories, for what new tasks work toward in each; null until they are read. */
  repositories?: ReadonlyArray<Toward> | null
}) {
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
          { rule: 'postScreenshots', words: text.postScreenshots, on: rules.postScreenshots, set: model.setPostScreenshots },
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
            {rules !== null && (
              <SettingRow
                title={text.worksIn.title}
                note={
                  <SwitchNote line={text.worksIn.line} failed={model.ruleFailed?.rule === 'worksIn' ? model.ruleFailed.message : null} />
                }
              >
                {() => (
                  <Segmented<WorksIn>
                    label={text.worksIn.title}
                    value={rules.worksIn}
                    onChange={model.setWorksIn}
                    options={[
                      { value: 'checkout', label: text.worksIn.local },
                      { value: 'worktree', label: text.worksIn.worktree },
                    ]}
                  />
                )}
              </SettingRow>
            )}
            {repositories != null && repositories.length > 0 && <WorkToward projectId={seed} repositories={repositories} />}
            {switches.map((one) => (
              <SettingSwitch
                key={one.rule}
                title={one.words.title}
                note={
                  <SwitchNote
                    {...(one.words.line === undefined ? {} : { line: one.words.line })}
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
