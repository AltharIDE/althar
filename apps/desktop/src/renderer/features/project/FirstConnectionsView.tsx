import { useQueries, useQueryClient } from '@tanstack/react-query'
import { useState, useSyncExternalStore } from 'react'

import type { AccessReason, ConnectionCheck, ConnectionList, Service } from '@althar/contracts'
import { FirstConnections, type FirstConnectionsService, LinkButton } from '@althar/ui'

import { canCall } from '../../data/client'
import { useServices } from '../../data/services'
import { ConnectFlow } from '../connections/ConnectFlow'
import s from '../connections/Connections.module.css'
import { useConnect } from '../connections/useConnect'
import type { ConnectionsModel } from '../connections/useConnections'
import { SERVICES, hostsCode, serviceBrand, serviceName, serviceOf } from '../connections/ways'

/*
 * A new project's card, in its empty conversation, for what its tasks will
 * need later and nothing connects yet (the kit's FirstConnections): the code
 * host its repositories' remotes name, or every host where they name none,
 * and a tracker. Connecting one opens its walk in the card. Each project's
 * Not now is kept on this computer (`althar.firstConnections`), and the card
 * goes once the conversation has begun. Where its host is connected, the
 * card asks what that sign-in can do there as the project is added, and
 * where it may not push to the project's repositories, says so, with
 * Connect again in place: found here, not on a task's last step.
 */

const STORED = 'althar.firstConnections'
const text = { back: 'Back' }

/* The projects whose card was put away, as storage keeps them; storage that can't be read keeps none. */
const listeners = new Set<() => void>()
let last: { readonly raw: string | null; readonly hidden: ReadonlyArray<string> } = { raw: null, hidden: [] }
const read = (): ReadonlyArray<string> => {
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(STORED)
  } catch {
    return last.hidden
  }
  if (raw === last.raw) return last.hidden
  let hidden: ReadonlyArray<string> = []
  try {
    const parsed: unknown = raw === null ? null : JSON.parse(raw)
    if (Array.isArray(parsed)) hidden = parsed.filter((id): id is string => typeof id === 'string')
  } catch {
    hidden = []
  }
  last = { raw, hidden }
  return hidden
}
const hide = (projectId: string) => {
  const hidden = [...new Set([...read(), projectId])]
  let raw: string | null = JSON.stringify(hidden)
  try {
    window.localStorage.setItem(STORED, raw)
  } catch {
    // Put away for this window only.
    raw = last.raw
  }
  last = { raw, hidden }
  listeners.forEach((listener) => listener())
}
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const option = (service: Service): FirstConnectionsService => ({ id: service, name: serviceName(service), brand: serviceBrand(service) })
const isService = (id: string): id is Service => (SERVICES as ReadonlyArray<string>).includes(id)

/**
 * What the card offers a project, from the connections: where its code is and isn't connected, the hosts where it names none,
 * and the trackers while none is connected; only what this window may connect (`may`): on another computer's home, its code
 * hosts where the home lets it, and never its trackers.
 */
export const firstConnectionsOf = (
  list: ConnectionList,
  project: string,
  may: { readonly hosts: boolean; readonly trackers: boolean } = { hosts: true, trackers: true },
) => {
  const offered = SERVICES.filter((service) => list.products.some((product) => product.service === service))
  const connected = list.connections.flatMap((connection) => serviceOf(list.products, connection.product) ?? [])
  const place = list.places.find((one) => one.project === project)
  const home = place === undefined ? undefined : serviceOf(list.products, place.product)
  const homeConnected = place !== undefined && list.connections.some((one) => one.product === place.product && one.webUrl === place.webUrl)
  const anyHost = connected.some(hostsCode)
  return {
    ...(may.hosts && home !== undefined && !homeConnected
      ? { host: { service: option(home), ...(place?.repositories[0] === undefined ? {} : { where: place.repositories[0] }) } }
      : {}),
    hosts: may.hosts && home === undefined && !anyHost ? offered.filter(hostsCode).map(option) : [],
    trackers:
      !may.trackers || connected.some((service) => !hostsCode(service)) ? [] : offered.filter((service) => !hostsCode(service)).map(option),
  }
}

