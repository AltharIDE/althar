import { useState, useSyncExternalStore } from 'react'

import type { ConnectionList, Service } from '@althar/contracts'
import { FirstConnections, type FirstConnectionsService, LinkButton } from '@althar/ui'

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
 * goes once the conversation has begun.
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

/** What the card offers a project, from the connections: where its code is and isn't connected, the hosts where it names none, and the trackers while none is connected. */
export const firstConnectionsOf = (list: ConnectionList, project: string) => {
  const offered = SERVICES.filter((service) => list.products.some((product) => product.service === service))
  const connected = list.connections.flatMap((connection) => serviceOf(list.products, connection.product) ?? [])
  const place = list.places.find((one) => one.project === project)
  const home = place === undefined ? undefined : serviceOf(list.products, place.product)
  const homeConnected = place !== undefined && list.connections.some((one) => one.product === place.product && one.webUrl === place.webUrl)
  const anyHost = connected.some(hostsCode)
  return {
    ...(home !== undefined && !homeConnected
      ? { host: { service: option(home), ...(place?.repositories[0] === undefined ? {} : { where: place.repositories[0] }) } }
      : {}),
    hosts: home === undefined && !anyHost ? offered.filter(hostsCode).map(option) : [],
    trackers: connected.some((service) => !hostsCode(service)) ? [] : offered.filter((service) => !hostsCode(service)).map(option),
  }
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
  const [walking, setWalking] = useState<Service | null>(null)
  const list = model.list
  if (list === null || hidden.includes(projectId)) return null
  const offer = firstConnectionsOf(list, project)
  return (
    <FirstConnections
      {...offer}
      onConnect={(service) => {
        if (isService(service)) setWalking(service)
      }}
      onHide={() => hide(projectId)}
      {...(walking === null ? {} : { walk: <Walk service={walking} onClose={() => setWalking(null)} /> })}
      {...(className === undefined ? {} : { className })}
    />
  )
}

/** A service's walk in, in the card: the one Settings shows, with the way back to the card's rows. */
function Walk({ service, onClose }: { service: Service; onClose: () => void }) {
  const flow = useConnect({ service, again: null, onClose })
  return (
    <div className={s.side}>
      <ConnectFlow model={flow} compact />
      <LinkButton onClick={() => void (flow.back() || onClose())}>{text.back}</LinkButton>
    </div>
  )
}

/** Forgets the cards put away, as each test starts. */
export const forgetHiddenCards = () => {
  last = { raw: null, hidden: [] }
}
