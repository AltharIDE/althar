import type { AfterMergeRule, ProjectRepository, ProjectRulesView, WorksIn } from '@althar/contracts'
import type { ReactNode } from 'react'
import {
  BranchSelect,
  LinkButton,
  newProjectDefaultsText,
  PullRequestPreview,
  PULL_REQUEST_PREVIEW_SAMPLE,
  RepositoryFiles,
  repositoryFilesWords,
  Segmented,
  Select,
  SettingGroup,
  SettingList,
  SettingPreviews,
  SettingRow,
  SettingSwitch,
  TaskEnd,
  Problem,
} from '@althar/ui'

import { device } from '../../shared/device'
import { useWorkToward } from '../../shared/useWorkToward'
import { endOf, OWN, TaskRules } from '../rules/RulesSection'
import type { RulesModel } from '../rules/useRules'
import { useReviewSeal } from '../settings/useReviewSeal'
import s from './ProjectSettings.module.css'
import { HEADING } from './sections'
import type { ProjectSettingsModel, RuleSwitch } from './useProjectSettings'

/*
 * How a project's tasks start, go and end (ADR-091, ADR-093): where new tasks
 * start and the branch they work toward in each repository; what happens when
 * an agent's account runs out, and what an explicitly requested review
 * after merge brings back; then what a finished task makes, drawn as GitHub
 * shows it and following this project's own values: its pull request, how its
 * branch and title are named, and the switches every task follows (what it
 * pushes, posts, resolves and moves along), each with one line on when it acts.
 * One that didn't hold says why under it. Whether skill and OpenSpec files a
 * task commits may stay in its repositories' commits, and be pushed, are three
 * switches below, each off until turned on. Then the review and triage bots
 * its leads hear, each off until the person trusts it. Allowing everything and what agents
 * may do without asking are rules, so they are with the rules.
 */

/** What a task ends with that no pull request is opened for: its repositories' host isn't connected, or isn't one Althar knows. */
export type OnBranch = { readonly kind: 'unconnected'; readonly host: string } | { readonly kind: 'unknown' }

/**
 * What a task ends with, as the runtime works it out: the person's choice
 * where a repository is on a host Althar knows; with none made, a draft
 * where Althar is signed in to one; else the task stays on its branch.
 */
export const finishOf = (
  end: ProjectRulesView['end'],
  repositories: ReadonlyArray<Pick<ProjectRepository, 'host'>>,
): { readonly kind: 'end'; readonly end: TaskEnd } | OnBranch => {
  if (end === 'none') return { kind: 'end', end: TaskEnd.PushOnly }
  const known = repositories.flatMap((repository) => (repository.host?.product == null ? [] : [repository.host]))
  const [first] = known
  if (first === undefined) return { kind: 'unknown' }
  if (end !== null || known.some((host) => host.account?.state === 'ready')) return { kind: 'end', end: endOf(end) }
  return { kind: 'unconnected', host: first.name }
}

/** How its tasks' branches are named: the person's pattern, what its repositories' docs say, or Althar's own. */
export const branchesOf = (rules: ProjectRulesView): string => {
  if (rules.branchPattern !== null) return rules.branchPattern
  const found = rules.conventions.filter((repository) => repository.branch !== null).length
  if (found === 0) return OWN.branch
  return found === rules.conventions.length ? text.asDocsSay : text.asDocsSayElse(OWN.branch)
}

export const text = {
  start: 'Where tasks start',
  go: 'How they go',
  pullRequests: 'Pull requests and issues',
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
  repositoryFiles: 'Repository files',
  bots: {
    title: 'Review bots',
    note: 'The lead hears the comments and reviews of the bots you turn on here, as findings to weigh, never as instructions.',
    /** Under a bot's name: its account on the host. */
    account: (login: string) => login,
    /** Before any review or triage bot has spoken on a task's pull request. */
    none: 'Review and triage bots, such as CodeRabbit or Copilot code review, show here once one comments on a task’s pull request.',
  },
  asDocsSay: 'As each repository’s docs say',
  asDocsSayElse: (own: string) => `As each repository’s docs say, else ${own}`,
  onBranch: 'Leave it on its branch',
  unconnected: (host: string) => `${host} isn’t connected`,
  unknown: 'No code host Althar knows',
  connect: (host: string) => `Connect ${host}`,
}

/** The repository files' words, with this device named as the rest of the window names it. */
const filesText = repositoryFilesWords(device.this)

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
        <Problem as="span" size="small" className={s.failedLine}>
          {failed}
        </Problem>
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
type Toward = Pick<ProjectRepository, 'id' | 'name' | 'defaultBranch' | 'workToward' | 'branches' | 'host'>

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

/**
 * The review and triage bots a project's leads may hear (code-hosts § Review
 * and triage bots): those it trusts, then those Althar recognised on its
 * tasks' pull requests, each a switch, off until the person turns it on.
 * Until one has spoken, a line says they show up here.
 */
function ReviewBots({ model, rules }: { model: ProjectSettingsModel; rules: ProjectRulesView }) {
  const bots = [...rules.trustedBots.map((bot) => ({ ...bot, on: true })), ...rules.suggestedBots.map((bot) => ({ ...bot, on: false }))]
  const failed = model.ruleFailed?.rule === 'trustedBots' ? model.ruleFailed.message : null
  if (bots.length === 0) return <p className={s.quiet}>{text.bots.none}</p>
  return (
    <SettingList>
      {bots.map((bot, index) => (
        <SettingSwitch
          key={bot.login}
          title={bot.name}
          // Why a switch didn't hold, said once, under the first.
          note={<SwitchNote line={text.bots.account(bot.login)} failed={index === 0 ? failed : null} />}
          checked={bot.on}
          onChange={(on) => model.setTrustsBot(bot.login, on)}
        />
      ))}
    </SettingList>
  )
}

