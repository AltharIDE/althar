// Scrappy: what every direction shares: the project's settings as one model, read with the app's own hooks, and the rows they are made of.
import { useSyncExternalStore } from 'react'

import {
  BrandChip,
  BrandMark,
  Button,
  ControlLine,
  Icon,
  LinkButton,
  Menu,
  MenuItem,
  MenuSeparator,
  ProjectIdentity,
  ProjectInk,
  ProjectMark,
  ProjectNotes,
  projectIdentityText,
  RemoveProject,
  Runnables,
  SettingList,
  SettingRow,
  SettingSwitch,
} from '../../src/index'
import type { Brand } from '../../src/foundations/brands/brands'
import { type Product, type ProjectRulesView, type Runnable, useNavigate, useQuery, useQueryClient } from './deps'

import { keys, reads } from '../../../../apps/desktop/src/renderer/data/reads'
import { useServices } from '../../../../apps/desktop/src/renderer/data/services'
import { ConnectDialog, type Opening, openingFor } from '../../../../apps/desktop/src/renderer/features/connections/ConnectDialog'
import { useConnections } from '../../../../apps/desktop/src/renderer/features/connections/useConnections'
import { connectedAs, hostNameOf, rulesLineOf, trackersOf } from '../../../../apps/desktop/src/renderer/features/project/front'
import { inkOf } from '../../../../apps/desktop/src/renderer/features/project/ProjectSettings'
import { type ProjectSettingsModel, useProjectSettings } from '../../../../apps/desktop/src/renderer/features/project/useProjectSettings'
import { productBrand, productName } from '../../../../apps/desktop/src/renderer/shared/products'
import { type Chosen, data, GITHUB_ISSUES, JIRA_OPS, LINEAR_DEV, notesOf } from './data'
import css from './parts.module.css'
import { openAppSettings } from './seams/QuickSettings'
import { proto, useProto } from './state'

export const PROJECT = 'p1'

/* ——— What is open over the screen, whichever direction opened it: connecting, the runs, removing. ——— */

interface Over {
  readonly connecting: Opening | null
  readonly runs: boolean
  readonly removing: boolean
}
let over: Over = { connecting: null, runs: false, removing: false }
const overs = new Set<() => void>()
export const overlay = {
  get: () => over,
  set: (next: Partial<Over>) => {
    over = { ...over, ...next }
    for (const listener of overs) listener()
  },
  subscribe: (listener: () => void) => {
    overs.add(listener)
    return () => overs.delete(listener)
  },
}

/* ——— The model. ——— */

/** A connection's trouble: none, never connected, or its sign-in no longer works. */
export type Trouble = null | 'not-connected' | 'signed-out'

/**
 * A code host or tracker the project is on. The connection is Althar's, for
 * every project on that server: the project only names what of it is its own.
 */
export interface Link {
  readonly id: string
  readonly product: Product
  readonly name: string
  readonly brand: Brand
  /** What of it is the project's: AltharIDE/althar, DEV issues. */
  readonly what: string
  readonly login: string | null
  readonly trouble: Trouble
  readonly at: string | null
  /** Where it is on the web. */
  readonly url: string | null
  /** Found in its tasks' issues, where the project names no tracker of its own. */
  readonly found: boolean
  /** The other projects on the same connection. */
  readonly shared: ReadonlyArray<string>
}

/** A tracker it could add: one Althar is connected to, or knows. */
export interface Addable {
  readonly chosen: Chosen
  readonly name: string
  readonly brand: Brand
  readonly what: string
  readonly login: string | null
}

