import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import type { ConnectionList, ConnectionSummary, Product, RepositoryOwner, Service } from '@althar/contracts'
import { type Brand, type HostedRepository, type SetupHost, type SetupLimited, type SetupStatus, type SetupWay } from '@althar/ui'
import { repositoryFolder } from '@althar/ui/screens'

import { canCall } from '../../data/client'
import { reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { thingOf, useHostRepositories } from '../../shared/hostRepositories'
import { productBrand } from '../../shared/products'
import { changesOn, hostnameOf, remoteOf } from '../../shared/remotes'
import { serviceBrand, serviceName, serviceOfProduct } from '../connections/ways'
import { useHomeName } from '../homes/useHomes'
import { type Draft, type DraftClone, type DraftHome, type DraftIssues, type DraftPlan, type DraftStore, sameRepository } from './draft'

/*
 * The setup a new project's page shows beside its name, worked out from its
 * draft and what Althar is connected to: the three ways its code comes in,
 * your repositories on the code hosts connected, where its code lives and
 * where its issues go, each with a choice made already that fits what else
 * is chosen, and what Create will do, said in a line. The first run's
 * welcome shows the same, a step at a time.
 */

/** The trackers a project's issues can go to, beside its code host's own. */
const TRACKER_SERVICES: ReadonlyArray<Service> = ['linear', 'jira', 'trello', 'clickup']

/** A code host's own issues, where Althar takes them: GitHub's and GitLab's. Bitbucket's are rarely where a team keeps them. */
const issuesOf = (product: Product | null) => (product === 'github' ? 'GitHub Issues' : product === 'gitlab' ? 'GitLab issues' : null)

/** How the setup reads, for the page: each part, what is chosen, and what Create does. */
export interface SetupModel {
  readonly way: SetupWay
  readonly hosts: ReadonlyArray<SetupHost>
  /** Null while they're read; all the hosts' together. */
  readonly repositories: ReadonlyArray<HostedRepository> | null
  readonly failed: ReadonlyArray<string>
  /** The hosts that list fewer repositories than their account has. */
  readonly limited: ReadonlyArray<SetupLimited>
  readonly pasted: HostedRepository | null
  /** The repositories chosen to clone, by their rows. */
  readonly chosen: ReadonlyArray<string>
  /** The repositories chosen to clone, in the order chosen, and where each goes. */
  readonly clones: ReadonlyArray<DraftClone & { readonly where: string | null; readonly brand: Brand | null }>
  /** A host being connected in place, by its service. */
  readonly connecting: Service | null
  /** Where its code lives: picked, for a repository only here; fixed, for a clone or one on a host already; nothing, for several. */
  readonly home:
    | { readonly kind: 'none' }
    | { readonly kind: 'fixed'; readonly brand: Brand | null; readonly said: string }
    | {
        readonly kind: 'picks'
        readonly value: string
        readonly connected: ReadonlyArray<{ readonly id: string; readonly name: string; readonly brand: Brand; readonly thing: string }>
        readonly away: ReadonlyArray<{ readonly service: Service; readonly name: string; readonly brand: Brand; readonly thing: string }>
        readonly owners: ReadonlyArray<RepositoryOwner> | null
        /** Where it can go couldn't be read: said at its name, with a way to read it again. */
        readonly ownersFailed: boolean
        readonly retryOwners: () => void
        readonly owner: string | null
        readonly name: string
        readonly private: boolean
      }
  readonly issues: {
    readonly value: string
    readonly host: { readonly name: string; readonly brand: Brand; readonly where: string } | null
    readonly trackers: ReadonlyArray<{ readonly id: string; readonly name: string; readonly brand: Brand }>
    readonly containers: ReadonlyArray<{ readonly id: string; readonly name: string }> | null
    readonly container: string | null
    /** A tracker to connect, where none is: Linear first. */
    readonly away: ReadonlyArray<{ readonly service: Service; readonly name: string; readonly brand: Brand }>
  }
  readonly statuses: { readonly source: SetupStatus; readonly home: SetupStatus; readonly issues: SetupStatus }
  /** What Create will do, in a line; while it does it, what it is doing. */
  readonly footNote: string | null
  readonly plan: DraftPlan
}

export interface SetupActions {
  readonly onWay: (way: SetupWay) => void
  readonly onQuery: (query: string) => void
  /** Chooses a repository to clone, beside those chosen; one chosen already is left out. */
  readonly choose: (id: string) => void
  readonly retry: () => void
  /** Opens where a host is let reach more, and reads its repositories again once the window is back. */
  readonly widen: (limited: SetupLimited) => void
  readonly connect: (service: Service) => void
  readonly endConnect: () => void
  readonly onHome: (value: string) => void
  readonly onOwner: (owner: string) => void
  readonly onRepoName: (name: string) => void
  readonly onPrivate: (hidden: boolean) => void
  readonly onIssues: (value: string) => void
  readonly onContainer: (id: string) => void
}

/** "a, b and c". */
const andOf = (names: ReadonlyArray<string>) =>
  names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`

const ready = (list: ConnectionList | null, wanted: (service: Service) => boolean) =>
  (list?.connections ?? []).filter((connection) => connection.state === 'ready' && wanted(serviceOfProduct(connection.product)))

/** "GitHub", or "GitHub (git.acme.com)" where there's more than one connection to it. */
const nameOf = (connection: ConnectionSummary, all: ReadonlyArray<ConnectionSummary>) => {
  const same = all.filter((other) => serviceOfProduct(other.product) === serviceOfProduct(connection.product))
  if (same.length < 2) return connection.name
  try {
    return `${connection.name} (${new URL(connection.webUrl).hostname})`
  } catch {
    return connection.name
  }
}

export const useSetup = (draft: Draft, store: DraftStore, list: ConnectionList | null): SetupModel & SetupActions => {
  const { client, host: system } = useServices()
  // On another computer's home, a code host is connected there from this window, where the home allows it (an older home
  // doesn't): those it isn't connected to are offered then, and only then. Its trackers stay with the person's own window.
  const remoteHome = client.connection !== undefined
  const connects = !remoteHome || canCall(client, 'ConnectToken')
  const here = useHomeName()
  // Put on a host, or given a tracker, only where this window may: a window on another computer's home may not yet.
  const publishes = canCall(client, 'ListRepositoryOwners') && canCall(client, 'PublishRepository')
  const tracks = canCall(client, 'ListContainers') && canCall(client, 'SetProjectTracker')
  const read = reads(client)
  const [connecting, setConnecting] = useState<Service | null>(null)
  const change = (next: (now: Draft) => Draft) => store.change(draft.id, next)

  const trackers = tracks ? ready(list, (service) => TRACKER_SERVICES.includes(service)) : []
  // Folders chosen, or being read, start it on A folder; otherwise Clone.
  const way: SetupWay =
    draft.way ?? (draft.folders.some((folder) => folder.came === undefined) || draft.reading.length > 0 ? 'folder' : 'clone')
  const words = draft.name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3)
  const { codeHosts, hosts, repositories, failed, limited, widened, pasted, retry, cloneOf } = useHostRepositories(list, draft.query, words)
  const slug = repositoryFolder(draft.name.trim())

  // Where a clone goes unless the person chooses: read once a window, as where people keep code changes seldom.
  const usual = useQuery({ queryKey: ['clone-place'], queryFn: () => system.clonePlace(), staleTime: Infinity, enabled: way === 'clone' })

  // The one repository only on this computer, for where its code lives: what the way chosen brings, before it's made.
  // The folders the way chosen brings: those it cloned or made, or those chosen.
  const mine = draft.folders.filter((folder) => (folder.came ?? 'folder') === way)
  /** Where a repository chosen was cloned to, once it is. */
  const clonedOf = (id: string) => (way === 'clone' ? mine.find((folder) => folder.clone === id) : undefined)
  // The first chosen not cloned yet: what Create clones next.
  const next = draft.clones.find((clone) => clonedOf(clone.id) === undefined)
  const local =
    way === 'new'
      ? draft.fresh !== null || mine.some((folder) => folder.remote === null)
      : way === 'folder'
        ? mine.length === 1 && mine[0]?.remote === null
        : false
  // The hosts it can be put on.
  const homes = publishes ? codeHosts : []
  const homeConnection = (() => {
    if (draft.home?.kind === 'host') {
      const kept = draft.home.connectionId
      if (homes.some((one) => one.id === kept)) return kept
    }
    if (draft.home?.kind === 'here') return null
    return homes[0]?.id ?? null
  })()
  const owners = useQuery({
    ...read.repositoryOwners(homeConnection ?? ''),
    enabled: local && homeConnection !== null,
  })
  const ownerList = homeConnection === null ? null : (owners.data ?? null)
  const hostHome = draft.home?.kind === 'host' ? draft.home : null
  const owner = ownerList === null ? null : (ownerList.find((one) => one.id === hostHome?.owner?.id) ?? ownerList[0] ?? null)
  const repoName = hostHome?.name ?? (slug === '' ? 'repository' : slug)
  const hidden = hostHome?.private ?? true

  // The code host its code is on, once chosen: a clone's, a folder's remote's, or the one it is put on.
  const codeProduct: { readonly product: Product | null; readonly connectionId: string | null; readonly where: string } | null = (() => {
    // Several cloned: the first chosen's host, for its issues.
    if (way === 'clone') {
      const [clone] = draft.clones
      if (clone === undefined) return null
      return { product: clone.product, connectionId: 'connectionId' in clone.from ? clone.from.connectionId : null, where: clone.remote }
    }
    if (local) {
      const connection = codeHosts.find((one) => one.id === homeConnection)
      return connection === undefined
        ? null
        : { product: connection.product, connectionId: connection.id, where: `${owner?.id ?? '…'}/${repoName}` }
    }
    const [only] = mine
    const remote = mine.length === 1 && only?.remote != null ? remoteOf(only.remote) : null
    if (remote === null) return null
    const connection = codeHosts.find((one) => hostnameOf(one.webUrl) === remote.host)
    return { product: connection?.product ?? null, connectionId: connection?.id ?? null, where: remote.path }
  })()
  const hostIssues = tracks && codeProduct?.connectionId != null ? issuesOf(codeProduct.product) : null

  const trackerChoice = (() => {
    const kept = draft.issues
    if (kept?.kind === 'tracker' && trackers.some((one) => one.id === kept.connectionId)) return kept
    if (kept?.kind === 'host' && hostIssues !== null) return kept
    if (kept?.kind === 'none') return kept
    // What fits: the tracker connected, else a clone's own issues, else none yet.
    const [first] = trackers
    if (first !== undefined) return { kind: 'tracker' as const, connectionId: first.id, container: null }
    if (way === 'clone' && hostIssues !== null) return { kind: 'host' as const }
    return { kind: 'none' as const }
  })()
  const containers = useQuery({
    ...read.containers(trackerChoice.kind === 'tracker' ? trackerChoice.connectionId : ''),
    enabled: trackerChoice.kind === 'tracker',
  })
  const container =
    trackerChoice.kind === 'tracker'
      ? (trackerChoice.container ??
        (containers.data?.[0] === undefined ? null : { id: containers.data[0].id, name: containers.data[0].name }))
      : null

  const plan: DraftPlan = {
    // A host chosen is a host to put it on, whatever is still being read: only Only on this computer keeps it here.
    publish: local && homeConnection !== null ? { connectionId: homeConnection, owner, name: repoName.trim(), private: hidden } : null,
    tracker:
      trackerChoice.kind === 'tracker'
        ? { connectionId: trackerChoice.connectionId, container }
        : trackerChoice.kind === 'host' && codeProduct?.connectionId != null
          ? { connectionId: codeProduct.connectionId, container: { id: codeProduct.where, name: codeProduct.where } }
          : null,
  }

  const home: SetupModel['home'] = (() => {
    if (way === 'clone') {
      const [clone] = draft.clones
      if (clone === undefined) return { kind: 'fixed', brand: null, said: 'On the host it’s cloned from.' }
      // Several, on one host, at each of theirs; on several hosts, each at its own.
      const oneHost = draft.clones.every((one) => one.hostName === clone.hostName)
      return {
        kind: 'fixed',
        brand: clone.product === null || !oneHost ? null : productBrand(clone.product),
        said: oneHost
          ? `On ${clone.hostName}, at ${andOf(draft.clones.map((one) => one.remote))}. Tasks open ${changesOn(clone.product)} there.`
          : `At ${andOf(draft.clones.map((one) => `${one.remote} on ${one.hostName}`))}.`,
      }
    }
    if (local)
      return {
        kind: 'picks',
        value: homeConnection ?? 'here',
        connected: homes.map((connection) => ({
          id: connection.id,
          name: nameOf(connection, homes),
          brand: productBrand(connection.product),
          thing: thingOf(serviceOfProduct(connection.product)),
        })),
        // Put on a host only where the window may publish: a home's window may not, so none is offered to connect for it.
        away: !publishes
          ? []
          : hosts
              .filter((host) => !host.connected)
              .map((host) => ({ service: host.id as Service, name: host.name, brand: host.brand, thing: host.thing })),
        owners: ownerList,
        ownersFailed: owners.isError,
        retryOwners: () => void owners.refetch(),
        owner: owner?.id ?? null,
        name: repoName,
        private: hidden,
      }
    const [only] = mine
    if (mine.length !== 1 || only === undefined || only.remote === null) return { kind: 'none' }
    const remote = remoteOf(only.remote)
    return {
      kind: 'fixed',
      brand: codeProduct?.product == null ? null : productBrand(codeProduct.product),
      said: remote === null ? `At ${only.remote}.` : `On ${remote.host}, at ${remote.path}.`,
    }
  })()

  const status = (state: Draft['steps']['source']): SetupStatus => state
  const doing = (() => {
    if (!draft.creating) return null
    if (draft.steps.source === 'doing') {
      if (way === 'clone' && next !== undefined) return `Cloning ${next.remote}…`
      if (way === 'new') return 'Making its repository…'
      return mine.some((folder) => folder.git === 'none') ? 'Starting git…' : 'Reading its folders…'
    }
    if (draft.steps.home === 'doing' && plan.publish !== null)
      return `Making ${plan.publish.owner?.id ?? '…'}/${plan.publish.name} on ${codeHosts.find((one) => one.id === plan.publish?.connectionId)?.name ?? 'its host'}…`
    if (draft.steps.home === 'idle' && plan.publish?.owner === null) return 'Reading where it can go…'
    return `Opening ${draft.name.trim()}…`
  })()
  const said = (() => {
    const parts: Array<string> = []
    const toClone = way === 'clone' ? draft.clones.filter((clone) => clonedOf(clone.id) === undefined) : []
    if (toClone.length > 0) parts.push(`clones ${andOf(toClone.map((clone) => clone.remote))}`)
    if (way === 'folder' && mine.some((folder) => folder.git === 'none')) parts.push('starts git in it')
    if (way === 'folder' && mine.some((folder) => folder.git === 'unborn')) parts.push('makes its first commit')
    if (way === 'new' && draft.fresh !== null) parts.push('makes a new repository')
    if (plan.publish !== null) {
      const on = codeHosts.find((one) => one.id === plan.publish?.connectionId)?.name ?? 'its host'
      parts.push(`puts it on ${on}`)
    }
    if (parts.length === 0) return null
    const line = parts.length === 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
    return `Create ${line}.${local && plan.publish === null ? ` Its code stays on ${here.name}.` : ''}`
  })()

  return {
    way,
    hosts: connects ? hosts : hosts.filter((one) => one.connected),
    repositories,
    failed,
    limited,
    pasted,
    chosen: draft.clones.map((clone) => clone.id),
    clones: draft.clones.map((clone) => ({
      ...clone,
      where: clonedOf(clone.id)?.where ?? clone.here?.where ?? (draft.cloneInto ?? usual.data)?.where ?? null,
      brand: clone.product === null ? null : productBrand(clone.product),
    })),
    connecting,
    home,
    issues: {
      value: trackerChoice.kind === 'tracker' ? trackerChoice.connectionId : trackerChoice.kind,
      host:
        hostIssues === null || codeProduct === null || codeProduct.product === null
          ? null
          : { name: hostIssues, brand: productBrand(codeProduct.product), where: codeProduct.where },
      trackers: trackers.map((connection) => ({
        id: connection.id,
        name: nameOf(connection, trackers),
        brand: productBrand(connection.product),
      })),
      containers: trackerChoice.kind === 'tracker' ? (containers.data?.map((one) => ({ id: one.id, name: one.name })) ?? null) : null,
      container: container?.id ?? null,
      away:
        trackers.length > 0 || remoteHome
          ? []
          : TRACKER_SERVICES.map((service) => ({ service, name: serviceName(service), brand: serviceBrand(service) })),
    },
    statuses: { source: status(draft.steps.source), home: status(draft.steps.home), issues: status(draft.steps.issues) },
    footNote: doing ?? said,
    plan,
    onWay: (next) => change((now) => ({ ...now, way: next, error: null })),
    onQuery: (query) => change((now) => ({ ...now, query })),
    choose: (id) => {
      const clone = cloneOf(id)
      if (clone === null) return
      change((now) => {
        // Chosen already, by its row or as the same repository pasted: left out, and what it cloned with it.
        const had = now.clones.some((one) => one.id === clone.id || sameRepository(one, clone))
        const clones = had ? now.clones.filter((one) => one.id !== clone.id && !sameRepository(one, clone)) : [...now.clones, clone]
        return {
          ...now,
          clones,
          error: null,
          folders: now.folders.filter((folder) => folder.came !== 'clone' || clones.some((one) => one.id === folder.clone)),
          // Named after the first chosen, where it has no name yet.
          name:
            now.name.trim() === '' && clones[0] !== undefined
              ? (clones[0].remote.split('/').at(-1) ?? '').replace(/^./, (first) => first.toUpperCase())
              : now.name,
        }
      })
    },
    retry,
    widen: (one) => {
      if (one.url === null) return
      widened(one.host)
      window.open(one.url, '_blank')
    },
    connect: setConnecting,
    endConnect: () => setConnecting(null),
    onHome: (value) =>
      change((now) => ({
        ...now,
        homeError: null,
        home:
          value === 'here'
            ? { kind: 'here' }
            : ({ kind: 'host', connectionId: value, owner: null, name: hostHome?.name ?? null, private: hidden } satisfies DraftHome),
      })),
    onOwner: (id) => {
      const picked = ownerList?.find((one) => one.id === id) ?? null
      if (homeConnection !== null)
        change((now) => ({
          ...now,
          homeError: null,
          home: { kind: 'host', connectionId: homeConnection, owner: picked, name: hostHome?.name ?? null, private: hidden },
        }))
    },
    onRepoName: (name) => {
      if (homeConnection !== null)
        change((now) => ({ ...now, homeError: null, home: { kind: 'host', connectionId: homeConnection, owner, name, private: hidden } }))
    },
    onPrivate: (next) => {
      if (homeConnection !== null)
        change((now) => ({
          ...now,
          home: { kind: 'host', connectionId: homeConnection, owner, name: hostHome?.name ?? null, private: next },
        }))
    },
    onIssues: (value) =>
      change((now) => ({
        ...now,
        issues:
          value === 'none' || value === 'host'
            ? ({ kind: value } satisfies DraftIssues)
            : ({ kind: 'tracker', connectionId: value, container: null } satisfies DraftIssues),
      })),
    onContainer: (id) => {
      const picked = containers.data?.find((one) => one.id === id)
      if (trackerChoice.kind === 'tracker' && picked !== undefined)
        change((now) => ({
          ...now,
          issues: { kind: 'tracker', connectionId: trackerChoice.connectionId, container: { id: picked.id, name: picked.name } },
        }))
    },
  }
}
