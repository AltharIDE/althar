import { useState } from 'react'

import type { ConnectionList, ProjectRepository, Runnable } from '@althar/contracts'
import { RemoveProject, SettingsLayout, SettingsNav } from '@althar/ui'

import { shortFolder } from '../../shared/folders'
import { ConnectDialog, type Opening } from '../connections/ConnectDialog'
import type { ConnectionsModel } from '../connections/useConnections'
import type { Tracker } from '../project/front'
import { RulesSection } from '../rules/RulesSection'
import { type RulesModel, useRules } from '../rules/useRules'
import { CodeSection } from './CodeSection'
import { GeneralSection } from './GeneralSection'
import { NotesSection } from './NotesSection'
import { RunningSection } from './RunningSection'
import { HEADING, PROJECT_GROUPS, type ProjectSection, projectSectionText } from './sections'
import type { ProjectSettingsModel } from './useProjectSettings'

/*
 * A project's settings, as a view of the project under its front page, laid
 * out as Althar's own Settings are: down the side, its sections by what each
 * is about, a violet dot by Code and issues where a connection waits on the
 * person, and at the foot, apart and in red, taking the project out of
 * Althar, which asks first; beside them, the section open, on a sheet of
 * its own. Each change goes out at once, and one that didn't hold says why
 * where it was made. Connecting a code host or tracker opens over the page.
 */

export const text = {
  label: 'Project settings',
  remove: 'Remove from Althar…',
}

export interface ProjectSettingsPageProps {
  readonly projectId: string
  readonly model: ProjectSettingsModel
  /** The section open. */
  readonly section: ProjectSection
  readonly onSection: (section: ProjectSection) => void
  readonly connections: ConnectionsModel
  /** The trackers its tasks' issues are on, the one most of them name first. */
  readonly trackers: ReadonlyArray<Tracker>
  /** Its repositories, each with the host its work goes to and whether Althar is signed in there; null until they are read. */
  readonly repositories: ReadonlyArray<Pick<ProjectRepository, 'host'>> | null
  /** Something its work goes to waits on the person: a dot beside Code and issues. */
  readonly connectionsNeedYou: boolean
  /** What it runs, in its order; null until its coordinator is read. */
  readonly runnables: ReadonlyArray<Runnable> | null
  /** Althar's own settings, at its code hosts and trackers, where connections are managed. */
  readonly onConnections: () => void
}

export function ProjectSettingsPage({
  projectId,
  model,
  section,
  onSection,
  connections,
  trackers,
  repositories,
  connectionsNeedYou,
  runnables,
  onConnections,
}: ProjectSettingsPageProps) {
  const [connecting, setConnecting] = useState<Opening | null>(null)
  // Here, not in the rules' section, so a change on its way outlasts a look at another section.
  const rules = useRules(projectId)
  const open = projectSectionText[section]
  const project = model.project
  return (
    <>
      <SettingsLayout
        section={section}
        title={open.title}
        {...(open.lede === undefined ? {} : { lede: open.lede })}
        headingLevel={HEADING.title}
        side={
          <SettingsNav
            label={text.label}
            groups={PROJECT_GROUPS.map((group) =>
              group.map((id) => ({
                id,
                title: projectSectionText[id].title,
                icon: projectSectionText[id].icon,
                ...(id === 'code' && connectionsNeedYou ? { yours: true } : {}),
              })),
            )}
            value={section}
            onChange={onSection}
            action={{ title: text.remove, icon: 'close', danger: true, onSelect: model.askRemove }}
          />
        }
      >
        <SectionBody
          section={section}
          projectId={projectId}
          model={model}
          rules={rules}
          trackers={trackers}
          repositories={repositories}
          list={connections.list}
          runnables={runnables}
          onSection={onSection}
          onConnect={setConnecting}
          onConnections={onConnections}
        />
      </SettingsLayout>
      {connecting !== null && <ConnectDialog model={connections} opening={connecting} onClose={() => setConnecting(null)} />}
      {model.removing && project !== null && (
        <RemoveProject
          project={project.name}
          working={project.working}
          worktrees={project.worktrees === null ? null : shortFolder(project.worktrees)}
          busy={model.busy}
          {...(model.error === null ? {} : { error: model.error })}
          onRemove={() => void model.remove()}
          onClose={model.closeRemove}
        />
      )}
    </>
  )
}

/** What is in the section open. */
function SectionBody({
  section,
  projectId,
  model,
  rules,
  trackers,
  repositories,
  list,
  runnables,
  onSection,
  onConnect,
  onConnections,
}: Pick<
  ProjectSettingsPageProps,
  'section' | 'projectId' | 'model' | 'trackers' | 'repositories' | 'runnables' | 'onSection' | 'onConnections'
> & {
  rules: RulesModel
  list: ConnectionList | null
  onConnect: (opening: Opening) => void
}) {
  switch (section) {
    case 'general':
      return <GeneralSection model={model} seed={projectId} />
    case 'code':
      return <CodeSection projectId={projectId} trackers={trackers} list={list} onConnect={onConnect} onManage={onConnections} />
    case 'rules':
      return <RulesSection model={rules} />
    case 'running':
      return (
        <RunningSection
          projectId={projectId}
          project={model.name ?? ''}
          runnables={runnables}
          rules={model.rules}
          repositories={repositories}
          worktrees={model.project?.worktrees ?? null}
          onRules={() => onSection('rules')}
          onCode={() => onSection('code')}
        />
      )
    case 'notes':
      return <NotesSection model={model} />
  }
}
