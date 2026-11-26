import { useQuery, useQueryClient } from '@tanstack/react-query'
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

/** The connection that reaches a project's code, where one does: what its check is asked of. */
export const codeConnectionOf = (list: ConnectionList, project: string) => {
  const place = list.places.find((one) => one.project === project)
  if (place === undefined) return null
  const connection = list.connections.find((one) => one.product === place.product && one.webUrl === place.webUrl)
  return connection === undefined ? null : { connection, place }
}

/** Why a sign-in may not push, in a line with what puts it right. */
const cantPushWhy = (reason: AccessReason | null, service: string, login: string): string => {
  switch (reason?.kind) {
    case 'no_push':
      return reason.url === null
        ? `Althar’s ${service} app may only read there. Its owners can let it write, or connect again with a token that can push.`
        : `${service} took ${login}’s token, but it may only read there. Give it write access on ${service}, or connect again with one that can push.`
    case 'scope':
      return `The token wasn’t given the ${reason.scope} scope. Connect again with one that has it.`
    case 'role':
      return 'Your account can’t push there: its owners can change its role, or connect again as one that can.'
    default:
      return `${service} won’t take a push from this sign-in there. Connect again with one that can push.`
  }
}

/**
 * What the check says of pushing to the project's repositories: those its sign-in may not push to, and why; null where it
 * may, or the check doesn't say.
 */
export const cantPushOf = (check: ConnectionCheck, repositories: ReadonlyArray<string>, service: string, login: string) => {
  const push = check.lines.find((line) => line.need === 'push')
  if (push === undefined || push.state !== 'no') return null
  const lower = (path: string) => path.toLowerCase()
  const names =
    push.reason?.kind === 'no_push'
      ? repositories.filter((path) => (push.reason?.kind === 'no_push' ? push.reason.names : []).some((one) => lower(one) === lower(path)))
      : repositories
  if (names.length === 0) return null
  return { names, why: cantPushWhy(push.reason, service, login) }
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
  // The project's host, connected: asked what its sign-in can do there, once a while, while the card shows.
  const code = list === null || hidden.includes(projectId) || !hosts ? null : codeConnectionOf(list, project)
  const checkKey = ['connection-check', code?.connection.id ?? ''] as const
  const check = useQuery({
    queryKey: checkKey,
    queryFn: () => client.checkConnection(code?.connection.id ?? ''),
    enabled: code !== null && canCall(client, 'CheckConnection'),
    staleTime: 5 * 60_000,
    retry: false,
  })
  if (list === null || hidden.includes(projectId)) return null
  const remote = client.connection !== undefined
  const offer = firstConnectionsOf(list, project, { hosts, trackers: !remote })
  const service = code === null ? null : (serviceOf(list.products, code.connection.product) ?? null)
  const cantPush =
    code === null || service === null || check.data === undefined
      ? null
      : cantPushOf(check.data, code.place.repositories, serviceName(service), code.connection.account.login)
  // Nothing this window may connect, and nothing in the way: no card.
  if (offer.host === undefined && offer.hosts.length === 0 && offer.trackers.length === 0 && cantPush === null) return null
  return (
    <FirstConnections
      {...offer}
      {...(cantPush === null || service === null ? {} : { cantPush: { service: option(service), ...cantPush } })}
      onConnect={(chosen) => {
        if (!isService(chosen)) return
        // The host whose sign-in can't push: signed in to again, so the same connection takes one that can.
        const again = cantPush !== null && chosen === service ? (code?.connection.id ?? null) : null
        setWalking({ service: chosen, again })
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
                  void cache.invalidateQueries({ queryKey: checkKey })
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