export interface Things {
  readonly name: string
  readonly ink: ProjectInk
  readonly seed: string
  readonly model: ProjectSettingsModel
  readonly host: Link | null
  /** Its trackers: none, one or several, in any product. */
  readonly trackers: ReadonlyArray<Link>
  /** Whether it names its trackers, or they are found in its tasks' issues. */
  readonly chose: boolean
  readonly addable: ReadonlyArray<Addable>
  /** How many connections need the person. */
  readonly troubles: number
  readonly rules: ProjectRulesView | null
  readonly policy: { readonly policy: string; readonly asks: string } | null
  readonly setAllowEverything: (on: boolean) => void
  readonly runnables: ReadonlyArray<Runnable>
  readonly worktrees: string
  readonly branches: string
  readonly finish: string
  readonly connect: (link: Link) => void
  readonly addTracker: (one: Addable) => void
  readonly removeTracker: (link: Link) => void
  /** Connects a tracker Althar has no connection to yet: the app's own walk in. */
  readonly connectAnother: () => void
  /** The app's Settings tab, at its code hosts and trackers. */
  readonly manageConnections: () => void
  readonly openRules: () => void
  readonly openRepositories: () => void
}

const idOf = (one: Pick<Chosen, 'product' | 'at' | 'key'>) => `${one.product}:${one.at ?? ''}:${one.key}`
const trackerName = (product: Product) => (product === 'github' ? 'GitHub Issues' : productName(product))
const trackerWhat = (one: Chosen) => `${one.key} issues`
/** The other projects on a server: charrette-site is on GitHub too. */
const sharedOn = (product: Product): ReadonlyArray<string> => (product === 'github' ? ['charrette-site'] : [])

/** The project's settings, from the app's own reads and hooks, as every direction shows them. */
export function useThings(): Things {
  const { client } = useServices()
  const cache = useQueryClient()
  const read = reads(client)
  const navigate = useNavigate()
  const model = useProjectSettings(PROJECT, () => undefined)
  const list = useConnections().list
  const repositories = useQuery(read.repositories(PROJECT)).data ?? []
  const coordinator = useQuery(read.coordinator(PROJECT)).data ?? null
  const board = useQuery(read.board(PROJECT)).data ?? null
  const runnables = useSyncExternalStore(data.subscribe, () => data.get().runnables)
  const chosen = useSyncExternalStore(data.subscribe, () => data.get().trackers)
  const repository = repositories[0]
  const hostOf = coordinator?.host ?? null
  const host: Link | null =
    hostOf === null
      ? null
      : (() => {
          const login = connectedAs(list, hostOf.product, hostNameOf(hostOf.webUrl))
          const account = repository?.host?.account ?? null
          return {
            id: 'host',
            product: hostOf.product,
            name: hostOf.name,
            brand: productBrand(hostOf.product),
            what: repository?.host?.path ?? repository?.name ?? '',
            login: login ?? account?.login ?? null,
            trouble: account === null ? 'not-connected' : account.state === 'reauth_required' ? 'signed-out' : null,
            at: hostNameOf(hostOf.webUrl),
            url: repository?.host?.url ?? null,
            found: false,
            shared: sharedOn(hostOf.product),
          }
        })()
  // What it names as its own, or else what its tasks' issues name.
  const found: ReadonlyArray<Chosen> =
    board === null
      ? []
      : trackersOf(board.tasks, list).map((one) => ({ product: one.product, at: one.at, key: one.key, url: one.url ?? '' }))
  const named = chosen ?? found
  const standing = (one: Chosen) => {
    const login = connectedAs(list, one.product, one.at)
    const out = list?.connections.find(
      (connection) => connection.product === one.product && (one.at === null || hostNameOf(connection.webUrl) === one.at),
    )
    return {
      login: login ?? out?.account.login ?? null,
      trouble: (login !== null ? null : out?.state === 'reauth_required' ? 'signed-out' : 'not-connected') as Trouble,
    }
  }
  const trackers: Link[] = named.map((one) => ({
    id: idOf(one),
    product: one.product,
    name: trackerName(one.product),
    brand: productBrand(one.product),
    what: trackerWhat(one),
    ...standing(one),
    at: one.at,
    url: one.url === '' ? null : one.url,
    found: chosen === null,
    shared: sharedOn(one.product),
  }))
  const addable: Addable[] = [LINEAR_DEV, JIRA_OPS, GITHUB_ISSUES]
    .filter((one) => !named.some((each) => idOf(each) === idOf(one)))
    .map((one) => ({
      chosen: one,
      name: trackerName(one.product),
      brand: productBrand(one.product),
      what: trackerWhat(one),
      login: connectedAs(list, one.product, one.at),
    }))
  const connect = (link: Pick<Link, 'product' | 'at'>) => overlay.set({ connecting: openingFor(list, link.product, link.at) })
  const rules = model.rules
  return {
    name: model.name ?? '',
    ink: inkOf(model.ink ?? 'clay'),
    seed: PROJECT,
    model,
    host,
    trackers,
    chose: chosen !== null,
    addable,
    troubles: [host, ...trackers].filter((one) => one?.trouble != null).length,
    rules,
    policy: rules === null ? null : rulesLineOf(rules),
    setAllowEverything: (on) => {
      cache.setQueryData<ProjectRulesView>(keys.rules(PROJECT), (now: ProjectRulesView | undefined) =>
        now === undefined ? now : { ...now, allowEverything: on },
      )
      void client.setProjectRules({ projectId: PROJECT, allowEverything: on })
    },
    runnables,
    worktrees: '~/Charrette/althar',
    branches: rules?.branchPattern ?? 'althar/{task}',
    finish:
      rules?.end === 'ready'
        ? 'Opens a pull request for review'
        : rules?.end === 'none'
          ? 'Pushes the branch only'
          : 'Opens a draft pull request',
    connect,
    addTracker: (one) => {
      data.set({ trackers: [...named, one.chosen] })
      if (one.login === null) connect(one.chosen)
    },
    removeTracker: (link) => data.set({ trackers: named.filter((one) => idOf(one) !== link.id) }),
    connectAnother: () => overlay.set({ connecting: 'all' }),
    manageConnections: () => openAppSettings('code-hosts'),
    // In A to D the rules and repositories are sections of the project's Settings, not screens of their own.
    openRules: () =>
      proto.get().direction === 'Today'
        ? void navigate({ to: '/projects/$projectId/rules', params: { projectId: PROJECT } })
        : proto.set({ showing: 'open', section: 'rules' }),
    openRepositories: () =>
      proto.get().direction === 'Today'
        ? void navigate({ to: '/projects/$projectId/repositories', params: { projectId: PROJECT } })
        : proto.set({ showing: 'open', section: 'code' }),
  }
}

