import type { ProjectRepository, ProjectRulesView, Runnable } from '@althar/contracts'
import { Button, Icon, LinkButton, RunnableList, SettingGroup, SettingList, SettingRow, TaskEnd } from '@althar/ui'
import { projectRulesText } from '@althar/ui/screens'

import { device } from '../../shared/device'
import { shortFolder } from '../../shared/folders'
import { endOf, OWN } from '../rules/RulesSection'
import { listedOf, RunDialogs, useRunDialogs } from '../runs/Runs'
import { HEADING } from './sections'

/*
 * What a project runs with no agent (ADR-044), in the person's order, the
 * first what one press of Run starts: reordered, made the default, changed
 * and removed in place, and added to in the same dialogs as from Run. Then
 * where its tasks' work goes: their worktrees on this computer, how their
 * branches are named and what a task ends with, the last two kept with the
 * rules, where they are changed. What a task ends with is what the runtime
 * does: a pull request only where a host Althar knows is there to open it.
 */

export const text = {
  runs: 'What it runs',
  runsNote:
    'With no agent, from Run at the top of its screen. Drag them into the order you want: the first is what one press of Run starts.',
  add: 'Add something to run',
  where: 'Where its work goes',
  whereNote: `Each task works on a branch of its own, in a worktree of its own on ${device.this}.`,
  worktrees: 'Worktrees',
  worktreesUnmade: 'Made with its first task, never in its repositories’ own folders',
  branches: 'Branches',
  asDocsSay: 'As each repository’s docs say',
  asDocsSayElse: (own: string) => `As each repository’s docs say, else ${own}`,
  finish: 'When a task is done',
  inRules: 'Change in Rules',
  onBranch: 'Leave it on its branch',
  unconnected: (host: string) => `Nothing goes to ${host} until Althar is connected there. Then it opens a draft pull request`,
  unknown: 'Its repositories are on no host Althar knows, so no pull request opens',
  connect: (host: string) => `Connect ${host}`,
}

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

export function RunningSection({
  projectId,
  project,
  runnables,
  rules,
  repositories,
  worktrees,
  onRules,
  onCode,
}: {
  projectId: string
  /** The project's name, for the list's title. */
  project: string
  /** What it runs, in its order; null until its coordinator is read. */
  runnables: ReadonlyArray<Runnable> | null
  rules: ProjectRulesView | null
  /** Its repositories, each with its host and whether Althar is signed in there; null until they are read. */
  repositories: ReadonlyArray<Pick<ProjectRepository, 'host'>> | null
  /** Where its tasks' worktrees are; null before it has had a task. */
  worktrees: string | null
  /** Opens the rules, where branches and how a task ends are changed. */
  onRules: () => void
  /** Opens Code and issues, where its host is connected. */
  onCode: () => void
}) {
  const dialogs = useRunDialogs(projectId)
  const { runs } = dialogs
  const kept = runnables ?? []
  const ids = kept.map((one) => one.id)
  const finish = rules === null || repositories === null ? null : finishOf(rules.end, repositories)
  return (
    <>
      <SettingGroup
        title={text.runs}
        headingLevel={HEADING.part}
        note={text.runsNote}
        action={
          <Button size="small" icon="plus" onClick={() => dialogs.show({ kind: 'add', way: 'type' })}>
            {text.add}
          </Button>
        }
      >
        <RunnableList
          runnables={kept.map(listedOf)}
          onOrder={(next) => void runs.order(next)}
          onDefault={(id) => void runs.order([id, ...ids.filter((one) => one !== id)])}
          onEdit={(id) => dialogs.show({ kind: 'edit', id })}
          onRemove={(id) => void runs.drop(id)}
          // What went wrong in a dialog is said in it; here, only what went wrong in the list.
          {...(dialogs.showing === null && runs.error !== null ? { error: runs.error } : {})}
        />
      </SettingGroup>
      <SettingGroup title={text.where} note={text.whereNote} headingLevel={HEADING.part}>
        <SettingList>
          <SettingRow
            title={text.worktrees}
            note={worktrees === null ? text.worktreesUnmade : shortFolder(worktrees)}
            glyph={<Icon name="folder" size={15} />}
          >
            {() => null}
          </SettingRow>
          {rules !== null && (
            <SettingRow title={text.branches} note={branchesOf(rules)} glyph={<Icon name="branch" size={15} />}>
              {() => <LinkButton onClick={onRules}>{text.inRules}</LinkButton>}
            </SettingRow>
          )}
          {finish !== null && (
            <SettingRow title={text.finish} note={finishNote(finish)} glyph={<Icon name="pr" size={15} />}>
              {() =>
                finish.kind === 'unconnected' ? (
                  <LinkButton onClick={onCode}>{text.connect(finish.host)}</LinkButton>
                ) : (
                  <LinkButton onClick={onRules}>{text.inRules}</LinkButton>
                )
              }
            </SettingRow>
          )}
        </SettingList>
      </SettingGroup>
      <RunDialogs projectId={projectId} project={project} runnables={kept} dialogs={dialogs} afterEdit={null} />
    </>
  )
}

/** What a task ends with, in a line: the rules' words for it, or why it stays on its branch. */
const finishNote = (finish: ReturnType<typeof finishOf>): string => {
  switch (finish.kind) {
    case 'end': {
      const worded = projectRulesText.finished.end[finish.end]
      return `${worded.title}. ${worded.note}.`
    }
    case 'unconnected':
      return `${text.onBranch}. ${text.unconnected(finish.host)}.`
    case 'unknown':
      return `${text.onBranch}. ${text.unknown}.`
  }
}
