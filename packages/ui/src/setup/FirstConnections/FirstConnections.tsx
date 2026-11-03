import type { ReactNode } from 'react'

import type { Brand } from '../../foundations/brands/brands'
import { Icon } from '../../foundations/Icon/Icon'
import { BrandMark } from '../../foundations/Marks/Marks'
import { cx } from '../../lib/cx'
import { SizeMotion } from '../../lib/SizeMotion'
import type { RootProps } from '../../lib/props'
import { Button } from '../../primitives/Button/Button'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { Menu, MenuItem } from '../../primitives/Menu/Menu'
import s from './FirstConnections.module.css'

/*
 * A new project's first word, in its empty conversation, while what its
 * tasks will need later isn't connected: a code host, for pull requests,
 * and a tracker, for issues. Tasks start without either.
 *
 * Where the project's code is, read from its repositories, its host is one
 * row with its place on it and Connect. Where the code names no host, every
 * host waits behind one Connect, in a menu with their marks; the trackers
 * always do, however many there are, so the card stays two rows. With a
 * host connected, it asks only for a tracker. A walk in opens in the card,
 * in place of its rows, from the same left edge as its head, and × puts the
 * card away. As it goes from its rows to a walk, and from one step of the
 * walk to the next, the card's height glides to what it holds (SizeMotion).
 */

/** A code host or a tracker, as the card offers it. */
export interface FirstConnectionsService {
  /** The service: github, linear. */
  readonly id: string
  readonly name: string
  readonly brand?: Brand
}

export interface FirstConnectionsText {
  title: string
  line: string
  /** With a code host connected, only a tracker is asked for. */
  issuesTitle: string
  issuesLine: string
  code: string
  issues: string
  connect: string
  /** What × does, said and read out. */
  hide: string
  /** The services behind a menu, by name: Linear, Jira or Trello. */
  either: (names: readonly string[]) => string
  /** The menus, read when they open. */
  hostsLabel: string
  trackersLabel: string
}

export const firstConnectionsText: FirstConnectionsText = {
  title: 'Before the first pull request',
  line: 'Tasks start without these. Connect them before a task needs to open a pull request or take an issue.',
  issuesTitle: 'Bring in your issues',
  issuesLine: 'Hand the coordinator an issue, and its task links back to it.',
  code: 'Code',
  issues: 'Issues',
  connect: 'Connect',
  hide: 'Not now',
  either: (names) => (names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`),
  hostsLabel: 'Code hosts',
  trackersLabel: 'Trackers',
}

export type FirstConnectionsProps = RootProps<
  'section',
  {
    /** Where the project's code is, on a host not connected yet: the host, and the place there. */
    host?: { readonly service: FirstConnectionsService; readonly where?: string }
    /** The code hosts to choose from, where the project's code names none and none is connected. */
    hosts?: readonly FirstConnectionsService[]
    /** The trackers, while none is connected. */
    trackers?: readonly FirstConnectionsService[]
    /** Opens a service's walk in. */
    onConnect: (service: string) => void
    /** Puts the card away. */
    onHide: () => void
    /** A walk in, open: it takes the rows' place, from the card's left edge (ConnectCard's `align="start"`). */
    walk?: ReactNode
    text?: Partial<FirstConnectionsText>
  }
>

/** What a new project's tasks will need later, to connect now or not: its code host, and a tracker. */
export function FirstConnections({
  host,
  hosts = [],
  trackers = [],
  onConnect,
  onHide,
  walk,
  className,
  text,
  ...rest
}: FirstConnectionsProps) {
  const t = { ...firstConnectionsText, ...text }
  const code = host !== undefined || hosts.length > 0
  if (!code && trackers.length === 0) return null
  return (
    <section aria-label={code ? t.title : t.issuesTitle} className={cx(s.card, className)} {...rest}>
      <div className={s.head}>
        <div className={s.words}>
          <h2 className={s.title}>{code ? t.title : t.issuesTitle}</h2>
          <p className={s.line}>{code ? t.line : t.issuesLine}</p>
        </div>
        <IconButton icon="close" label={t.hide} size="small" onClick={onHide} />
      </div>
      <SizeMotion step={walk === undefined ? 'rows' : 'walk'}>
        {walk ?? (
          <ul className={s.rows}>
            {host !== undefined && (
              <li className={s.row}>
                <span className={s.marks}>
                  <Mark service={host.service} />
                </span>
                <span className={s.name}>{host.service.name}</span>
                {host.where !== undefined && (
                  <span className={s.note} title={host.where}>
                    {host.where}
                  </span>
                )}
                <span className={s.end}>
                  <Button size="small" onClick={() => onConnect(host.service.id)}>
                    {t.connect}
                  </Button>
                </span>
              </li>
            )}
            {host === undefined && hosts.length > 0 && (
              <Behind label={t.hostsLabel} name={t.code} services={hosts} t={t} onConnect={onConnect} />
            )}
            {trackers.length > 0 && (
              <Behind label={t.trackersLabel} name={t.issues} services={trackers} t={t} onConnect={onConnect} quiet={code} />
            )}
          </ul>
        )}
      </SizeMotion>
    </section>
  )
}

/** A kind of service as one row: their marks side by side, its name, their names, and Connect opening a menu of them. */
function Behind({
  label,
  name,
  services,
  t,
  onConnect,
  quiet = false,
}: {
  label: string
  name: string
  services: readonly FirstConnectionsService[]
  t: FirstConnectionsText
  onConnect: (service: string) => void
  quiet?: boolean
}) {
  return (
    <li className={s.row}>
      <span className={s.marks} aria-hidden="true">
        {services.map((service) => (
          <Mark key={service.id} service={service} />
        ))}
      </span>
      <span className={s.name}>{name}</span>
      <span className={s.note}>{t.either(services.map((service) => service.name))}</span>
      <span className={s.end}>
        <Menu
          label={label}
          align="end"
          trigger={
            <Button size="small" variant={quiet ? 'quiet' : 'default'} trailingIcon="down">
              {t.connect}
            </Button>
          }
        >
          {services.map((service) => (
            <MenuItem key={service.id} lead={<Mark service={service} size={14} />} onSelect={() => onConnect(service.id)}>
              {service.name}
            </MenuItem>
          ))}
        </Menu>
      </span>
    </li>
  )
}

function Mark({ service, size = 16 }: { service: FirstConnectionsService; size?: number }) {
  return service.brand ? <BrandMark brand={service.brand} size={size} /> : <Icon name="plug" size={size} />
}