/* ——— Words. ——— */

export const words = {
  connectedAs: (login: string) => `Connected as ${login}`,
  found: 'found in its tasks’ issues',
  shared: (others: ReadonlyArray<string>) => `also ${others.join(', ')}’s`,
  notConnected: (what: string) => `Not connected: Althar can’t read or move its ${what}`,
  signedOutHost: (name: string, login: string | null) =>
    `Signed out${login === null ? '' : ` as ${login}`}: no project can push to ${name} or open pull requests`,
  signedOut: (login: string | null) => `Signed out${login === null ? '' : ` as ${login}`}: Althar can’t read or move its issues`,
  connect: 'Connect',
  signIn: 'Sign in again',
  noTracker: 'No tracker',
  noTrackerNote: 'Tasks don’t start from issues, and none move as tasks start',
  addTracker: 'Add a tracker',
  addTrackerNote: 'Another place its issues are, in any product',
  connectAnother: 'Connect another tracker…',
  connectAnotherNote: 'Trello, a Jira or GitLab of your own…',
  appWide: 'Connections are Althar’s, not the project’s: connect GitHub, Linear or Jira once, and every project there uses it.',
  manage: 'Manage connections',
  moveIssues: 'Move issues to In Progress when their task starts',
  moveIssuesOn: 'On: Althar moves the issue as its task starts',
  moveIssuesOff: 'Off: you move issues yourself',
  conflicts: 'Resolve conflicts automatically',
  conflictsOn: 'On: the lead fixes merge conflicts itself',
  conflictsOff: 'Off: you ask the lead to fix them',
  allow: 'Allow everything',
  allowOn: 'On: nothing waits for you; what’s never allowed still is',
  allowOff: 'Off: the rules say what asks you',
  remove: 'Remove from Althar',
  removeNote: 'Its tasks and worktrees go; its repositories and branches stay.',
}

