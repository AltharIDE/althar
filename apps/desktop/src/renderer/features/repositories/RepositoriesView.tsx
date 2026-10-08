import type { ProjectRepository } from '@althar/contracts'
import { BackCrumb, ChangeTarget, RepositoryRole, TitleBar } from '@althar/ui'
import { type ProjectRepository as RepositoryEntry, ProjectRepositories } from '@althar/ui/screens'

import { shortFolder } from '../../shared/folders'
import { PartPending, pendingText } from '../../shared/Pending'
import s from './Repositories.module.css'
import type { RepositoriesModel } from './useRepositories'

/*
 * A project's repositories: each one's place, branch and remote, its role,
 * and for a fork, where its tasks open pull requests. The kit's screen; a
 * folder is added through the system's picker.
 */

export const text = {
  back: 'Back to the project',
  /** One not on this Mac. */
  elsewhere: 'Not on this Mac',
}

const ROLES: Readonly<Record<ProjectRepository['role'], RepositoryRole>> = {
  service: RepositoryRole.Service,
  frontend: RepositoryRole.Frontend,
  infrastructure: RepositoryRole.Infrastructure,
  library: RepositoryRole.Library,
  docs: RepositoryRole.Docs,
  other: RepositoryRole.Other,
}

const TARGETS = { upstream: ChangeTarget.Upstream, fork: ChangeTarget.Fork } as const

/** A repository as the kit's screen draws it. */
export const entryOf = (repository: ProjectRepository): RepositoryEntry => ({
  id: repository.id,
  name: repository.name,
  where:
    repository.path === null
      ? text.elsewhere
      : shortFolder(repository.folder === null ? repository.path : `${repository.path}/${repository.folder}`),
  ...(repository.branch === null ? {} : { branch: repository.branch }),
  ...(repository.remote === null ? {} : { remote: repository.remote }),
  role: ROLES[repository.role],
  ...(repository.fork === null
    ? {}
    : { fork: { fork: repository.fork.fork, upstream: repository.fork.upstream, target: TARGETS[repository.fork.target] } }),
  tasks: repository.tasks,
})

export function RepositoriesView({ model, onBack }: { model: RepositoriesModel; onBack: () => void }) {
  return (
    <div className={s.window}>
      <TitleBar lights="none">
        <BackCrumb to={model.project ?? text.back} onBack={onBack} />
      </TitleBar>
      <main className={s.scroll}>
        {model.repositories === null ? (
          model.error === null ? (
            <PartPending label={pendingText.page} />
          ) : (
            <p className={s.error} role="alert">
              {model.error}
            </p>
          )
        ) : (
          <ProjectRepositories
            project={model.project ?? ''}
            repositories={model.repositories.map(entryOf)}
            onRoleChange={model.setRole}
            onTargetChange={model.setTarget}
            onLeaveOut={(id) => void model.leaveOut(id)}
            onAdd={() => void model.add()}
            {...(model.error === null ? {} : { error: model.error })}
            className={s.repositories}
          />
        )}
      </main>
    </div>
  )
}
