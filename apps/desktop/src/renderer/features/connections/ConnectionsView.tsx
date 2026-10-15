import { useState } from 'react'

import type { ConnectionList, ConnectPlace, Service } from '@althar/contracts'
import { Connections, Heading, LinkButton, type ServiceConnection, type ServiceOption } from '@althar/ui'

import { PartPending } from '../../shared/Pending'
import { ConnectFlow } from './ConnectFlow'
import s from './Connections.module.css'
import { useConnect } from './useConnect'
import type { ConnectionsModel } from './useConnections'
import { hostOf, hostsCode, SERVICES, serviceBrand, serviceName, serviceOf } from './ways'

/*
 * The code hosts and trackers Althar reaches for the person, drawn by the
 * kit: each service, who they are signed in as there, or the one press that
 * connects it. Connect, Sign in again and Add a server open the service's
 * walk in: where the host has a place for it (a dialog over a project holds
 * it at the card's width), it opens there; otherwise, as on the Settings
 * tab, here, in place of the list.
 */

export const text = {
  label: 'Code hosts and trackers',
  /** Side by side, as settings shows them: what each kind is for. */
  columns: {
    hosts: { title: 'Code hosts', note: 'Pull requests, their checks and review comments' },
    trackers: { title: 'Trackers', note: 'Issues become tasks, and tasks move their issues' },
  },
  what: { host: 'Pull requests', tracker: 'Issues' },
  /** Where a project's code is, on a service not connected. */
  here: (project: string) => `${project}’s code is here`,
  on: (project: string, host: string) => `${project}’s code is on ${host}`,
  reading: 'Reading the connections',
  backToList: 'Back to code hosts and trackers',
}

/** A walk in to open: a service, a connection to sign in again, or a company's own server. */
export interface Connecting {
  readonly service: Service
  readonly again?: string
  readonly server?: boolean
}

const HOSTED = /^https:\/\/(github\.com|gitlab\.com|bitbucket\.org)$/

/** Where the projects' code is on a service, in a few words: Meridian's code is here. */
const whereOf = (places: ReadonlyArray<ConnectPlace>): string | undefined => {
  const [first] = places
  if (first === undefined) return undefined
  return HOSTED.test(first.webUrl) ? text.here(first.project) : text.on(first.project, hostOf(first.webUrl))
}

/** The services as the kit lists them, in their order: each with where the projects' code is on it, or what it is for. */
export const servicesOf = (list: ConnectionList, { what = true }: { readonly what?: boolean } = {}): ReadonlyArray<ServiceOption> =>
  SERVICES.flatMap((service) => {
    const products = list.products.filter((product) => product.service === service)
    if (products.length === 0) return []
    const where = whereOf(list.places.filter((place) => serviceOf(list.products, place.product) === service))
    const said = where ?? (what ? (hostsCode(service) ? text.what.host : text.what.tracker) : undefined)
    return [
      {
        id: service,
        name: serviceName(service),
        brand: serviceBrand(service),
        ...(said === undefined ? {} : { what: said }),
        ...(products.some((product) => product.selfHosted) ? { selfHosted: true } : {}),
      },
    ]
  })

/** The connections as the kit lists them, by service: who, and where, when it isn't the hosted service. */
export const connectionsOf = (list: ConnectionList): ReadonlyArray<ServiceConnection> =>
  list.connections.map((connection) => {
    const product = list.products.find((option) => option.product === connection.product)
    return {
      id: connection.id,
      service: product?.service ?? connection.product,
      account: connection.account.login,
      ...(connection.webUrl === product?.hostedUrl ? {} : { instance: connection.webUrl }),
      ...(connection.state === 'reauth_required' ? { needsSignIn: true } : {}),
    }
  })

const isService = (id: string): id is Service => (SERVICES as ReadonlyArray<string>).includes(id)

export interface ConnectionsViewProps {
  model: ConnectionsModel
  /** Code hosts beside trackers, each column saying what that kind is for. */
  columns?: boolean
  /** Opens a walk in where the host has a place for it; without it, the walk opens here, in place of the list. */
  onConnect?: (connecting: Connecting) => void
}

/**
 * The services, in one list, or with `columns` the code hosts beside the
 * trackers, each saying what that kind is for, so its services needn't.
 */
export function ConnectionsView({ model, columns = false, onConnect }: ConnectionsViewProps) {
  const [here, setHere] = useState<Connecting | null>(null)
  const open = onConnect ?? setHere
  if (here !== null) return <ConnectingHere connecting={here} onClose={() => setHere(null)} />
  const list = model.list
  if (list === null) return model.error === null ? <PartPending label={text.reading} /> : <p role="alert">{model.error}</p>
  const services = servicesOf(list, { what: !columns })
  const listOf = (label: string, shown: ReadonlyArray<ServiceOption>) => (
    <Connections
      label={label}
      services={shown}
      connections={connectionsOf(list)}
      onConnect={(service) => {
        if (isService(service)) open({ service })
      }}
      onSignInAgain={(connectionId) => {
        const service = connectionsOf(list).find((connection) => connection.id === connectionId)?.service
        if (service !== undefined && isService(service)) open({ service, again: connectionId })
      }}
      onAddServer={(service) => {
        if (isService(service)) open({ service, server: true })
      }}
      onDisconnect={(connectionId) => void model.disconnect(connectionId)}
    />
  )
  return (
    <div className={s.connections}>
      {columns ? (
        <div className={s.columns}>
          {(
            [
              ['hosts', services.filter((service) => isService(service.id) && hostsCode(service.id))],
              ['trackers', services.filter((service) => isService(service.id) && !hostsCode(service.id))],
            ] as const
          ).map(([kind, shown]) => (
            <section key={kind} className={s.column} aria-labelledby={`connections-${kind}`}>
              <Heading level={3} id={`connections-${kind}`} className={s.columnTitle}>
                {text.columns[kind].title}
              </Heading>
              <p className={s.columnNote}>{text.columns[kind].note}</p>
              {listOf(text.columns[kind].title, shown)}
            </section>
          ))}
        </div>
      ) : (
        listOf(text.label, services)
      )}
      {model.error !== null && (
        <p className={s.error} role="alert">
          {model.error}
        </p>
      )}
    </div>
  )
}

/** A walk in, in place of the list, with the way back to it. */
function ConnectingHere({ connecting, onClose }: { connecting: Connecting; onClose: () => void }) {
  const flow = useConnect({ ...connecting, onClose })
  return (
    <div className={s.here}>
      <LinkButton onClick={onClose}>{text.backToList}</LinkButton>
      <div className={s.card}>
        <ConnectFlow model={flow} />
      </div>
    </div>
  )
}