/** A connection's line: who Althar is there, whether it was found or is shared; or its trouble in violet. */
export function LinkLine({ link }: { link: Link }) {
  if (link.trouble === null)
    return (
      <>
        {[
          words.connectedAs(link.login ?? ''),
          ...(link.found ? [words.found] : []),
          ...(link.shared.length > 0 ? [words.shared(link.shared)] : []),
        ].join(' · ')}
      </>
    )
  return (
    <ControlLine tone="yours">
      {link.trouble === 'not-connected'
        ? words.notConnected(link.what)
        : link.id === 'host'
          ? words.signedOutHost(link.name, link.login)
          : words.signedOut(link.login)}
    </ControlLine>
  )
}

/** What putting a connection right says: connect it, or sign in again. */
export const fixOf = (link: Link) => (link.trouble === 'signed-out' ? words.signIn : words.connect)

/* ——— The rows, in the app's Settings rows (SettingList, SettingRow, SettingSwitch). ——— */

/** Its name and ink, with a way to change them. */
export function IdentityRow({ things, onChange }: { things: Things; onChange: () => void }) {
  return (
    <SettingRow
      title={things.name}
      note={`Its mark in ${inkName(things.ink)}`}
      glyph={<ProjectMark seed={things.seed} ink={things.ink} size={26} />}
    >
      {() => <LinkButton onClick={onChange}>Change</LinkButton>}
    </SettingRow>
  )
}

export const inkName = (ink: ProjectInk) => projectIdentityText.inks[ink]

/** Its name and ink, changed in place: the kit's own. */
export function Identity({ things }: { things: Things }) {
  const taken: Partial<Record<ProjectInk, string>> = {}
  for (const one of Object.values(ProjectInk)) {
    const whose = things.model.taken[one as unknown as keyof typeof things.model.taken]
    if (whose !== undefined) taken[one] = whose
  }
  return (
    <ProjectIdentity
      name={things.name}
      seed={things.seed}
      ink={things.ink}
      taken={taken}
      onRename={things.model.rename}
      onInk={(next) => things.model.setInk(next as unknown as Parameters<ProjectSettingsModel['setInk']>[0])}
    />
  )
}

/**
 * A code host or tracker: what of it is the project's, who Althar is there,
 * and a way to put it right. Which account is Althar's, not the project's: a
 * tracker can be taken out of the project, its connection stays.
 */
export function LinkRow({ link, things }: { link: Link; things: Things }) {
  return (
    <SettingRow
      title={`${link.name} · ${link.what}`}
      note={<LinkLine link={link} />}
      glyph={<BrandMark brand={link.brand} size={18} />}
      className={css.plainGlyph}
    >
      {() =>
        link.trouble !== null ? (
          <Button size="small" variant="signal" onClick={() => things.connect(link)}>
            {fixOf(link)}
          </Button>
        ) : link.id === 'host' ? null : (
          <LinkButton onClick={() => things.removeTracker(link)}>Remove</LinkButton>
        )
      }
    </SettingRow>
  )
}

/** The trackers Althar could add, connected or not, and the way to connect another. */
export function AddTrackerMenu({ things, trigger }: { things: Things; trigger?: React.ReactElement }) {
  return (
    <Menu trigger={trigger ?? <LinkButton>Add…</LinkButton>} label={words.addTracker} align="end" width={300}>
      {things.addable.map((one) => (
        <MenuItem
          key={idOf(one.chosen)}
          lead={<BrandChip brand={one.brand} size={16} />}
          description={one.login === null ? 'Not connected yet: you connect it first' : words.connectedAs(one.login)}
          onSelect={() => things.addTracker(one)}
        >
          {`${one.name} · ${one.what}`}
        </MenuItem>
      ))}
      <MenuSeparator />
      <MenuItem icon="plug" description={words.connectAnotherNote} onSelect={things.connectAnother}>
        {words.connectAnother}
      </MenuItem>
    </Menu>
  )
}

