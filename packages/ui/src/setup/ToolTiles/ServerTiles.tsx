import { type ReactNode, useRef, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { BrandMark } from '../../foundations/Marks/Marks'
import { useControlled } from '../../lib/controlled'
import { cx } from '../../lib/cx'
import { ListMotion } from '../../lib/ListMotion'
import { below, type HeadingLevel } from '../../primitives/Heading/Heading'
import { Button } from '../../primitives/Button/Button'
import { Dialog } from '../../primitives/Dialog/Dialog'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Problem } from '../../primitives/Problem/Problem'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import { ControlDetail, ControlLine, ControlModule, ControlToggle } from '../ControlCenter/ControlCenter'
import { SERVER_STARTERS } from './starters'
import {
  AddTile,
  escapeBack,
  projectName,
  reachOf,
  StarterTile,
  TileGrid,
  TileLine,
  TilesFailed,
  TilesKind,
  TilesLoading,
  ToolGroup,
  ToolsEmpty,
  ToolTile,
  toolWordsText,
  type ToolWordsText,
  useBackFocus,
} from './ToolParts'
import {
  type ServerStarter,
  type ServerTileModel,
  TOOL_ROLES,
  type ToolAgentView,
  type ToolProjectView,
  type ToolRoleId,
  type ToolSyncChange,
  type ToolSyncModel,
} from './tools'
import s from './ToolTiles.module.css'

/*
 * Settings › MCP servers, as tiles (ADR-097): a tile per server of the
 * person's, three across like the quick cards. Its round switch gives it to
 * every role or none; its name opens it in place, with a way back that
 * returns focus to the tile. Under the name, what waits first: it failed to
 * start (red), then what waits on the person (violet): it runs two ways, or
 * an agent isn't signed in; else who gets it and where. Failed tiles sort
 * first, then those that wait, and the list moves as a whole when that
 * changes. Add a server is the dashed tile at the end. A repository's own
 * (`.mcp.json`) sit in a group of their own. Then the person's agents
 * outside Althar: Same servers everywhere, which says before it turns on
 * what each agent gets and what it leaves alone, and asks on the way off
 * whether what it copied stays; and What it changed, while it changed
 * something, which opens to each change with its Undo.
 */

export interface ServerTilesText extends ToolWordsText {
  failed: string
  twoWays: (agent: string) => string
  /** Who isn't signed in: all of those that run it, or some. */
  notSignedIn: (agents: readonly string[], all: boolean) => string
  add: string
  noneTitle: string
  noneLine: string
  oftenAdded: string
  another: string
  /** A starter tile, for a screen reader: Add github. */
  addStarter: (name: string) => string
  outside: string
  same: string
  changed: string
  copied: (name: string, from: string, to: string) => string
  tookOut: (name: string, from: string) => string
  undo: string
  putBack: string
  undone: string
  keepTitle: string
  keepWhat: string
  keepLater: string
  adds: (names: string) => string
  nothingToAdd: string
  leaves: string
  leave: readonly string[]
  copy: string
  turnOn: string
  cancel: string
  offTitle: string
  offWhat: (n: number) => string
  takeBack: string
  keepThem: string
}

export const serverTilesText: ServerTilesText = {
  ...toolWordsText,
  failed: 'Failed to start',
  twoWays: (agent) => `${agent} runs it another way`,
  notSignedIn: (agents, all) => (all ? 'Not signed in yet' : `${and(agents)} ${agents.length === 1 ? 'isn’t' : 'aren’t'} signed in`),
  add: 'Add a server',
  noneTitle: 'No MCP servers yet',
  noneLine: 'Add one here, or to any of your agents: Althar reads each one’s own file.',
  oftenAdded: 'Often added',
  another: 'Another server',
  addStarter: (name) => `Add ${name}`,
  outside: 'Your agents outside Althar',
  same: 'Same servers everywhere',
  changed: 'What it changed',
  copied: (name, from, to) => `You added ${name} to ${from}. Copied to ${to}.`,
  tookOut: (name, from) => `You took ${name} out of ${from}. It stays out there.`,
  undo: 'Undo',
  putBack: 'Put it back',
  undone: 'Undone',
  keepTitle: 'Give your agents the same servers?',
  keepWhat:
    'Althar writes each server into Claude Code’s, Codex’s and OpenCode’s own settings, so each has them when you use it on its own.',
  keepLater: 'A server you add to one later goes to the others. Each agent picks up a change when it next starts.',
  adds: (names) => `Adds ${names}`,
  nothingToAdd: 'Nothing to add',
  leaves: 'It leaves alone',
  leave: [
    'A server already in an agent, set up as you set it, on or off.',
    'One you take out of an agent: it stays out there.',
    'Sign-ins and tokens. Each agent signs in on its own; a token is copied as the name of its variable, never its value.',
  ],
  copy: 'It keeps a copy of each file before changing it, and turning it off can take back what it added.',
  turnOn: 'Turn on',
  cancel: 'Cancel',
  offTitle: 'Stop giving them the same servers?',
  offWhat: (n) =>
    n === 0
      ? 'It added nothing to your agents’ settings.'
      : `It added ${n} ${n === 1 ? 'server' : 'servers'} to your agents’ settings. They can stay, or come out of each.`,
  takeBack: 'Take them out',
  keepThem: 'Leave them in',
}

