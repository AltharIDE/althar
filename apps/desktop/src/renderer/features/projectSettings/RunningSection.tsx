import type { ProjectRepository, Runnable } from '@althar/contracts'
import { Button, Code, Icon, RepositorySetups, RunnableList, SettingGroup, SettingList, SettingRow } from '@althar/ui'

import { shortFolder } from '../../shared/folders'
import { listedOf, RunDialogs, useRunDialogs } from '../runs/Runs'
import s from './ProjectSettings.module.css'
import { HEADING } from './sections'
import { useSetups } from './useSetups'

/*
 * What a project runs with no agent (ADR-044), in the person's order, the
 * first at the top of Run's list and what an agent runs by default: reordered, made the default, changed
 * and removed in place, and added to in the same dialogs as from Run. Then
 * how each new task's folder gets ready before its lead starts (ADR-080): a
 * tab for each repository, its commands and the files copied from the
 * person's checkout, as a lead recorded them, changed in place. Then
 * where its tasks' work goes: their worktrees on this computer. How their
 * branches are named and what a task ends with are the project's Tasks.
 */

export const text = {
  runs: 'What it runs',
  runsNote: 'Run starts the first. Drag to change the order.',
  add: 'Add something to run',
  setups: 'Before each task starts',
  where: 'Where its work goes',
  worktrees: 'Worktrees',
  worktreesUnmade: 'Made with its first task',
}

export function RunningSection({
  projectId,
  project,
  runnables,
  repositories,
  worktrees,
}: {
  projectId: string
  /** The project's name, for the list's title. */
  project: string
  /** What it runs, in its order; null until its coordinator is read. */
  runnables: ReadonlyArray<Runnable> | null
  /** Its repositories, each with its host and whether Althar is signed in there, and its setup; null until they are read. */
  repositories: ReadonlyArray<Pick<ProjectRepository, 'id' | 'name' | 'path' | 'host' | 'setup'>> | null
  /** Where its tasks' worktrees are; null before it has had a task. */
  worktrees: string | null
}) {
  const dialogs = useRunDialogs(projectId)
  const setups = useSetups(projectId)
  const { runs } = dialogs
  const kept = runnables ?? []
  const ids = kept.map((one) => one.id)
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
      {repositories !== null && repositories.length > 0 && (
        <SettingGroup title={text.setups} headingLevel={HEADING.part}>
          <RepositorySetups
            repositories={repositories.map((repository) => ({
              id: repository.id,
              name: repository.name,
              checkout: repository.path === null ? null : shortFolder(repository.path),
              setup: setups.shown(repository.id, repository.setup),
            }))}
            onChange={setups.change}
            onClear={(id) => setups.change(id, null)}
            error={setups.failed ?? undefined}
          />
        </SettingGroup>
      )}
      <SettingGroup title={text.where} headingLevel={HEADING.part}>
        <SettingList>
          <SettingRow
            title={text.worktrees}
            note={worktrees === null ? text.worktreesUnmade : <Code className={s.code}>{shortFolder(worktrees)}</Code>}
            mark={<Icon name="folder" size={15} className={s.glyph} />}
          >
            {() => null}
          </SettingRow>
        </SettingList>
      </SettingGroup>
      <RunDialogs projectId={projectId} project={project} runnables={kept} dialogs={dialogs} afterEdit={null} />
    </>
  )
}