/** Its trackers, one row each, then the way to add one; with none, that row says so. */
export function TrackerRows({ things, children, quietAdd = false }: { things: Things; children?: React.ReactNode; quietAdd?: boolean }) {
  const none = things.trackers.length === 0
  return (
    <>
      {things.trackers.map((link) => (
        <LinkRow key={link.id} link={link} things={things} />
      ))}
      {/* What depends on its trackers, under them: Move issues. */}
      {children}
      {(none || !quietAdd) && (
        <SettingRow title={none ? words.noTracker : words.addTracker} note={none ? words.noTrackerNote : words.addTrackerNote}>
          {() => <AddTrackerMenu things={things} />}
        </SettingRow>
      )}
    </>
  )
}

/** That connections are the app's, and the way to them. */
export function AppWide({ things }: { things: Things }) {
  return (
    <p className={css.quiet}>
      {words.appWide} <LinkButton onClick={things.manageConnections}>{words.manage}</LinkButton>
    </p>
  )
}

export function MoveIssues({ things, indent }: { things: Things; indent?: boolean }) {
  if (things.rules === null || things.trackers.length === 0) return null
  const on = things.rules.moveIssues
  return (
    <SettingSwitch
      title={words.moveIssues}
      note={on ? words.moveIssuesOn : words.moveIssuesOff}
      {...(indent === true ? {} : { glyph: <Icon name="play" size={15} /> })}
      checked={on}
      onChange={things.model.setMoveIssues}
      indent={indent}
    />
  )
}

export function Conflicts({ things }: { things: Things }) {
  if (things.rules === null) return null
  const on = things.rules.resolveConflicts
  return (
    <SettingSwitch
      title={words.conflicts}
      note={on ? words.conflictsOn : words.conflictsOff}
      glyph={<Icon name="branch" size={15} />}
      checked={on}
      onChange={things.model.setResolveConflicts}
    />
  )
}

export function AllowEverything({ things }: { things: Things }) {
  if (things.rules === null) return null
  const on = things.rules.allowEverything
  return (
    <SettingSwitch
      title={words.allow}
      note={on ? words.allowOn : words.allowOff}
      glyph={<Icon name="lock" size={15} />}
      checked={on}
      onChange={things.setAllowEverything}
    />
  )
}

/** The rules in a line, and the way to all of them. */
export function RulesRow({ things, onOpen }: { things: Things; onOpen?: () => void }) {
  if (things.policy === null) return null
  return (
    <SettingRow title={`Rules: ${things.policy.policy}`} note={things.policy.asks} glyph={<Icon name="list" size={15} />}>
      {() => <LinkButton onClick={onOpen ?? things.openRules}>Open rules</LinkButton>}
    </SettingRow>
  )
}

/** What it runs, the default first, and the way to the list. */
export function RunsRow({ things }: { things: Things }) {
  const [first, ...rest] = things.runnables
  return (
    <SettingRow
      title={first === undefined ? 'Nothing to run yet' : `Runs ${first.name ?? first.command}`}
      note={first === undefined ? 'Run lists what to run' : `${first.command}${rest.length === 0 ? '' : ` · ${rest.length} more kept`}`}
      glyph={<Icon name="play" size={15} />}
    >
      {() => <LinkButton onClick={() => overlay.set({ runs: true })}>Edit list</LinkButton>}
    </SettingRow>
  )
}

/** Every runnable, one row each. */
export function RunRows({ things }: { things: Things }) {
  return (
    <>
      {things.runnables.map((one, i) => (
        <SettingRow
          key={one.id}
          title={one.name ?? one.command}
          note={`${one.command}${i === 0 ? ' · the default, what Run starts' : ''}`}
          glyph={<Icon name={i === 0 ? 'play' : 'terminal'} size={15} />}
        >
          {() => (i === 0 ? <span className={css.quiet}>Default</span> : null)}
        </SettingRow>
      ))}
    </>
  )
}

