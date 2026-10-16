// Scrappy: what every direction shares: the project's settings as one model, read with the app's own hooks, and the rows they are made of.
import { useSyncExternalStore } from 'react'

import {
  BrandChip,
  Button,
  ControlLine,
  Icon,
  LinkButton,
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
import { data, notesOf } from './data'
import css from './parts.module.css'
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

export interface Link {
  readonly product: Product
  readonly name: string
  readonly brand: Brand
  /** What of it is the project's: AltharIDE/althar, DEV issues. */
  readonly what: string
  readonly login: string | null
  readonly trouble: Trouble
  readonly at: string | null
}

export interface Things {
  readonly name: string
  readonly ink: ProjectInk
  readonly seed: string
  readonly model: ProjectSettingsModel
  readonly host: Link | null
  readonly tracker: Link | null
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
  readonly openRules: () => void
  readonly openRepositories: () => void
}

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
  const repository = repositories[0]
  const hostOf = coordinator?.host ?? null
  const host: Link | null =
    hostOf === null
      ? null
      : (() => {
          const login = connectedAs(list, hostOf.product, hostNameOf(hostOf.webUrl))
          const account = repository?.host?.account ?? null
          return {
            product: hostOf.product,
            name: hostOf.name,
            brand: productBrand(hostOf.product),
            what: repository?.host?.path ?? repository?.name ?? '',
            login: login ?? account?.login ?? null,
            trouble: account === null ? 'not-connected' : account.state === 'reauth_required' ? 'signed-out' : null,
            at: hostNameOf(hostOf.webUrl),
          }
        })()
  const first = board === null ? undefined : trackersOf(board.tasks, list)[0]
  const tracker: Link | null =
    first === undefined
      ? null
      : (() => {
          const login = connectedAs(list, first.product, first.at)
          return {
            product: first.product,
            name: productName(first.product),
            brand: productBrand(first.product),
            what: `${first.key} issues`,
            login,
            trouble: login === null ? 'not-connected' : null,
            at: first.at,
          }
        })()
  const rules = model.rules
  return {
    name: model.name ?? '',
    ink: inkOf(model.ink ?? 'clay'),
    seed: PROJECT,
    model,
    host,
    tracker,
    troubles: [host, tracker].filter((one) => one?.trouble != null).length,
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
    connect: (link) => overlay.set({ connecting: openingFor(list, link.product, link.at) }),
    openRules: () => void navigate({ to: '/projects/$projectId/rules', params: { projectId: PROJECT } }),
    openRepositories: () => void navigate({ to: '/projects/$projectId/repositories', params: { projectId: PROJECT } }),
  }
}

/* ——— Words. ——— */

export const words = {
  connectedAs: (login: string) => `Connected as ${login}`,
  notConnected: 'Not connected: Althar can’t read or move its issues',
  signedOut: (login: string | null) => `Signed out${login === null ? '' : ` as ${login}`}: Althar can’t push or open pull requests`,
  connect: 'Connect',
  signIn: 'Sign in again',
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

/** A connection's line: who it is connected as, or its trouble in violet. */
export function LinkLine({ link }: { link: Link }) {
  if (link.trouble === null) return <>{words.connectedAs(link.login ?? '')}</>
  return <ControlLine tone="yours">{link.trouble === 'signed-out' ? words.signedOut(link.login) : words.notConnected}</ControlLine>
}

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

/** A code host or tracker: what of it is the project's, who Althar is there, and a way to put it right. */
export function LinkRow({ link, things }: { link: Link; things: Things }) {
  return (
    <SettingRow title={`${link.name} · ${link.what}`} note={<LinkLine link={link} />} glyph={<BrandChip brand={link.brand} size={26} />}>
      {() =>
        link.trouble === null ? (
          <LinkButton onClick={() => things.connect(link)}>Change account</LinkButton>
        ) : (
          <Button size="small" variant="signal" onClick={() => things.connect(link)}>
            {link.trouble === 'signed-out' ? words.signIn : words.connect}
          </Button>
        )
      }
    </SettingRow>
  )
}

export function MoveIssues({ things, indent }: { things: Things; indent?: boolean }) {
  if (things.rules === null || things.tracker === null) return null
  const on = things.rules.moveIssues
  return (
    <SettingSwitch
      title={words.moveIssues}
      note={on ? words.moveIssuesOn : words.moveIssuesOff}
      glyph={<Icon name="play" size={15} />}
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
