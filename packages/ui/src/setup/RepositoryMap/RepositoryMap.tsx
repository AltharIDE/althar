import { type ReactNode, useEffectEvent, useId, useLayoutEffect, useRef, useState } from 'react'

import { device } from '../../foundations/device'
import type { Brand } from '../../foundations/brands/brands'
import { Icon } from '../../foundations/Icon/Icon'
import { BrandMark } from '../../foundations/Marks/Marks'
import { ChangeTarget, HostReach, RepositoryRole, unreachable } from '../../foundations/vocabulary'
import { repositoryRoleText } from '../../foundations/vocabularyText'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { safeHref } from '../../lib/safeHref'
import { Button } from '../../primitives/Button/Button'
import { below, Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { Menu, MenuItem, MenuSeparator } from '../../primitives/Menu/Menu'
import { Select } from '../../primitives/Select/Select'
import { Spinner } from '../../primitives/Spinner/Spinner'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import s from './RepositoryMap.module.css'

/*
 * Where a project's repositories are, and where their work goes: the
 * folders on this device on the left, the code hosts their remotes are on
 * on the right, and a hairline from each folder to its remote. A fork has
 * two: it pushes to the fork, and its pull requests open on the repository
 * it forks, or on the fork, as the person says. A host Althar isn't
 * connected to sits apart, its wires dashed, with what connecting adds. A
 * folder being read waits on the left until its repositories are known.
 */

/** One of the project's repositories, as this device has it. */
export interface MapRepository {
  id: string
  name: string
  /** Where it is on this device, as the person reads it: ~/code/meridian-app. Without it, it isn't on this device. */
  where?: string
  /** The branch checked out there. */
  branch?: string
  role: RepositoryRole
  /** Tasks under way that change it: they keep it if it is left out. */
  tasks: number
  /** Where its work goes: the host, by its id among the hosts, its path there, and its page. Without it, the work stays here. */
  remote?: { host: string; path: string; href?: string }
  /** The fork it is: the repository it forks, on the same host, by its path there, and where its pull requests open. */
  fork?: { upstream: string; target: ChangeTarget }
}

/** A code host the repositories' work goes to. */
export interface MapHost {
  id: string
  /** GitHub; or a host Althar doesn't know, by its address. */
  name: string
  brand?: Brand
  /** A company's own server, by its address, where the name alone would say the hosted service. */
  instance?: string
  reach: HostReach
  /** Who Althar is signed in as there. */
  account?: string
}

/** A folder being read, before the repositories in it are known. */
export interface ReadingFolder {
  id: string
  name: string
  where: string
}

export interface RepositoryMapText {
  here: string
  there: string
  roles: Record<RepositoryRole, string>
  role: (name: string) => string
  /** Before the branch, for a screen reader. */
  branch: string
  /** Where one is, when it isn't on this device. */
  elsewhere: string
  more: (name: string) => string
  open: (host: string) => string
  leaveOut: string
  /** What leaving one out keeps: its tasks under way keep it. */
  keeps: (tasks: number) => string
  untouched: string
  reading: string
  /** Where tasks work; the folder comes as code. */
  worktrees: (folder: ReactNode) => ReactNode
  /** Before the project has had a task, and its worktrees' folder is made. */
  worktreesUnmade: string
  pushes: string
  pullRequests: string
  /** A fork's one wire, when its pull requests open on the fork it pushes to. */
  both: string
  fork: string
  upstream: string
  target: string
  targetLabel: (name: string) => string
  reach: {
    connected: (account: string | undefined) => string
    notConnected: string
    signInAgain: string
    unknown: string
  }
  what: Record<HostReach, string>
  connect: (host: string) => string
  signInAgain: (host: string) => string
  /** The group for repositories with no remote. */
  nowhere: string
  stays: string
  /** Where a repository's work goes, said on its card for a screen reader, as the wires draw it. */
  goes: (path: string, host: string) => string
  forkGoes: (fork: string, pullRequests: string, host: string) => string
  staysHere: string
}

export const repositoryMapText: RepositoryMapText = {
  here: `On ${device.this}`,
  there: 'Where the work goes',
  roles: repositoryRoleText,
  role: (name) => `Role of ${name}`,
  branch: 'Checked out:',
  elsewhere: `Not on ${device.this}`,
  more: (name) => `More for ${name}`,
  open: (host) => `Open on ${host}`,
  leaveOut: 'Leave out of the project',
  keeps: (tasks) => (tasks === 1 ? 'The task using it keeps it' : `The ${tasks} tasks using it keep it`),
  untouched: 'Nothing in its folder changes',
  reading: 'Reading it. Nothing in it changes',
  worktrees: (folder) => <>Tasks work in their own worktrees, in {folder}</>,
  worktreesUnmade: 'Tasks work in their own worktrees, never in these folders',
  pushes: 'pushes',
  pullRequests: 'pull requests',
  both: 'pushes, pull requests',
  fork: 'Your fork',
  upstream: 'The repository it forks',
  target: 'Pull requests open on',
  targetLabel: (name) => `Where ${name}’s pull requests open`,
  reach: {
    connected: (account) => (account === undefined ? 'Connected' : `Connected as ${account}`),
    notConnected: 'Not connected',
    signInAgain: 'Its sign-in stopped working',
    unknown: 'Not a host Althar connects to',
  },
  what: {
    [HostReach.Connected]: 'Althar opens the pull requests here, and brings their checks and reviews back',
    [HostReach.NotConnected]:
      'Branches push with your own git; you open the pull request. Connected, Althar does, and brings its checks and reviews back',
    [HostReach.SignInAgain]: 'Branches push with your own git until you sign in again',
    [HostReach.Unknown]: 'Branches push with your own git; you open the pull request',
  },
  connect: (host) => `Connect ${host}`,
  signInAgain: (host) => `Sign in to ${host} again`,
  nowhere: 'No remote',
  stays: `Stays on ${device.this}`,
  goes: (path, host) => `Its work goes to ${path} on ${host}.`,
  forkGoes: (fork, pullRequests, host) => `It pushes to ${fork} on ${host}, and its pull requests open on ${pullRequests}.`,
  staysHere: `Its work stays on ${device.this}.`,
}

export type RepositoryMapProps = RootProps<
  'div',
  {
    repositories: readonly MapRepository[]
    hosts: readonly MapHost[]
    /** Folders being read, waiting under the repositories. */
    reading?: readonly ReadingFolder[]
    /** Where tasks' worktrees are, as the person reads it; without it, the folder isn't made yet. */
    worktrees?: string
    onRoleChange: (id: string, role: RepositoryRole) => void
    onTargetChange: (id: string, target: ChangeTarget) => void
    /** Leaves one out: offered in its menu, never for the last. */
    onLeaveOut?: (id: string) => void
    /** Opens a repository's page on its host. Without it, there is no way to. */
    onOpen?: (href: string) => void
    /** Connects a host, or signs in to it again. Without it, there is no way to here. */
    onConnect?: (host: string) => void
    /** The rank of the columns' headings; the hosts' are one below. */
    headingLevel?: HeadingLevel
    text?: Partial<RepositoryMapText>
  }
>

const ROLES = [
  RepositoryRole.Service,
  RepositoryRole.Frontend,
  RepositoryRole.Infrastructure,
  RepositoryRole.Library,
  RepositoryRole.Docs,
  RepositoryRole.Other,
] as const

/** A hairline from a folder to where its work goes, by the folder and the remote it ends at. */
interface Edge {
  id: string
  from: string
  to: string
  dashed: boolean
  label?: string
}

/** An edge as drawn: its curve, its ends, and where its label sits. */
interface Wire extends Edge {
  d: string
  x1: number
  y1: number
  x2: number
  y2: number
  lx: number
  ly: number
  /** It arrived after the map was first drawn, so it draws itself in. */
  fresh: boolean
}

/** A ref that keeps a folder's card, or a remote, by its id, until it goes. */
type Keep = (kind: 'card' | 'node', id: string) => (element: HTMLElement | null) => (() => void) | undefined

/** How far down a folder's card its wire leaves: level with its name. */
const LEAVES = 30

/** Where along a wire its label sits: nearer its end, where a fork's two wires part. */
const LABEL_AT = 0.7

/** The wires, from where the cards and remotes are now inside the map. */
const wiresOf = (
  root: HTMLElement,
  edges: readonly Edge[],
  cards: ReadonlyMap<string, HTMLElement>,
  nodes: ReadonlyMap<string, HTMLElement>,
  known: Set<string> | null,
): Wire[] => {
  const box = root.getBoundingClientRect()
  return edges.flatMap((edge) => {
    const a = cards.get(edge.from)?.getBoundingClientRect()
    const b = nodes.get(edge.to)?.getBoundingClientRect()
    if (a === undefined || b === undefined) return []
    const x1 = a.right - box.left
    const y1 = a.top - box.top + LEAVES
    const x2 = b.left - box.left
    const y2 = b.top - box.top + b.height / 2
    const mid = (x1 + x2) / 2
    const t = LABEL_AT
    const u = 1 - t
    return [
      {
        ...edge,
        d: `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`,
        x1,
        y1,
        x2,
        y2,
        lx: u * u * u * x1 + 3 * u * u * t * mid + 3 * u * t * t * mid + t * t * t * x2,
        ly: u * u * u * y1 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y2,
        fresh: known !== null && !known.has(edge.id),
      },
    ]
  })
}

/** A host's words beside its name: who Althar is there, or that it isn't. */
const reachWords = (host: MapHost, t: RepositoryMapText) => {
  switch (host.reach) {
    case HostReach.Connected:
      return t.reach.connected(host.account)
    case HostReach.NotConnected:
      return t.reach.notConnected
    case HostReach.SignInAgain:
      return t.reach.signInAgain
    case HostReach.Unknown:
      return t.reach.unknown
    default:
      return unreachable(host.reach)
  }
}

/** Where a repository's work goes, in words, for those who can't see the wires. */
const goesWords = (repository: MapRepository, hostOf: (id: string) => MapHost | undefined, t: RepositoryMapText) => {
  const { remote, fork } = repository
  if (remote === undefined) return t.staysHere
  const host = hostOf(remote.host)?.name ?? remote.host
  if (fork === undefined) return t.goes(remote.path, host)
  return t.forkGoes(remote.path, fork.target === ChangeTarget.Fork ? remote.path : fork.upstream, host)
}

/** What the host's button does: connect it, sign in to it again, or nothing for a host Althar doesn't connect to. */
const connectWords = (host: MapHost, t: RepositoryMapText) => {
  switch (host.reach) {
    case HostReach.NotConnected:
      return t.connect(host.name)
    case HostReach.SignInAgain:
      return t.signInAgain(host.name)
    case HostReach.Connected:
    case HostReach.Unknown:
      return null
    default:
      return unreachable(host.reach)
  }
}

export function RepositoryMap({
  repositories,
  hosts,
  reading = [],
  worktrees,
  onRoleChange,
  onTargetChange,
  onLeaveOut,
  onOpen,
  onConnect,
  headingLevel = 2,
  text,
  className,
  ref,
  ...rest
}: RepositoryMapProps) {
  const t = { ...repositoryMapText, ...text }
  const hereId = useId()
  const box = useRef<HTMLDivElement | null>(null)
  const columns = useRef<HTMLElement[]>([])
  const cards = useRef(new Map<string, HTMLElement>())
  const nodes = useRef(new Map<string, HTMLElement>())
  // The wires drawn once the map was first measured: any after it draws itself in.
  const known = useRef<Set<string> | null>(null)
  const [wires, setWires] = useState<Wire[]>([])

  const hostOf = (id: string) => hosts.find((host) => host.id === id)
  const connected = (id: string) => hostOf(id)?.reach === HostReach.Connected
  const edges: Edge[] = repositories.flatMap((repository): Edge[] => {
    const remote = repository.remote
    if (remote === undefined) return []
    const dashed = !connected(remote.host)
    if (repository.fork === undefined) return [{ id: repository.id, from: repository.id, to: repository.id, dashed }]
    // A fork's pull requests open where the person said: on the repository it forks, or on the fork it pushes to.
    const fork = { id: `${repository.id}:fork`, from: repository.id, to: `${repository.id}:fork`, dashed }
    return repository.fork.target === ChangeTarget.Fork
      ? [{ ...fork, label: t.both }]
      : [
          { ...fork, label: t.pushes },
          { id: `${repository.id}:upstream`, from: repository.id, to: `${repository.id}:upstream`, dashed, label: t.pullRequests },
        ]
  })
  // What moves a wire: which there are, how each is drawn, and anything that changes where the cards and remotes sit.
  const layout = JSON.stringify([edges, repositories, hosts, reading, worktrees])
  const drawn = useRef('')
  const measure = useEffectEvent(() => {
    const root = box.current
    if (root === null) return
    const next = wiresOf(root, edges, cards.current, nodes.current, known.current)
    known.current = new Set([...(known.current ?? []), ...next.map((wire) => wire.id)])
    const key = JSON.stringify(next)
    if (key === drawn.current) return
    drawn.current = key
    setWires(next)
  })

  useLayoutEffect(() => {
    measure()
    // Redrawn as the map, its columns, a card or a remote changes size: the window, a name that wraps, a card added.
    const root = box.current
    if (root === null || typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(() => measure())
    for (const element of [root, ...columns.current, ...cards.current.values(), ...nodes.current.values()]) watch.observe(element)
    // And once the type has loaded, which moves everything a little.
    let on = true
    void document.fonts?.ready.then(() => on && measure())
    return () => {
      on = false
      watch.disconnect()
    }
  }, [layout])

  /** Keeps a card or a remote's element by its id while it is on the page, for the wires to find. */
  const keep: Keep = (kind, id) => (element) => {
    if (element === null) return undefined
    const map = (kind === 'card' ? cards : nodes).current
    map.set(id, element)
    return () => {
      if (map.get(id) === element) map.delete(id)
    }
  }
  const column = (index: number) => (element: HTMLElement | null) => {
    if (element !== null) columns.current[index] = element
  }

  // The remotes by host, in the order their repositories come; those with none together at the end.
  const groups = hosts.flatMap((host) => {
    const theirs = repositories.filter((repository) => repository.remote?.host === host.id)
    return theirs.length === 0 ? [] : [{ host, repositories: theirs }]
  })
  const nowhere = repositories.filter((repository) => repository.remote === undefined)
  // The last one stays, whatever is being read: a folder may add nothing.
  const last = repositories.length === 1

  return (
    <div
      ref={(element) => {
        box.current = element
        if (typeof ref === 'function') return ref(element)
        if (ref) ref.current = element
        return undefined
      }}
      className={cx(s.map, className)}
      {...rest}
    >
      <svg className={s.wires} aria-hidden="true">
        {wires.map((wire) => (
          <g key={wire.id} className={cx(wire.dashed && s.dashed, wire.fresh && s.fresh)}>
            {/* A solid wire measures its length as 1, to draw itself in; a dashed one keeps its own, for even dashes. */}
            <path d={wire.d} {...(wire.dashed ? {} : { pathLength: 1 })} />
            <circle cx={wire.x1} cy={wire.y1} r="2.5" />
            <circle cx={wire.x2} cy={wire.y2} r="2.5" />
          </g>
        ))}
      </svg>
      {wires.map(
        (wire) =>
          wire.label !== undefined && (
            <span key={`${wire.id}:label`} className={s.wireLabel} style={{ left: wire.lx, top: wire.ly }} aria-hidden="true">
              {wire.label}
            </span>
          ),
      )}

      <div className={s.column} ref={column(0)}>
        <Heading level={headingLevel} id={hereId} className={s.columnHead}>
          {t.here}
        </Heading>
        <ul className={s.repositories} aria-labelledby={hereId}>
          {repositories.map((repository) => (
            <li key={repository.id} ref={keep('card', repository.id)} className={s.repository}>
              <div className={s.top}>
                <Icon name="folder" size={14} className={s.folder} />
                <span className={s.name}>{repository.name}</span>
                <RepositoryMenu
                  repository={repository}
                  host={repository.remote === undefined ? undefined : hostOf(repository.remote.host)}
                  last={last}
                  t={t}
                  {...(onOpen === undefined ? {} : { onOpen })}
                  {...(onLeaveOut === undefined ? {} : { onLeaveOut })}
                />
              </div>
              <span className={cx(s.where, repository.where === undefined && s.elsewhere)}>{repository.where ?? t.elsewhere}</span>
              {/* What the wires draw, said: where its work goes. */}
              <VisuallyHidden>{goesWords(repository, hostOf, t)}</VisuallyHidden>
              <div className={s.foot}>
                {repository.branch !== undefined && (
                  <span className={s.branch}>
                    <Icon name="branch" size={11} />
                    <VisuallyHidden>{t.branch} </VisuallyHidden>
                    <code>{repository.branch}</code>
                  </span>
                )}
                <Select
                  label={t.role(repository.name)}
                  variant="quiet"
                  className={s.role}
                  options={ROLES.map((role) => ({ value: role, label: t.roles[role] }))}
                  value={repository.role}
                  onChange={(role) => onRoleChange(repository.id, role)}
                />
              </div>
            </li>
          ))}
          {reading.map((folder) => (
            <li key={folder.id} className={cx(s.repository, s.reading)} aria-busy="true">
              <div className={s.top}>
                <Spinner size="small" />
                <span className={s.name}>{folder.name}</span>
              </div>
              <span className={s.where}>{folder.where}</span>
              <span className={s.readingNote}>{t.reading}</span>
            </li>
          ))}
        </ul>
        <p className={s.worktrees}>{worktrees === undefined ? t.worktreesUnmade : t.worktrees(<code>{worktrees}</code>)}</p>
      </div>

      <div className={cx(s.column, s.hosts)} ref={column(1)}>
        <Heading level={headingLevel} className={s.columnHead}>
          {t.there}
        </Heading>
        {groups.map(({ host, repositories: theirs }) => {
          const button = onConnect === undefined ? null : connectWords(host, t)
          return (
            <HostGroup key={host.id} host={host} level={below(headingLevel)} t={t}>
              {theirs.map((repository) => (
                <Remotes key={repository.id} repository={repository} keep={keep} t={t} onTargetChange={onTargetChange} />
              ))}
              {host.reach === HostReach.Connected ? (
                <p className={s.what}>{t.what[host.reach]}</p>
              ) : (
                <div className={s.off}>
                  <p className={s.what}>{t.what[host.reach]}</p>
                  {button !== null && (
                    <Button size="small" onClick={() => onConnect?.(host.id)}>
                      {button}
                    </Button>
                  )}
                </div>
              )}
            </HostGroup>
          )
        })}
        {nowhere.length > 0 && (
          <section className={cx(s.host, s.away)} aria-label={t.nowhere}>
            <div className={s.hostHead}>
              <Icon name="folder" size={15} className={s.hostMark} />
              <Heading level={below(headingLevel)} className={s.hostName}>
                {t.nowhere}
              </Heading>
            </div>
            {nowhere.map((repository) => (
              <div key={repository.id} className={s.node}>
                <code>{repository.name}</code>
                <span className={s.nodeNote}>{t.stays}</span>
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  )
}

/** A host, by its mark and name, saying who Althar is there, with the remotes on it. */
function HostGroup({ host, level, t, children }: { host: MapHost; level: HeadingLevel; t: RepositoryMapText; children: ReactNode }) {
  const nameId = useId()
  return (
    <section className={cx(s.host, host.reach !== HostReach.Connected && s.away)} aria-labelledby={nameId}>
      <div className={s.hostHead}>
        {host.brand === undefined ? (
          <Icon name="globe" size={15} className={s.hostMark} />
        ) : (
          <BrandMark brand={host.brand} size={15} className={s.hostMark} />
        )}
        <Heading level={level} id={nameId} className={s.hostName}>
          {host.name}
        </Heading>
        {host.instance !== undefined && <span className={s.instance}>{host.instance}</span>}
        <span className={s.reach}>{reachWords(host, t)}</span>
      </div>
      {children}
    </section>
  )
}

/** A repository's remotes on its host: the one it pushes to, and for a fork, the one it forks and where its pull requests open. */
function Remotes({
  repository,
  keep,
  t,
  onTargetChange,
}: {
  repository: MapRepository
  keep: Keep
  t: RepositoryMapText
  onTargetChange: (id: string, target: ChangeTarget) => void
}) {
  const { remote, fork } = repository
  if (remote === undefined) return null
  if (fork === undefined)
    return (
      <div ref={keep('node', repository.id)} className={s.node}>
        <code>{remote.path}</code>
      </div>
    )
  return (
    <>
      <div ref={keep('node', `${repository.id}:fork`)} className={s.node}>
        <code>{remote.path}</code>
        <span className={s.nodeNote}>{t.fork}</span>
      </div>
      <div ref={keep('node', `${repository.id}:upstream`)} className={s.node}>
        <code>{fork.upstream}</code>
        <span className={s.nodeNote}>{t.upstream}</span>
      </div>
      <div className={s.target}>
        <span aria-hidden="true">{t.target}</span>
        <Select
          label={t.targetLabel(repository.name)}
          variant="quiet"
          className={s.targetSelect}
          options={[
            { value: ChangeTarget.Upstream, label: fork.upstream },
            { value: ChangeTarget.Fork, label: remote.path },
          ]}
          value={fork.target}
          onChange={(target) => onTargetChange(repository.id, target)}
        />
      </div>
    </>
  )
}

/** What else can be done with a repository: open its page on its host, or leave it out of the project, never the last. */
function RepositoryMenu({
  repository,
  host,
  last,
  t,
  onOpen,
  onLeaveOut,
}: {
  repository: MapRepository
  host: MapHost | undefined
  last: boolean
  t: RepositoryMapText
  onOpen?: (href: string) => void
  onLeaveOut?: (id: string) => void
}) {
  const href = safeHref(repository.remote?.href)
  const open = href !== undefined && host !== undefined && onOpen !== undefined
  const leave = !last && onLeaveOut !== undefined
  if (!open && !leave) return null
  return (
    <Menu
      label={repository.name}
      align="end"
      width={240}
      trigger={<IconButton icon="more" size="small" label={t.more(repository.name)} className={s.more} />}
    >
      {open && (
        <MenuItem icon="external" onSelect={() => onOpen(href)}>
          {t.open(host.name)}
        </MenuItem>
      )}
      {open && leave && <MenuSeparator />}
      {leave && (
        <MenuItem
          icon="close"
          tone="danger"
          description={repository.tasks > 0 ? t.keeps(repository.tasks) : t.untouched}
          onSelect={() => onLeaveOut(repository.id)}
        >
          {t.leaveOut}
        </MenuItem>
      )}
    </Menu>
  )
}
