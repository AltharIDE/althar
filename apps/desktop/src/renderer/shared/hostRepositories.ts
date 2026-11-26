import { useQueries } from '@tanstack/react-query'

import type { Client } from '../data/client'
import type { Host } from '../data/services'

import type { ConnectionList, ConnectionSummary, Product, Service } from '@althar/contracts'
import type { HostedRepository, SetupHost } from '@althar/ui'

import { reads } from '../data/reads'
import { useServices } from '../data/services'
import { serviceBrand, serviceName, serviceOfProduct } from '../features/connections/ways'
import { device } from './device'
import { useFound } from './found'
import { cloneFromHere, type ProjectHere, servesHere, useProjectsHere } from './projectsHere'
import { hostnameOf, remoteOf } from './remotes'
import { ago } from './time'

/*
 * The repositories a clone is chosen from: the person's own on the code
 * hosts connected, all of them together, and one a URL pasted names, on a
 * host connected where it is one, else cloned with the person's own git
 * sign-in. A new project clones from them, and so does a project adding a
 * repository it doesn't have yet. On another computer's home, this
 * computer's projects too, each from where its code is, said so.
 */

/** The code hosts Althar works with, in the order they're offered. */
export const HOST_SERVICES: ReadonlyArray<Service> = ['github', 'gitlab', 'bitbucket']

/** What a host calls a repository. */
export const thingOf = (service: Service) => (service === 'gitlab' ? 'project' : 'repository')

/** A repository's path on a host, as its URL says it: https://github.com/a/b, git@github.com:a/b.git. Null for anything else. */
const pastedOf = (typed: string) => {
  const text = typed.trim()
  if (!/^(?:https?:\/\/|ssh:\/\/|git@)/i.test(text)) return null
  const ref = remoteOf(text.replace(/\/+$/, ''))
  return ref === null || !ref.path.includes('/') ? null : ref
}

/** A repository chosen to clone: on a connection's host, by its path there, or by a URL pasted. */
export interface CloneChoice {
  /** How the list knows it. */
  readonly id: string
  /** As its host names it: balazs/tidepool. */
  readonly remote: string
  readonly from: { readonly connectionId: string; readonly path: ReadonlyArray<string> } | { readonly url: string }
  /** Its host, where Althar knows it: what its changes and issues are called there. */
  readonly product: Product | null
  /** Its host's name: GitHub, or the host a URL names. */
  readonly hostName: string
  /** Its host's address, as a remote names it: github.com. With `remote`, which repository it is. */
  readonly host: string
  /** A repository main found of the same name, which may be it, on this computer already: added, not cloned, where it is. */
  readonly here: { readonly found: string; readonly where: string } | null
}

/** Whether two remotes are one repository: the same host, and the same path there, which code hosts read whatever its case. */
export const sameRepository = (
  one: { readonly host: string; readonly remote: string },
  other: { readonly host: string; readonly remote: string },
) =>
  one.host.toLowerCase() === other.host.toLowerCase() &&
  one.remote.replace(/\.git$/, '').toLowerCase() === other.remote.replace(/\.git$/, '').toLowerCase()

/** The code hosts connected and ready. */
export const readyHosts = (list: ConnectionList | null) =>
  (list?.connections ?? []).filter(
    (connection) => connection.state === 'ready' && HOST_SERVICES.includes(serviceOfProduct(connection.product)),
  )

export interface HostRepositories {
  readonly codeHosts: ReadonlyArray<ConnectionSummary>
  readonly hosts: ReadonlyArray<SetupHost>
  /** Null while they're read and none has come yet; all the hosts' together. */
  readonly repositories: ReadonlyArray<HostedRepository> | null
  /** The hosts whose repositories couldn't be read, by service. */
  readonly failed: ReadonlyArray<string>
  readonly pasted: HostedRepository | null
  /** Reads those that couldn't be read again. */
  readonly retry: () => void
  /** The repository a row is, to clone; null for one not listed. */
  readonly cloneOf: (id: string) => CloneChoice | null
}