const and = toolWordsText.and

export interface ServerTilesProps {
  servers: readonly ServerTileModel[]
  /** The person's agents, with where each keeps its servers. */
  agents: readonly ToolAgentView[]
  /** The projects, for where a server is given and whose repository holds one. */
  projects: readonly ToolProjectView[]
  sync: ToolSyncModel
  /** The servers are still being read: their place, in their shape. */
  loading?: boolean
  /** Why they couldn't be read, in words; with `onRetry`, Try again beside it. */
  error?: string | null
  onRetry?: () => void
  /** The open server's id; null for the tiles. */
  open?: string | null
  defaultOpen?: string | null
  onOpenChange?: (id: string | null) => void
  /** An opened server, in place of the tiles: a ServerSheet, given its way back. Without it, a name opens nothing. */
  sheet?: (server: ServerTileModel, back: () => void) => ReactNode
  /** A tile's round switch: every role, or none. */
  onRoles: (server: ServerTileModel, roles: readonly ToolRoleId[]) => void
  /** Add a server, or one often added, filled in: the consumer opens an AddServerDialog. Without it, nothing offers to add. */
  onAdd?: (start: ServerStarter | null) => void
  /** Same servers everywhere, on; or off, with what it copied left in or taken back out. */
  onSync: (on: boolean, takeBack: boolean) => void
  /** Undo a change it made, or put back one taken out. */
  onUndo?: (id: string) => void
  /** The rank of the groups' names: one under the section's title. */
  headingLevel?: HeadingLevel
  className?: string
  text?: Partial<ServerTilesText>
}

/** What waits first on a server, if anything: it failed; it runs two ways while sync is on; an agent that runs it isn't signed in. */
export const serverWaits = (
  server: ServerTileModel,
  agents: readonly ToolAgentView[],
  sync: boolean,
  t: Pick<ServerTilesText, 'failed' | 'twoWays' | 'notSignedIn'>,
): { tone: 'failed' | 'yours'; words: string } | null => {
  if (server.failed !== null) return { tone: 'failed', words: t.failed }
  const differs = agents.find((agent) => server.here[agent.id] === 'differs')
  if (sync && differs !== undefined) return { tone: 'yours', words: t.twoWays(differs.name) }
  const runs = agents.filter((agent) => server.signIn[agent.id] !== undefined && server.signIn[agent.id] !== 'none')
  const left = runs.filter((agent) => server.signIn[agent.id] === 'no')
  if (left.length > 0)
    return {
      tone: 'yours',
      words: t.notSignedIn(
        left.map((agent) => agent.name),
        left.length === runs.length && left.length > 1,
      ),
    }
  return null
}

const rank = (waits: ReturnType<typeof serverWaits>) => (waits === null ? 2 : waits.tone === 'failed' ? 0 : 1)

const CHANGES = 'what-it-changed'