/**
 * The connections that reach a project's code, one for each host its repositories are on, with the repositories there:
 * what each one's check is asked of.
 */
export const codeConnectionsOf = (list: ConnectionList, project: string) =>
  list.places.flatMap((place) => {
    if (place.project !== project) return []
    const connection = list.connections.find((one) => one.product === place.product && one.webUrl === place.webUrl)
    const service = connection === undefined ? undefined : serviceOf(list.products, connection.product)
    return connection === undefined || service === undefined ? [] : [{ connection, place, service }]
  })

/** Why a sign-in may not push, in a line with what puts it right. */
const cantPushWhy = (reason: AccessReason | null, service: string, login: string): string => {
  switch (reason?.kind) {
    case 'no_push':
      return reason.url === null
        ? `Althar’s ${service} app may not push there. Its owners can let it write, or connect again with a token that can push.`
        : `${service} won’t take a push there with ${login}’s token. Give it write access on ${service}, or connect again with one that can push.`
    case 'scope':
      return `The token wasn’t given the ${reason.scope} scope. Connect again with one that has it.`
    case 'role':
      return `${login} may only read there: its owners can give the account write access, or connect again as one that can push.`
    default:
      return `${service} won’t take a push from this sign-in there. Connect again with one that can push.`
  }
}

/** A refusal's reason, as one remedy: those with the same remedy are said together. */
const remedyOf = (reason: AccessReason | null) =>
  reason === null
    ? 'none'
    : reason.kind === 'scope'
      ? `scope ${reason.scope}`
      : reason.kind === 'no_push'
        ? `no_push ${reason.url ?? ''}`
        : reason.kind

/**
 * What a connection's check says of pushing to the project's repositories there: those its sign-in may not push to, by
 * remedy, each with why and what puts it right; empty where it may, or the check doesn't say. Only repositories with the
 * same reason share a line, so a remedy is never given for a repository it doesn't fit; another project's refusals are
 * never this one's, and without each repository's own outcome, only a reason that names its repositories, or one about the
 * whole token, is said.
 */
export const cantPushOf = (
  check: ConnectionCheck,
  repositories: ReadonlyArray<string>,
  service: string,
  login: string,
): ReadonlyArray<{ readonly names: ReadonlyArray<string>; readonly why: string }> => {
  const push = check.lines.find((line) => line.need === 'push')
  if (push === undefined) return []
  const mine = (path: string) => repositories.some((one) => one.toLowerCase() === path.toLowerCase())
  const refused: ReadonlyArray<{ readonly path: string; readonly reason: AccessReason | null }> =
    push.repositories !== undefined
      ? push.repositories.filter((one) => one.state === 'no' && mine(one.path))
      : push.state !== 'no'
        ? []
        : push.reason?.kind === 'no_push'
          ? push.reason.names.filter(mine).map((path) => ({ path, reason: push.reason }))
          : push.reason?.kind === 'scope'
            ? repositories.map((path) => ({ path, reason: push.reason }))
            : []
  // Named as the project names them.
  const named = (path: string) => repositories.find((one) => one.toLowerCase() === path.toLowerCase()) ?? path
  const groups = new Map<string, { names: Array<string>; reason: AccessReason | null }>()
  for (const one of refused) {
    const key = remedyOf(one.reason)
    const group = groups.get(key) ?? { names: [], reason: one.reason }
    group.names.push(named(one.path))
    groups.set(key, group)
  }
  return [...groups.values()].map((group) => ({ names: group.names, why: cantPushWhy(group.reason, service, login) }))
}

export interface FirstConnectionsViewProps {
  projectId: string
  /** The project's name, as the connections' places name it. */
  project: string
  model: ConnectionsModel
  className?: string
}

