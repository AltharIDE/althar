import type { ConnectionList, ProjectRepository, RepositoryHost } from '@althar/contracts'
import { ChangeTarget, HostReach, type MapHost, type MapRepository, RepositoryRole } from '@althar/ui'
import { ProjectRepositories } from '@althar/ui/screens'

import { device } from '../../shared/device'
import { shortFolder } from '../../shared/folders'
import { PartPending, pendingText } from '../../shared/Pending'
import { productBrand } from '../../shared/products'
import { type Opening, openingFor } from '../connections/ConnectDialog'
import { HEADING } from '../projectSettings/sections'
import s from './Repositories.module.css'
import type { RepositoriesModel } from './useRepositories'

/*
 * A project's repositories, in its settings: where each is on this computer
 * and where its work goes, its role, and for a fork, where its pull requests
 * open. The kit's part; a folder is added through the system's picker or
 * dropped on it, and a host its work goes to is connected over the page, as
 * the section connects a tracker.
 */

export const text = {
  /** The project, where its name isn't known. */
  project: 'The project',
  /** The kit's words for this computer. */
  map: {
    here: `On ${device.this}`,
    elsewhere: `Not on ${device.this}`,
    stays: `Stays on ${device.this}`,
    staysHere: `Its work stays on ${device.this}.`,
  },
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

/** A host by what its repositories share: the code host and its instance, or, for one Althar doesn't know, its address. */
const hostId = (host: RepositoryHost) => `${host.product ?? 'elsewhere'}:${host.instance ?? host.name}`

/** Whether Althar reaches the host, as the person's sign-in there stands. */
const reachOf = (host: RepositoryHost): HostReach =>
  host.product === null
    ? HostReach.Unknown
    : host.account === null
      ? HostReach.NotConnected
      : host.account.state === 'ready'
        ? HostReach.Connected
        : HostReach.SignInAgain

/** A repository as the kit's map draws it. */
export const entryOf = (repository: ProjectRepository): MapRepository => ({
  id: repository.id,
  name: repository.name,
  ...(repository.path === null
    ? {}
    : { where: shortFolder(repository.folder === null ? repository.path : `${repository.path}/${repository.folder}`) }),
  ...(repository.branch === null ? {} : { branch: repository.branch }),
  role: ROLES[repository.role],
  tasks: repository.tasks,
  ...(repository.host === null
    ? {}
    : {
        remote: {
          host: hostId(repository.host),
          path: repository.host.path,
          ...(repository.host.url === null ? {} : { href: repository.host.url }),
        },
        ...(repository.fork === null ? {} : { fork: { upstream: repository.fork.upstream, target: TARGETS[repository.fork.target] } }),
      }),
})

/** The hosts the repositories' work goes to, each once, in the order their repositories come. */
export const hostsOf = (repositories: ReadonlyArray<ProjectRepository>): MapHost[] =>
  repositories.flatMap((repository, index) => {
    const host = repository.host
    if (host === null) return []
    const id = hostId(host)
    if (repositories.slice(0, index).some((before) => before.host !== null && hostId(before.host) === id)) return []
    return [
      {
        id,
        name: host.name,
        ...(host.product === null ? {} : { brand: productBrand(host.product) }),
        ...(host.instance === null ? {} : { instance: host.instance }),
        reach: reachOf(host),
        ...(host.account === null ? {} : { account: host.account.login }),
      },
    ]
  })

export function Repositories({
  model,
  connections,
  onConnect,
}: {
  model: RepositoriesModel
  /** The code hosts and trackers connected, for what connecting a host opens on. */
  connections: ConnectionList | null
  /** Connects a host the work goes to, over the page: its walk in, or all of them where it is connected. */
  onConnect: (opening: Opening) => void
}) {
  const repositories = model.repositories
  if (repositories === null)
    return model.error === null ? (
      <PartPending label={pendingText.page} />
    ) : (
      <p className={s.error} role="alert">
        {model.error}
      </p>
    )
  return (
    <ProjectRepositories
      project={model.project ?? text.project}
      repositories={repositories.map(entryOf)}
      hosts={hostsOf(repositories)}
      reading={model.reading}
      {...(model.worktrees === null ? {} : { worktrees: model.worktrees })}
      adding={model.adding}
      onRoleChange={model.setRole}
      onTargetChange={model.setTarget}
      onLeaveOut={(id) => void model.leaveOut(id)}
      onAdd={() => void model.add()}
      onDrop={(files) => void model.addDropped(files)}
      // The window opens web pages in the person's browser.
      onOpen={(href) => void window.open(href, '_blank')}
      onConnect={(id) => {
        const host = repositories
          .flatMap((repository) => (repository.host === null ? [] : [repository.host]))
          .find((one) => hostId(one) === id)
        const product = host?.product ?? null
        onConnect(host === undefined || product === null ? 'all' : openingFor(connections, product, host.instance))
      }}
      {...(model.error === null ? {} : { error: model.error })}
      headingLevel={HEADING.part}
      mapText={text.map}
    />
  )
}