/** Settings › MCP servers: the person's servers as tiles, a repository's own, and their agents outside Althar. */
export function ServerTiles({
  servers,
  agents,
  projects,
  sync,
  loading = false,
  error = null,
  onRetry,
  open,
  defaultOpen = null,
  onOpenChange,
  sheet,
  onRoles,
  onAdd,
  onSync,
  onUndo,
  headingLevel = 3,
  className,
  text,
}: ServerTilesProps) {
  const t = { ...serverTilesText, ...text }
  const root = useRef<HTMLDivElement>(null)
  const [openId, setOpen] = useControlled(open, defaultOpen, onOpenChange)
  const [changes, setChanges] = useState(false)
  const opened = sheet === undefined ? undefined : servers.find((one) => one.id === openId)
  const shown = opened !== undefined ? opened.id : changes ? CHANGES : null
  useBackFocus(root, shown)

  const tile = (server: ServerTileModel) => {
    const waits = serverWaits(server, agents, sync.on, t)
    return (
      <ToolTile
        key={server.id}
        tileKey={server.id}
        name={server.name}
        brand={server.brand}
        line={waits === null ? reachOf(server, projects, t) : <TileLine tone={waits.tone}>{waits.words}</TileLine>}
        on={server.roles.length > 0}
        onChange={(on) => onRoles(server, on ? TOOL_ROLES : [])}
        onOpen={sheet === undefined ? undefined : () => setOpen(server.id)}
      />
    )
  }
  const sorted = (list: readonly ServerTileModel[]) =>
    list
      .map((server, at) => ({ server, at, rank: rank(serverWaits(server, agents, sync.on, t)) }))
      .sort((a, b) => a.rank - b.rank || a.server.name.localeCompare(b.server.name))
      .map((one) => one.server)

  let body: ReactNode
  if (opened !== undefined && sheet !== undefined) body = sheet(opened, () => setOpen(null))
  else if (changes)
    body = (
      <Changes
        changes={sync.changes ?? []}
        agents={agents}
        onBack={() => setChanges(false)}
        onUndo={onUndo}
        headingLevel={headingLevel}
        t={t}
      />
    )
  else if (loading) body = <TilesLoading label={t.loading} />
  else if (error !== null) body = <TilesFailed error={error} retry={t.retry} onRetry={onRetry} />
  else {
    const yours = sorted(servers.filter((one) => one.repository === null))
    const repositories = [...new Set(servers.flatMap((one) => (one.repository === null ? [] : [one.repository])))]
    body = (
      <ListMotion within={root}>
        {yours.length === 0 ? (
          <ToolsEmpty
            icon="plug"
            title={t.noneTitle}
            line={t.noneLine}
            places={agents.map((agent) => ({ id: agent.id, name: agent.name, brand: agent.brand, path: agent.file }))}
            headingLevel={headingLevel}
          >
            {onAdd !== undefined && (
              <>
                <TilesKind headingLevel={below(headingLevel)}>{t.oftenAdded}</TilesKind>
                <TileGrid>
                  {SERVER_STARTERS.map((starter) => (
                    <StarterTile
                      key={starter.name}
                      name={starter.name}
                      brand={starter.brand}
                      line={startsAt(starter)}
                      label={t.addStarter(starter.name)}
                      onClick={() => onAdd(starter)}
                    />
                  ))}
                  <AddTile onClick={() => onAdd(null)}>{t.another}</AddTile>
                </TileGrid>
              </>
            )}
          </ToolsEmpty>
        ) : (
          <TileGrid>
            {yours.map(tile)}
            {onAdd !== undefined && <AddTile onClick={() => onAdd(null)}>{t.add}</AddTile>}
          </TileGrid>
        )}
        {repositories.map((project) => (
          <ToolGroup
            key={project}
            title={t.inRepository(projectName(projects, project))}
            note={<code className={s.code}>.mcp.json</code>}
            headingLevel={headingLevel}
          >
            <TileGrid>{sorted(servers.filter((one) => one.repository === project)).map(tile)}</TileGrid>
          </ToolGroup>
        ))}
        <ToolGroup title={t.outside} headingLevel={headingLevel}>
          <SyncTiles sync={sync} agents={agents} onSync={onSync} onChanges={() => setChanges(true)} t={t} />
        </ToolGroup>
      </ListMotion>
    )
  }
  return (
    <div ref={root} className={cx(s.section, className)}>
      {body}
    </div>
  )
}

/** Where a server often added runs, short: its host, or its command without the runner. */
const startsAt = (one: ServerStarter) => {
  if (one.way === 'command') return one.runs.replace(/^npx (-y )?/, '')
  try {
    return new URL(one.runs).host
  } catch {
    return one.runs
  }
}

const nameOf = (agents: readonly ToolAgentView[], id: string) => agents.find((one) => one.id === id)?.name ?? id

/** A change in words: You added notion to Claude Code. Copied to Codex and OpenCode. */
const said = (change: ToolSyncChange, agents: readonly ToolAgentView[], t: ServerTilesText) =>
  change.kind === 'copied'
    ? t.copied(change.name, nameOf(agents, change.from), and(change.to.map((id) => nameOf(agents, id))))
    : t.tookOut(change.name, nameOf(agents, change.from))

