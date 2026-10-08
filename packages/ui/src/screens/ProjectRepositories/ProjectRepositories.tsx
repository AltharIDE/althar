import { ChangeTarget, RepositoryRole, SourceOrigin } from '../../foundations/vocabulary'
import { repositoryRoleText } from '../../foundations/vocabularyText'
import { Panel } from '../../primitives/Panel/Panel'
import { SourceMap, type SourceEntry, type SourceFinding } from '../../setup/SourceMap/SourceMap'
import s from './ProjectRepositories.module.css'

/*
 * A project's repositories after it is made: each one's place, branch and
 * remote, the role it plays, and for a fork, where its tasks open pull
 * requests. A folder adds the repositories it is or holds; one left out stays
 * with the tasks made with it, and nothing in its folder changes. The last
 * one stays, as tasks need somewhere to work. Each change is kept at once.
 */

export interface ProjectRepository {
  id: string
  name: string
  /** Where it is on this device, as the person would read it: ~/code/meridian-web. */
  where: string
  branch?: string
  remote?: string
  role: RepositoryRole
  /** The fork it is, by each one's path on its host, and where its pull requests open. */
  fork?: { fork: string; upstream: string; target: ChangeTarget }
  /** Tasks under way that change it. */
  tasks: number
}

export interface ProjectRepositoriesText {
  kicker: (project: string) => string
  title: string
  lede: string
  roles: Record<RepositoryRole, string>
  fork: (upstream: string) => string
  target: string
  targets: { upstream: (upstream: string) => string; fork: (fork: string) => string }
  tasks: (count: number) => string
  leaveOut: (name: string) => string
  add: string
  empty: string
  foot: string
}

export const projectRepositoriesText: ProjectRepositoriesText = {
  kicker: (project) => `${project} · repositories`,
  title: 'Repositories',
  lede: 'The ones its tasks may change. A task keeps the repositories it was made with.',
  roles: repositoryRoleText,
  fork: (upstream) => `Its remote is a fork of ${upstream}.`,
  target: 'Where tasks open pull requests',
  targets: {
    upstream: (upstream) => `Pull requests on ${upstream}`,
    fork: (fork) => `Pull requests on ${fork}`,
  },
  tasks: (count) =>
    count === 1
      ? 'A task under way changes it, and keeps it if it is left out.'
      : `${count} tasks under way change it, and keep it if it is left out.`,
  leaveOut: (name) => `Leave out ${name}`,
  add: 'Add a folder',
  empty: 'No repositories.',
  foot: 'Althar reads these folders and changes nothing in them. Tasks work in their own worktrees.',
}

const ROLES = [
  RepositoryRole.Service,
  RepositoryRole.Frontend,
  RepositoryRole.Infrastructure,
  RepositoryRole.Library,
  RepositoryRole.Docs,
  RepositoryRole.Other,
] as const

export interface ProjectRepositoriesProps {
  project: string
  repositories: readonly ProjectRepository[]
  onRoleChange: (id: string, role: RepositoryRole) => void
  onTargetChange: (id: string, target: ChangeTarget) => void
  /** Leaves one out; never offered for the last. */
  onLeaveOut: (id: string) => void
  /** Opens the system's folder picker. Without it, nothing is added here. */
  onAdd?: () => void
  /** Why the last change didn't happen. */
  error?: string
  className?: string
  text?: Partial<ProjectRepositoriesText>
}

const isRole = (value: string): value is RepositoryRole => (ROLES as readonly string[]).includes(value)
const isTarget = (value: string): value is ChangeTarget => value === ChangeTarget.Upstream || value === ChangeTarget.Fork

export function ProjectRepositories({
  project,
  repositories,
  onRoleChange,
  onTargetChange,
  onLeaveOut,
  onAdd,
  error,
  className,
  text,
}: ProjectRepositoriesProps) {
  const t = { ...projectRepositoriesText, ...text }
  const sources = repositories.map((repository): SourceEntry => {
    const findings: SourceFinding[] = []
    if (repository.fork)
      findings.push({
        id: 'fork',
        text: t.fork(repository.fork.upstream),
        choice: {
          label: t.target,
          options: [
            { value: ChangeTarget.Upstream, label: t.targets.upstream(repository.fork.upstream) },
            { value: ChangeTarget.Fork, label: t.targets.fork(repository.fork.fork) },
          ],
          value: repository.fork.target,
        },
      })
    if (repository.tasks > 0) findings.push({ id: 'tasks', text: t.tasks(repository.tasks) })
    return {
      id: repository.id,
      name: repository.name,
      where: repository.where,
      origin: SourceOrigin.Existing,
      ...(repository.branch === undefined ? {} : { branch: repository.branch }),
      ...(repository.remote === undefined ? {} : { remote: repository.remote }),
      role: repository.role,
      findings,
      fixed: repositories.length === 1,
    }
  })
  return (
    <Panel kicker={t.kicker(project)} title={t.title} lede={t.lede} foot={t.foot} className={className}>
      <SourceMap
        className={s.map}
        sources={sources}
        roles={ROLES.map((role) => ({ value: role, label: t.roles[role] }))}
        onRoleChange={(id, role) => {
          if (isRole(role)) onRoleChange(id, role)
        }}
        onFindingChange={(id, finding, value) => {
          if (finding === 'fork' && isTarget(value)) onTargetChange(id, value)
        }}
        onRemove={onLeaveOut}
        {...(onAdd === undefined ? {} : { onChooseFolders: onAdd })}
        text={{ label: t.title, remove: t.leaveOut, folders: t.add, empty: t.empty }}
      />
      {error !== undefined && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
    </Panel>
  )
}
