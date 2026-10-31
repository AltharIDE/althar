import type { Brand } from '../../foundations/brands/brands'
import { Icon } from '../../foundations/Icon/Icon'
import { BrandMark } from '../../foundations/Marks/Marks'
import { cx } from '../../lib/cx'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { Button } from '../../primitives/Button/Button'
import s from './Connections.module.css'

/*
 * The code hosts and trackers Althar reaches for you: each service, who
 * you are signed in as there, or the one press that connects it. Connecting
 * is a walk of its own (ConnectCard), which the consumer opens: Connect for
 * a service, Sign in again for a connection whose sign-in stopped working,
 * Add a server for a company's own, and Add a workspace for another of a
 * service whose sign-in reaches one, once the service has a connection.
 * A service's connections sit in one soft group under its name, a row
 * each: where it reaches, who it signs in as, and its own Disconnect.
 */

export interface ServiceOption {
  /** The service: github, jira. */
  id: string
  name: string
  brand?: Brand
  /** A line on it while it isn't connected: what it is for, or where the projects' code on it is. */
  what?: string
  /** A company's own server can be connected too. */
  selfHosted?: boolean
  /** A sign-in reaches one of its workspaces, and another can be connected beside it: Linear's. */
  workspaces?: boolean
}

export interface ServiceConnection {
  id: string
  /** Which service, by its id. */
  service: string
  /** Who it signs in as: a login, or a name. */
  account: string
  /** Its server, when it isn't the hosted service. */
  instance?: string
  /** The workspace it reaches, by its name, where a sign-in reaches one. */
  workspace?: string
  /** Its token stopped working: it needs signing in again. */
  needsSignIn?: boolean
}

export interface ConnectionsText {
  notConnected: string
  signedInAs: (account: string) => string
  connect: string
  signInAgain: string
  addServer: string
  addWorkspace: string
  disconnect: string
  /** Disconnect's name for a screen reader, saying which it disconnects: Disconnect Blushh. */
  disconnectOne: (which: string) => string
  /** Sign in again's, the same way: Sign in again to Blushh. */
  signInAgainTo: (which: string) => string
}

export const connectionsText: ConnectionsText = {
  notConnected: 'Not connected',
  signedInAs: (account) => `Signed in as ${account}`,
  connect: 'Connect',
  signInAgain: 'Sign in again',
  addServer: 'Add a server',
  addWorkspace: 'Add a workspace',
  disconnect: 'Disconnect',
  disconnectOne: (which) => `Disconnect ${which}`,
  signInAgainTo: (which) => `Sign in again to ${which}`,
}

export interface ConnectionsProps {
  /** What the list is, for a screen reader: Code hosts and trackers. */
  label: string
  services: readonly ServiceOption[]
  connections: readonly ServiceConnection[]
  /** Opens a service's walk in. */
  onConnect: (service: string) => void
  /** Opens a connection's walk in again, for a new token or sign-in. */
  onSignInAgain: (connectionId: string) => void
  /** Opens a service's walk in at a company's own server. Without it, a connected service offers none. */
  onAddServer?: (service: string) => void
  /** Opens a service's walk in for another of its workspaces. Without it, a connected service offers none. */
  onAddWorkspace?: (service: string) => void
  onDisconnect: (connectionId: string) => void
  className?: string
  text?: Partial<ConnectionsText>
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/**
 * A connection by where it reaches, its workspace or server, over who it
 * signs in as there; by who alone where it reaches only the hosted service.
 * `which` names it for its buttons: its workspace or server, or the service.
 */
const namesOf = (connection: ServiceConnection, service: ServiceOption, t: ConnectionsText) => {
  const where = connection.workspace ?? (connection.instance === undefined ? undefined : hostOf(connection.instance))
  return where === undefined
    ? { first: t.signedInAs(connection.account), then: undefined, which: service.name }
    : { first: where, then: connection.account, which: where }
}

/** The services Althar can reach for you, each with who you are there, or how to connect it. */
export function Connections({
  label,
  services,
  connections,
  onConnect,
  onSignInAgain,
  onAddServer,
  onAddWorkspace,
  onDisconnect,
  className,
  text,
}: ConnectionsProps) {
  const t = { ...connectionsText, ...text }
  return (
    <ul aria-label={label} className={cx(s.list, className)}>
      {services.map((service) => {
        const mine = connections.filter((connection) => connection.service === service.id)
        return (
          <li key={service.id} className={s.service}>
            <div className={cx(s.row, s.head)}>
              <span className={s.mark}>
                {service.brand ? <BrandMark brand={service.brand} size={18} /> : <Icon name="plug" size={16} />}
              </span>
              <span className={s.name}>{service.name}</span>
              {mine.length === 0 && (
                <span className={cx(s.line, s.status)}>{service.what ? `${t.notConnected} · ${service.what}` : t.notConnected}</span>
              )}
              {mine.length === 0 && (
                <span className={s.actions}>
                  <Button onClick={() => onConnect(service.id)}>{t.connect}</Button>
                </span>
              )}
              {mine.length > 0 && service.selfHosted === true && onAddServer !== undefined && (
                <span className={s.actions}>
                  <ActionButton icon="plus" flush="end" onClick={() => onAddServer(service.id)}>
                    {t.addServer}
                  </ActionButton>
                </span>
              )}
              {mine.length > 0 && service.selfHosted !== true && service.workspaces === true && onAddWorkspace !== undefined && (
                <span className={s.actions}>
                  <ActionButton icon="plus" flush="end" onClick={() => onAddWorkspace(service.id)}>
                    {t.addWorkspace}
                  </ActionButton>
                </span>
              )}
            </div>
            {mine.length > 0 && (
              <ul aria-label={service.name} className={s.rows}>
                {mine.map((connection) => {
                  const { first, then, which } = namesOf(connection, service, t)
                  return (
                    <li key={connection.id} className={cx(s.connection, connection.needsSignIn && s.needs)}>
                      <span className={s.who}>
                        <span className={s.first} title={first}>
                          {first}
                        </span>
                        {then !== undefined && (
                          <span className={s.then} title={then}>
                            {then}
                          </span>
                        )}
                      </span>
                      <span className={s.actions}>
                        <ActionButton
                          aria-label={t.disconnectOne(which)}
                          {...(connection.needsSignIn ? {} : { flush: 'end' as const })}
                          onClick={() => onDisconnect(connection.id)}
                        >
                          {t.disconnect}
                        </ActionButton>
                        {connection.needsSignIn && (
                          <ActionButton
                            aria-label={t.signInAgainTo(which)}
                            tone="strong"
                            flush="end"
                            onClick={() => onSignInAgain(connection.id)}
                          >
                            {t.signInAgain}
                          </ActionButton>
                        )}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </li>
        )
      })}
    </ul>
  )
}