/** Same servers everywhere, and What it changed while it changed something; the questions on the way on and off. */
function SyncTiles({
  sync,
  agents,
  onSync,
  onChanges,
  t,
}: {
  sync: ToolSyncModel
  agents: readonly ToolAgentView[]
  onSync: (on: boolean, takeBack: boolean) => void
  onChanges: () => void
  t: ServerTilesText
}) {
  const [asking, setAsking] = useState<'on' | 'off' | null>(null)
  const kept = (sync.changes ?? []).filter((one) => !one.undone)
  const latest = kept[0]
  const added = sync.targets.reduce((sum, target) => sum + target.adds.length, 0)
  const errors = sync.errors ?? []
  return (
    <>
      <TileGrid>
        <div className={s.cell}>
          <ControlToggle
            className={s.tile}
            title={t.same}
            line={sync.on ? and(agents.map((agent) => agent.name)) : t.off}
            on={sync.on}
            onChange={(on) => setAsking(on ? 'on' : 'off')}
            glyph={<Icon name="copy" size={16} />}
          />
        </div>
        {latest !== undefined && (
          <ControlModule className={s.changes} data-tile={CHANGES} title={t.changed} aside={String(kept.length)} onClick={onChanges}>
            <ControlLine>
              {said(latest, agents, t)} · {latest.at}
            </ControlLine>
          </ControlModule>
        )}
      </TileGrid>
      {errors.length > 0 && <Problem>{errors.join(' ')}</Problem>}
      {asking === 'on' && (
        <Dialog
          title={t.keepTitle}
          description={`${t.keepWhat} ${t.keepLater}`}
          width={600}
          onClose={() => setAsking(null)}
          actions={
            <>
              <Button variant="quiet" onClick={() => setAsking(null)}>
                {t.cancel}
              </Button>
              <Button
                variant="signal"
                onClick={() => {
                  setAsking(null)
                  onSync(true, false)
                }}
              >
                {t.turnOn}
              </Button>
            </>
          }
        >
          <div className={s.dialogBody}>
            <ul className={s.targets}>
              {sync.targets.map((target) => {
                const agent = agents.find((one) => one.id === target.agent)
                return (
                  <li key={target.agent} className={s.target}>
                    <span className={s.targetMark} aria-hidden="true">
                      {agent?.brand === undefined ? <Icon name="plug" size={13} /> : <BrandMark brand={agent.brand} size={13} />}
                    </span>
                    <span className={s.targetName}>{agent?.name ?? target.agent}</span>
                    <code className={cx(s.targetWhere, s.truncate)}>{target.where}</code>
                    <span className={s.targetAdds}>{target.adds.length === 0 ? t.nothingToAdd : t.adds(and(target.adds))}</span>
                  </li>
                )
              })}
            </ul>
            <div className={s.leaves}>
              <span className={s.leavesLabel}>{t.leaves}</span>
              <ul className={s.leaveList}>
                {t.leave.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <p className={s.quiet}>{t.copy}</p>
            </div>
          </div>
        </Dialog>
      )}
      {asking === 'off' && (
        <Dialog
          title={t.offTitle}
          description={t.offWhat(added)}
          onClose={() => setAsking(null)}
          actions={
            <>
              <Button variant="quiet" onClick={() => setAsking(null)}>
                {t.cancel}
              </Button>
              <Button
                variant="quiet"
                onClick={() => {
                  setAsking(null)
                  onSync(false, true)
                }}
              >
                {t.takeBack}
              </Button>
              <Button
                onClick={() => {
                  setAsking(null)
                  onSync(false, false)
                }}
              >
                {t.keepThem}
              </Button>
            </>
          }
        />
      )}
    </>
  )
}

/** What it changed, opened in place: each change, newest first, with its Undo or Put it back. */
function Changes({
  changes,
  agents,
  onBack,
  onUndo,
  headingLevel,
  t,
}: {
  changes: readonly ToolSyncChange[]
  agents: readonly ToolAgentView[]
  onBack: () => void
  onUndo: ((id: string) => void) | undefined
  headingLevel: HeadingLevel
  t: ServerTilesText
}) {
  return (
    <div className={s.opened} onKeyDown={escapeBack(onBack)}>
      <ControlDetail title={t.changed} onBack={onBack} headingLevel={headingLevel} text={{ back: t.back }}>
        <ul className={cx(s.sheet, s.changeList)}>
          {changes.map((change) => (
            <li key={change.id} className={s.change}>
              <span className={s.changeAt}>{change.at}</span>
              <span className={cx(s.changeWords, change.undone && s.struck)}>
                {change.undone && <VisuallyHidden>{t.undone}: </VisuallyHidden>}
                {said(change, agents, t)}
              </span>
              {!change.undone && onUndo !== undefined ? (
                <LinkButton onClick={() => onUndo(change.id)}>{change.kind === 'copied' ? t.undo : t.putBack}</LinkButton>
              ) : (
                <span />
              )}
            </li>
          ))}
        </ul>
      </ControlDetail>
    </div>
  )
}