/**
 * The repositories on the hosts `list` has connected, found by `query`, a
 * URL pasted in it naming one. Those with a name that has one of `like` in
 * it come first, as a new project's name suggests.
 */
export const useHostRepositories = (
  list: ConnectionList | null,
  query: string,
  like: ReadonlyArray<string> = [],
  enabled = true,
): HostRepositories => {
  const { client } = useServices()
  const read = reads(client)
  const found = useFound()
  const codeHosts = readyHosts(list)
  const listed = useQueries({ queries: codeHosts.map((connection) => ({ ...read.hostRepositories(connection.id), enabled })) })

  const hosts: ReadonlyArray<SetupHost> = HOST_SERVICES.map((service) => {
    const option = list?.products.find((product) => product.service === service && product.hostedUrl !== null)
    return {
      id: service,
      name: serviceName(service),
      brand: serviceBrand(service),
      thing: thingOf(service),
      connected: codeHosts.some((connection) => serviceOfProduct(connection.product) === service),
      how:
        option?.browserSignIn === true
          ? 'In your browser'
          : option?.tokenNeeds === 'email'
            ? 'With an Atlassian API token'
            : 'With a token',
    }
  })

  // What main found here, by name: a repository of the same name may be the one to clone, and is added, not cloned, if so.
  const foundByName = new Map((found.data?.repositories ?? []).map((one) => [one.name.toLowerCase(), one]))
  const repositoryOf = (
    connection: ConnectionSummary,
    path: ReadonlyArray<string>,
    extra: Partial<HostedRepository> = {},
  ): HostedRepository => {
    const name = path.at(-1) ?? ''
    const here = foundByName.get(name.toLowerCase())
    return {
      id: `${connection.id}:${path.join('/')}`,
      host: serviceOfProduct(connection.product),
      owner: path.slice(0, -1).join('/'),
      name,
      description: null,
      private: false,
      pushed: null,
      like: like.some((word) => name.toLowerCase().includes(word)),
      here: here === undefined ? null : here.where,
      ...extra,
    }
  }
  const all = codeHosts.flatMap((connection, at) =>
    (listed[at]?.data ?? [])
      .filter((one) => !one.archived)
      .map((one) =>
        repositoryOf(connection, one.path, {
          description: one.description,
          private: one.private,
          pushed: one.pushedAt === null ? null : ago(one.pushedAt),
        }),
      ),
  )
  // On another computer's home, this computer's projects, by where their code is: one the home lists already says so; the
  // rest are cloned by their address, with the home's own sign-in to that host where it has one.
  const projectsHere = useProjectsHere(list)
  const onHere = `On ${device.this}`
  // Listed through the home's connection to that very server, for its product, by the same path: another server on the same
  // host, at a base path of its own, may list a repository of the same path that isn't it.
  const homeHas = (one: ProjectHere) =>
    all.findIndex((listed) => {
      const connection = codeHosts.find((connection) => listed.id.startsWith(`${connection.id}:`))
      return (
        connection !== undefined &&
        servesHere(connection, one) &&
        sameRepository({ host: one.host, remote: `${listed.owner}/${listed.name}` }, { host: one.host, remote: one.path })
      )
    })
  for (const one of projectsHere) {
    const at = homeHas(one)
    const listed = all[at]
    if (listed !== undefined) all[at] = { ...listed, from: onHere }
  }
  const fromHere = projectsHere
    .filter((one) => homeHas(one) === -1)
    .map((one): HostedRepository => {
      const name = one.path.slice(one.path.lastIndexOf('/') + 1)
      const service = serviceOfProduct(one.product)
      return {
        id: `here:${one.url}`,
        host: service,
        owner: one.path.split('/').slice(0, -1).join('/'),
        name,
        description: null,
        private: false,
        pushed: null,
        like: like.some((word) => name.toLowerCase().includes(word)),
        here: null,
        from: onHere,
        brand: serviceBrand(service),
      }
    })
  all.unshift(...fromHere)
  const reading = listed.some((one) => one.data === undefined && !one.isError)
  const failed = codeHosts.flatMap((connection, at) => (listed[at]?.isError === true ? [serviceOfProduct(connection.product)] : []))

  // A URL pasted: the repository it names, on a host connected where one is; else cloned with the person's own git sign-in.
  const ref = pastedOf(query)
  const pastedConnection = ref === null ? undefined : codeHosts.find((connection) => hostnameOf(connection.webUrl) === ref.host)
  const pastedClone: CloneChoice | null =
    ref === null
      ? null
      : {
          id: pastedConnection === undefined ? `url:${query.trim()}` : `${pastedConnection.id}:${ref.path}`,
          remote: ref.path,
          from: pastedConnection === undefined ? { url: query.trim() } : { connectionId: pastedConnection.id, path: ref.path.split('/') },
          product: pastedConnection?.product ?? null,
          hostName: pastedConnection?.name ?? ref.host,
          host: ref.host,
          here: (() => {
            const here = foundByName.get((ref.path.split('/').at(-1) ?? '').toLowerCase())
            return here === undefined ? null : { found: here.id, where: here.where }
          })(),
        }
  const pasted: HostedRepository | null =
    ref === null || pastedClone === null
      ? null
      : (all.find((one) => one.id === pastedClone.id) ?? {
          id: pastedClone.id,
          host: pastedConnection === undefined ? '' : serviceOfProduct(pastedConnection.product),
          owner: ref.path.split('/').slice(0, -1).join('/'),
          name: ref.path.split('/').at(-1) ?? ref.path,
          description: null,
          private: false,
          pushed: null,
          like: false,
          here: null,
        })

  return {
    codeHosts,
    hosts,
    repositories: reading && all.length === 0 ? null : all,
    failed,
    pasted,
    retry: () => {
      for (const one of listed) if (one.isError) void one.refetch()
    },
    cloneOf: (id) => {
      if (pastedClone !== null && pastedClone.id === id) return pastedClone
      const mine = projectsHere.find((one) => `here:${one.url}` === id)
      const source = mine === undefined ? null : cloneFromHere(mine, list)
      if (mine !== undefined && source !== null)
        return {
          id,
          remote: mine.path,
          from: source,
          product: mine.product,
          hostName: serviceName(serviceOfProduct(mine.product)),
          host: mine.host,
          here: null,
        }
      const connection = codeHosts.find((one) => id.startsWith(`${one.id}:`))
      const shown = all.find((one) => one.id === id)
      if (connection === undefined || shown === undefined) return null
      const path = [...shown.owner.split('/').filter(Boolean), shown.name]
      const here = foundByName.get(shown.name.toLowerCase())
      return {
        id,
        remote: path.join('/'),
        from: { connectionId: connection.id, path },
        product: connection.product,
        hostName: connection.name,
        host: hostnameOf(connection.webUrl),
        here: here === undefined ? null : { found: here.id, where: here.where },
      }
    },
  }
}

/**
 * The checkout main found of a chosen repository's name, granted, where it
 * is that repository: its remote the same one on the same host. Null for one
 * of the same name that is another, or that can't be read.
 */
export const checkoutOf = async (choice: CloneChoice, host: Host, client: Client): Promise<string | null> => {
  if (choice.here === null) return null
  const grant = await host.grantFound(choice.here.found).catch(() => null)
  if (grant === null) return null
  const reading = await client.readFolder(grant).catch(() => null)
  const [found] = reading?.kind === 'repository' ? reading.repositories : []
  const ref = found?.remote == null ? null : remoteOf(found.remote)
  return ref !== null && sameRepository({ host: ref.host, remote: ref.path }, choice) ? grant : null
}
