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
 * and Add a server for a company's own, once the service has a connection.
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
}

export interface ServiceConnection {
  id: string
  /** Which service, by its id. */
  service: string
  /** Who it signs in as: a login, or a name. */
  account: string
  /** Its server, when it isn't the hosted service. */
  instance?: string
  /** Its token stopped working: it needs signing in again. */
  needsSignIn?: boolean
}

export interface ConnectionsText {
  notConnected: string
  signedInAs: (account: string) => string
  needsSignIn: string
  connect: string
  signInAgain: string
  addServer: string
  disconnect: string
}

export const connectionsText: ConnectionsText = {
  notConnected: 'Not connected',
  signedInAs: (account) => `Signed in as ${account}`,
  needsSignIn: 'Its sign-in stopped working',
  connect: 'Connect',
  signInAgain: 'Sign in again',
  addServer: 'Add a server',
  disconnect: 'Disconnect',
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

/** The services Althar can reach for you, each with who you are there, or how to connect it. */
export function Connections({
  label,
  services,
  connections,
  onConnect,
  onSignInAgain,
  onAddServer,
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
            </div>
            {mine.map((connection) => (
              <div key={connection.id} className={cx(s.row, s.account)}>
                <span />
                <span className={s.body}>
                  <span className={cx(s.line, connection.needsSignIn && s.calls)}>
                    {connection.needsSignIn ? t.needsSignIn : t.signedInAs(connection.account)}
                    {connection.instance && <span className={s.instance}> · {hostOf(connection.instance)}</span>}
                  </span>
                </span>
                <span className={s.actions}>
                  <ActionButton {...(connection.needsSignIn ? {} : { flush: 'end' as const })} onClick={() => onDisconnect(connection.id)}>
                    {t.disconnect}
                  </ActionButton>
                  {connection.needsSignIn && (
                    <Button variant="signal" onClick={() => onSignInAgain(connection.id)}>
                      {t.signInAgain}
                    </Button>
                  )}
                </span>
              </div>
            ))}
          </li>
        )
      })}
    </ul>
  )
}
