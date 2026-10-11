import { useEffect, useState } from 'react'

import type { ProjectRepository, RepositoryHost } from '@althar/contracts'
import { BackCrumb, ChangeTarget, HostReach, type MapHost, type MapRepository, RepositoryRole } from '@althar/ui'
import { ProjectRepositories, projectRepositoriesText } from '@althar/ui/screens'

import { device } from '../../shared/device'
import { shortFolder } from '../../shared/folders'
import { PartPending, pendingText } from '../../shared/Pending'
import { productBrand } from '../../shared/products'
import { ConnectDialog } from '../connections/ConnectDialog'
import type { ConnectionsModel } from '../connections/useConnections'
import s from './Repositories.module.css'
import type { RepositoriesModel } from './useRepositories'

/*
 * A project's repositories: where each is on this Mac and where its work
 * goes, its role, and for a fork, where its pull requests open. The kit's
 * screen; a folder is added through the system's picker or dropped on the
 * page, a host is connected over it, as from the project, and Escape goes
 * back to the project.
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

/** Escape goes back, unless it is closing something or someone is typing. */
const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, [role="textbox"]') !== null)

export function RepositoriesView({
  model,
  connections,
  onBack,
}: {
  model: RepositoriesModel
  /** The code hosts and trackers, for connecting one the work goes to. */
  connections: ConnectionsModel
  onBack: () => void
}) {
  const [connecting, setConnecting] = useState(false)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // A menu, a choice or the connections closing on Escape has it first, and says so.
      if (event.key !== 'Escape' || event.defaultPrevented || connecting || typing(event.target)) return
      event.preventDefault()
      onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack, connecting])
  const project = model.project ?? text.project
  return (
    <div className={s.window}>
      <main className={s.scroll}>
        {model.repositories === null ? (
          <div className={s.page}>
            <div className={s.back}>
              <BackCrumb to={project} kbd={projectRepositoriesText.backKey} onBack={onBack} />
            </div>
            {model.error === null ? (
              <PartPending label={pendingText.page} />
            ) : (
              <p className={s.error} role="alert">
                {model.error}
              </p>
            )}
          </div>
        ) : (
          <ProjectRepositories
            project={project}
            onBack={onBack}
            repositories={model.repositories.map(entryOf)}
            hosts={hostsOf(model.repositories)}
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
            onConnect={() => setConnecting(true)}
            {...(model.error === null ? {} : { error: model.error })}
            mapText={text.map}
          />
        )}
      </main>
      {connecting && <ConnectDialog model={connections} onClose={() => setConnecting(false)} />}
    </div>
  )
}
