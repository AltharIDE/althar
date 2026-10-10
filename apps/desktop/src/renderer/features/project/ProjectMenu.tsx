import { ProjectMenu as Menu, ProjectMenuItems, RemoveProject, RenameProject } from '@althar/ui'

import { shortFolder } from '../../shared/folders'
import type { ProjectMenuModel } from './useProjectMenu'

/*
 * A project's menu on its bar, the same items in the head of its
 * conversation, and the dialogs they open: rename, its repositories, its
 * rules, and removing it from Althar.
 */

export interface ProjectMenuActions {
  readonly model: ProjectMenuModel
  readonly onRepositories: () => void
  readonly onMemory?: () => void
  readonly onRules: () => void
}

/** What the kit's menu takes, from the model and the places it opens. */
const itemsOf = ({ model, onRepositories, onRules, onMemory }: ProjectMenuActions) => ({
  ...(model.project === null ? {} : { repositories: model.project.repositories.length }),
  onRename: () => model.ask('rename'),
  onRepositories,
  onRules,
  ...(onMemory === undefined ? {} : { onMemory }),
  onRemove: () => model.ask('remove'),
})

/** The bar's menu. */
export function ProjectMenu(actions: ProjectMenuActions) {
  return <Menu {...itemsOf(actions)} />
}

/** The same items, for another menu: the head of the project's conversation. */
export function ProjectItems(actions: ProjectMenuActions) {
  return <ProjectMenuItems {...itemsOf(actions)} />
}

/** The dialog the menu opened, if one is. */
export function ProjectDialogs({ model }: { model: ProjectMenuModel }) {
  const { project, dialog } = model
  if (project === null || dialog === null) return null
  const failed = model.error === null ? {} : { error: model.error }
  return dialog === 'rename' ? (
    <RenameProject name={project.name} busy={model.busy} {...failed} onRename={(name) => void model.rename(name)} onClose={model.close} />
  ) : (
    <RemoveProject
      project={project.name}
      working={project.working}
      worktrees={project.worktrees === null ? null : shortFolder(project.worktrees)}
      busy={model.busy}
      {...failed}
      onRemove={() => void model.remove()}
      onClose={model.close}
    />
  )
}