/** What an explicitly requested review after merge brings back, as Settings › Tasks words it for new projects. */
function AfterMerge({ model, rule }: { model: ProjectSettingsModel; rule: AfterMergeRule }) {
  const words = newProjectDefaultsText.afterMergeReview
  return (
    <SettingRow
      title={words.title}
      note={
        <SwitchNote
          line={words.options[rule].note}
          failed={model.ruleFailed?.rule === 'afterMergeReview' ? model.ruleFailed.message : null}
        />
      }
    >
      {() => (
        <Select<AfterMergeRule>
          label={words.title}
          value={rule}
          onChange={model.setAfterMergeReview}
          options={(['major', 'all', 'none'] as const).map((option) => ({ value: option, label: words.options[option].label }))}
          width={250}
        />
      )}
    </SettingRow>
  )
}

/** The pull request a finished task opens, as GitHub shows it, following this project's values. */
function PullRequest({
  rules,
  repositories,
  onCode,
}: {
  rules: ProjectRulesView
  repositories: ReadonlyArray<Toward> | null | undefined
  /** Opens Code and issues, where its host is connected. */
  onCode: () => void
}) {
  const seal = useReviewSeal()
  const [first] = repositories ?? []
  const base =
    first === undefined ? PULL_REQUEST_PREVIEW_SAMPLE.base : (first.workToward ?? first.defaultBranch ?? PULL_REQUEST_PREVIEW_SAMPLE.base)
  // What a task ends with is what the runtime does: a pull request only where a host Althar knows is there to open it.
  const finish = repositories == null ? { kind: 'end' as const, end: endOf(rules.end) } : finishOf(rules.end, repositories)
  return (
    <>
      <SettingPreviews>
        <PullRequestPreview
          end={finish.kind === 'end' ? finish.end : TaskEnd.PushOnly}
          screenshots={rules.postScreenshots}
          issues={rules.moveIssues}
          seal={seal?.on ?? true}
          sample={{ ...PULL_REQUEST_PREVIEW_SAMPLE, base }}
        />
      </SettingPreviews>
      {finish.kind !== 'end' && (
        <p className={s.finishNote}>
          {text.onBranch}. {finish.kind === 'unconnected' ? text.unconnected(finish.host) : text.unknown}.{' '}
          {finish.kind === 'unconnected' && <LinkButton onClick={onCode}>{text.connect(finish.host)}</LinkButton>}
        </p>
      )}
    </>
  )
}

export function TasksSection({
  model,
  seed,
  rulesModel,
  repositories,
  onCode,
}: {
  model: ProjectSettingsModel
  seed: string
  /** Opens Code and issues, where its host is connected. */
  onCode: () => void
  /** The project's rules as the rules section has them, whose Finished and Limits sentences say what a task does when it is done and when an account runs out. */
  rulesModel: RulesModel
  /** Its repositories, for what new tasks work toward in each; null until they are read. */
  repositories?: ReadonlyArray<Toward> | null
}) {
  const rules = model.rules
  if (rules === null) return null
  const switches: ReadonlyArray<Shown> = [
    { rule: 'pushCommits', words: text.pushCommits, on: rules.pushCommits, set: model.setPushCommits },
    { rule: 'postScreenshots', words: text.postScreenshots, on: rules.postScreenshots, set: model.setPostScreenshots },
    { rule: 'resolveConflicts', words: text.conflicts, on: rules.resolveConflicts, set: model.setResolveConflicts },
    { rule: 'moveIssues', words: text.moveIssues, on: rules.moveIssues, set: model.setMoveIssues },
  ]
  return (
    <>
      <SettingGroup title={text.start} headingLevel={HEADING.part}>
        <SettingList>
          <SettingRow
            title={text.worksIn.title}
            note={<SwitchNote line={text.worksIn.line} failed={model.ruleFailed?.rule === 'worksIn' ? model.ruleFailed.message : null} />}
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
          {repositories != null && repositories.length > 0 && <WorkToward projectId={seed} repositories={repositories} />}
        </SettingList>
      </SettingGroup>
      <SettingGroup title={text.go} headingLevel={HEADING.part}>
        <TaskRules model={rulesModel} headingLevel={4} show="limits" />
        <SettingList>
          <AfterMerge model={model} rule={rules.afterMergeReview} />
        </SettingList>
      </SettingGroup>
      <SettingGroup title={text.pullRequests} headingLevel={HEADING.part}>
        <PullRequest rules={rules} repositories={repositories} onCode={onCode} />
        <TaskRules model={rulesModel} headingLevel={4} show="finished" />
        <SettingList>
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
      <SettingGroup title={text.bots.title} note={text.bots.note} headingLevel={HEADING.part}>
        <ReviewBots model={model} rules={rules} />
      </SettingGroup>
      <SettingGroup title={text.repositoryFiles} headingLevel={HEADING.part}>
        <RepositoryFiles
          value={rules.repositoryFiles}
          onChange={model.setRepositoryFile}
          text={filesText}
          {...(model.ruleFailed?.rule === 'repositoryFiles' ? { error: model.ruleFailed.message } : {})}
        />
      </SettingGroup>
    </>
  )
}