/** A new project's card for its code host and a tracker, while either isn't connected and it wasn't put away. */
export function FirstConnectionsView({ projectId, project, model, className }: FirstConnectionsViewProps) {
  const hidden = useSyncExternalStore(subscribe, read)
  const [walking, setWalking] = useState<{ readonly service: Service; readonly again: string | null } | null>(null)
  const { client } = useServices()
  const cache = useQueryClient()
  const list = model.list
  const hosts = canCall(client, 'ConnectToken')
  // The project's hosts, connected: each asked what its sign-in can do there, for the repositories the project has there now,
  // so another project's answer, or one from before a repository was added, is never this one's.
  const codes = list === null || hidden.includes(projectId) || !hosts ? [] : codeConnectionsOf(list, project)
  const keyOf = (code: (typeof codes)[number]) =>
    [
      'connection-check',
      code.connection.id,
      project,
      [...code.place.repositories]
        .map((path) => path.toLowerCase())
        .sort()
        .join(' '),
    ] as const
  const checks = useQueries({
    queries: codes.map((code) => ({
      queryKey: keyOf(code),
      // For this project alone: where its own work is pushed, never another project's destinations on the same host.
      queryFn: () => client.checkConnection(code.connection.id, project),
      enabled: canCall(client, 'CheckConnection'),
      staleTime: 5 * 60_000,
      retry: false,
    })),
  })
  if (list === null || hidden.includes(projectId)) return null
  const remote = client.connection !== undefined
  const offer = firstConnectionsOf(list, project, { hosts, trackers: !remote })
  const cantPush = codes.flatMap((code, index) => {
    const data = checks[index]?.data
    const found =
      data === undefined ? [] : cantPushOf(data, code.place.repositories, serviceName(code.service), code.connection.account.login)
    return found.map((one) => ({ code, ...one }))
  })
  // Nothing this window may connect, and nothing in the way: no card; but one walking stays till its walk ends, its check shown.
  if (walking === null && offer.host === undefined && offer.hosts.length === 0 && offer.trackers.length === 0 && cantPush.length === 0)
    return null
  // Walking in to a code host, the card stays the code's as it connects, its check shown before Done.
  const walkingHost =
    walking !== null && hostsCode(walking.service) && offer.host === undefined ? { host: { service: option(walking.service) } } : {}
  return (
    <FirstConnections
      {...offer}
      {...walkingHost}
      {...(cantPush.length === 0
        ? {}
        : {
            cantPush: cantPush.map((one) => ({
              id: `${one.code.connection.id} ${one.names.join(' ')}`,
              service: option(one.code.service),
              names: one.names,
              why: one.why,
              // Its own connection signed in to again, so it takes one that can push: never another server's of the same kind.
              onConnectAgain: () => setWalking({ service: one.code.service, again: one.code.connection.id }),
            })),
          })}
      onConnect={(chosen) => {
        if (isService(chosen)) setWalking({ service: chosen, again: null })
      }}
      onHide={() => hide(projectId)}
      {...(walking === null
        ? {}
        : {
            walk: (
              <Walk
                service={walking.service}
                again={walking.again}
                onClose={() => {
                  setWalking(null)
                  void cache.invalidateQueries({ queryKey: ['connection-check'] })
                }}
              />
            ),
          })}
      {...(className === undefined ? {} : { className })}
    />
  )
}

/** A service's walk in, in the card: the one Settings shows, from the card's left edge, with the way back to the card's rows on it too. */
function Walk({ service, again, onClose }: { service: Service; again: string | null; onClose: () => void }) {
  const flow = useConnect({ service, again, onClose })
  return (
    <div className={s.inCard}>
      <ConnectFlow model={flow} compact align="start" />
      <LinkButton onClick={() => void (flow.back() || onClose())}>{text.back}</LinkButton>
    </div>
  )
}

/** Forgets the cards put away, as each test starts. */
export const forgetHiddenCards = () => {
  last = { raw: null, hidden: [] }
}