/** Where its work goes on this Mac and on the host. */
export function WhereRows({ things }: { things: Things }) {
  return (
    <>
      <SettingRow title="Worktrees" note={things.worktrees} glyph={<Icon name="folder" size={15} />}>
        {() => <LinkButton>Move</LinkButton>}
      </SettingRow>
      <SettingRow title="Branches" note={things.branches} glyph={<Icon name="branch" size={15} />}>
        {() => <LinkButton onClick={things.openRules}>Change</LinkButton>}
      </SettingRow>
      <SettingRow title="When a task finishes" note={things.finish} glyph={<Icon name="pr" size={15} />}>
        {() => <LinkButton onClick={things.openRules}>Change</LinkButton>}
      </SettingRow>
    </>
  )
}

/** The notes in a row: how many, and the latest. */
export function NotesRow({ things, onOpen }: { things: Things; onOpen: () => void }) {
  const notes = things.model.notes ?? []
  return (
    <SettingRow
      title={notes.length === 0 ? 'No notes yet' : `${notes.length} notes the coordinator keeps`}
      note={notes.at(-1)?.body ?? 'What you decide in conversation, that the code doesn’t show'}
      glyph={<Icon name="quote" size={15} />}
    >
      {() => <LinkButton onClick={onOpen}>Read</LinkButton>}
    </SettingRow>
  )
}

export function Notes({ things }: { things: Things }) {
  return <ProjectNotes notes={things.model.notes ?? []} onRemove={(id) => void things.model.dropNote(id)} />
}

export function RemoveRow({ things }: { things: Things }) {
  return (
    <SettingRow title={`Remove ${things.name} from Althar`} note={words.removeNote} glyph={<Icon name="close" size={15} />}>
      {() => (
        <Button size="small" variant="danger" onClick={() => overlay.set({ removing: true })}>
          Remove…
        </Button>
      )}
    </SettingRow>
  )
}

export { SettingList }

/* ——— What opens over the screen: the app's own connecting, the kit's runs and removal. ——— */

export function Overlays() {
  const shown = useSyncExternalStore(overlay.subscribe, overlay.get)
  const connections = useConnections()
  const runnables = useSyncExternalStore(data.subscribe, () => data.get().runnables)
  const { cache } = useServices()
  const changed = (next: ReadonlyArray<Runnable>) => {
    data.set({ runnables: next })
    void cache.invalidateQueries({ queryKey: ['coordinator'] })
  }
  useProto()
  return (
    <>
      {shown.connecting !== null && (
        <ConnectDialog model={connections} opening={shown.connecting} onClose={() => overlay.set({ connecting: null })} />
      )}
      {shown.runs && (
        <Runnables
          project="althar"
          runnables={runnables.map((one) => ({
            id: one.id,
            ...(one.name === null ? {} : { name: one.name }),
            command: one.command,
            about: `althar · ${one.from === 'repository' ? 'From the repository' : one.from === 'person' ? 'Added by you' : 'Added by the coordinator'}`,
          }))}
          onOrder={(ids) => changed(ids.flatMap((id) => runnables.filter((one) => one.id === id)))}
          onDefault={(id) => changed([...runnables.filter((one) => one.id === id), ...runnables.filter((one) => one.id !== id)])}
          onEdit={() => undefined}
          onRemove={(id) => changed(runnables.filter((one) => one.id !== id))}
          onAdd={() => undefined}
          onClose={() => overlay.set({ runs: false })}
        />
      )}
      {shown.removing && (
        <RemoveProject
          project="althar"
          working={2}
          worktrees="~/Charrette/althar"
          onRemove={() => overlay.set({ removing: false })}
          onClose={() => overlay.set({ removing: false })}
        />
      )}
    </>
  )
}

/** The notes, as many as the picker says, read again when it changes. */
export const notesNow = () => notesOf(proto.get().notes)
