import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useEffect, useState, useSyncExternalStore } from 'react'

import type { AgentStatus, ProjectSummary } from '@althar/contracts'
import {
  BrandMark,
  Button,
  CrashReportsLine,
  Icon,
  keys,
  Menu,
  MenuItem,
  modKey,
  OtherTools,
  primaryDown,
  RepositoryPick,
  type RuntimeEntry,
  RuntimeState,
  Problem,
} from '@althar/ui'
import { HomeWelcome, Welcome, type WelcomeStep, welcomeText } from '@althar/ui/screens'

import { brandOf, pinnedOf } from '../../shared/agents'
import { reads } from '../../data/reads'
import { hostChoices, PutOnHost, thingOn } from '../../shared/PutOnHost'
import { type Draft, draftActions, draftsOf, freshDraft, inkOf } from '../newProject/draft'
import { SetupSide } from '../newProject/SetupSide'
import { useSetup } from '../newProject/useSetup'
import { useServices } from '../../data/services'
import { device } from '../../shared/device'
import { HomePending } from '../../shared/Pending'
import { usePreferences } from '../../shared/usePreferences'
import { AgentSignIn } from '../accounts/AgentAccounts'
import type { AccountSignInModel } from '../accounts/useAccountSignIn'
import { ConnectionsView } from '../connections/ConnectionsView'
import { useConnections } from '../connections/useConnections'
import { hostsCode, serviceOf, serviceOfProduct } from '../connections/ways'
import { BareBar } from '../tabs/TabsFrame'
import s from './Start.module.css'
import { useElsewhere } from '../elsewhere/useElsewhere'
import { useFirstProject } from './useFirstProject'
import { useHomeWelcome } from './useHomeWelcome'
import type { StartModel } from './useStart'
import { markToured, toured, useWelcoming, welcome } from './welcome'

/** The longest the welcome waits, as its project is made, to know whether other tools left anything to bring in. */
const LOOK_MOST = 4_000

/*
 * Where the window starts. On a first run, the kit's Welcome: a short tour
 * of what Althar does, then the agents on this computer, each with the one
 * thing it needs; the first project, of the repositories found where people
 * keep code (useFirstProject); where its code is, for pull requests, and a
 * tracker, for issues (ConnectionsView, one kind a step); and on the agents'
 * step, agent skills and crash reports, each asked once as a quiet line with
 * its switch, which Settings keeps too. The project is made on its step, and
 * the welcome stays on show (welcome.ts) until its last step opens it. Once
 * there are projects, the home, where a new project starts in a tab of its own.
 */

export const text = {
  removeAnyway: 'Remove anyway',
  staysHere: (name: string) => `${name} is only on ${device.this}.`,
  putOn: 'Put it on a host',
  pushTo: 'Push to…',
  newOn: (thing: string, host: string) => `A new ${thing} on ${host}`,
  /** Asks every agent again, after one couldn't be checked. */
  checkAgain: 'Check again',
  /** An agent signed in, on its row in the welcome. */
  signedIn: 'Signed in',
  /** The welcome, in this computer's words, with the keys this system has. */
  first: () => ({
    welcome: {
      agents: { ...welcomeText.agents, here: `On ${device.this}`, list: `Agents on ${device.this}` },
      project: { ...welcomeText.project, makeKbd: modKey(keys.return) },
    },
    away: { title: `Not on ${device.this}`, label: `Agents not on ${device.this}` },
    repositories: {
      find: `Find a repository on ${device.this}`,
      add: { title: 'Choose a folder…', note: 'or drop one here', kbd: modKey('N') },
    },
    runtimes: { missing: `Not installed on ${device.this}` },
  }),
}

/** An agent's sign-in, as a row of the kit's list of agents, with what goes under it: its accounts. */
export const runtimeEntry = (agent: AgentStatus, detail?: RuntimeEntry['detail'], failed?: string): RuntimeEntry => {
  const brand = brandOf(agent.id)
  const base = {
    id: agent.id,
    name: agent.name,
    ...(brand === undefined ? {} : { brand }),
    ...(detail === undefined ? {} : { detail }),
    ...(agent.guide === null ? { guide: false } : {}),
  }
  // Couldn't be checked this time: it says so on its own row, and the others stand as they are.
  if (agent.problem !== null)
    return { id: base.id, name: base.name, ...(brand === undefined ? {} : { brand }), state: RuntimeState.Unchecked, why: agent.problem }
  if (agent.id === 'copilot-direct' && (!agent.installed || agent.signIn === 'unknown')) return { ...base, state: RuntimeState.SignedOut }
  // Not on this Mac: downloading, or the way to have it, where Althar can fetch it.
  if (agent.download?.installing === true)
    return {
      id: base.id,
      name: base.name,
      ...(brand === undefined ? {} : { brand }),
      state: RuntimeState.Installing,
      download: agent.download.size,
    }
  if (!agent.installed)
    return {
      id: base.id,
      name: base.name,
      ...(brand === undefined ? {} : { brand }),
      ...(agent.guide === null ? { guide: false } : {}),
      state: RuntimeState.Missing,
      ...(agent.download === null ? {} : { download: agent.download.size }),
      ...(pinnedOf(agent) === undefined ? {} : { pinned: pinnedOf(agent) }),
      ...(failed === undefined ? {} : { failed }),
    }
  switch (agent.signIn) {
    case 'signed_in':
      return { ...base, state: RuntimeState.Ready }
    case 'signed_out':
      return { ...base, state: RuntimeState.SignedOut }
    case 'unknown':
      return { ...base, state: RuntimeState.Ready, account: 'Signed in' }
  }
}

/** Opens an agent's own page on installing it, in the browser. */
export const openGuide = (model: StartModel, agentId: string) => {
  const guide = model.status?.agents.find((agent) => agent.id === agentId)?.guide
  if (guide != null) window.open(guide, '_blank')
}

/**
 * The agents, each as a row of the kit's list, with its own sign-in under it while one is under way. A row signed in says
 * so, before its version: someone new needn't know what a version number means to see it is ready.
 */
export const runtimesOf = (model: StartModel, signIn: AccountSignInModel): ReadonlyArray<RuntimeEntry> =>
  model.status?.agents.map((agent) => {
    const entry = runtimeEntry(
      agent,
      agent.installed || agent.id === 'copilot-direct' ? signingInOf(agent, signIn) : undefined,
      model.installFailed[agent.id],
    )
    return entry.state === RuntimeState.Ready && entry.account === undefined ? { ...entry, account: text.signedIn } : entry
  }) ?? []

/** An agent's sign-in under way, in its row: one of its accounts signing in again is named, as in Settings. */
const signingInOf = (agent: AgentStatus, signIn: AccountSignInModel) => {
  const flow = signIn.signingIn
  if (flow?.agentId !== agent.id) return undefined
  const again = flow.again == null ? undefined : agent.accounts.find((account) => account.id === flow.again)
  return <AgentSignIn agent={agent} signIn={signIn} position={1} {...(again === undefined ? {} : { account: { name: again.name } })} />
}

/** Signs an agent in by its first account, or a new one where it has none. */
const signInTo = (model: StartModel, signIn: AccountSignInModel, agentId: string) => {
  const account = model.status?.agents.find((agent) => agent.id === agentId)?.accounts[0]
  if (account === undefined) signIn.add(agentId)
  else signIn.again(agentId, account.id)
}

/** Why one agent couldn't be checked, with a way to check every agent again. */
export function AgentProblem({ why, model }: { why: string; model: StartModel }) {
  return (
    <div className={s.failure}>
      <Problem className={s.error}>{why}</Problem>
      <Button size="small" onClick={() => void model.recheck()}>
        {text.checkAgain}
      </Button>
    </div>
  )
}

/** What went wrong, with a way past an account whose sign-out didn't work. */
export function StartError({ model }: { model: StartModel }) {
  if (model.error === null) return null
  return (
    <div className={s.failure}>
      <Problem className={s.error}>{model.error}</Problem>
      {model.unremoved !== null && (
        <Button size="small" onClick={() => void model.removeAnyway()}>
          {text.removeAnyway}
        </Button>
      )}
    </div>
  )
}

export function StartView({
  model,
  accounts,
  onProject,
  onNew,
  home,
}: {
  model: StartModel
  /** Signing the agents' accounts in, on the first screen. */
  accounts: AccountSignInModel
  onProject: (projectId: string) => void
  /** The New project tab, its draft started: where an empty home's welcome goes in. */
  onNew: () => void
  /** The home, once there are projects. */
  home: () => ReactNode
}) {
  const { client } = useServices()
  const welcoming = useWelcoming()
  // With no project, or none read because the runtime didn't answer, the first screen, which says what went wrong; and the
  // welcome while it is on show, over the project made on its way.
  const first = welcoming || (model.projects !== null && model.projects.length === 0) || (model.projects === null && model.error !== null)

  if (client.connection !== undefined) {
    if (model.projects === null) return <HomePending />
    if (model.projects.length === 0) return <EmptyHome onNew={onNew} />
    return home()
  }

  if (first) return <First model={model} accounts={accounts} onProject={onProject} />

  if (model.projects === null) return <HomePending />

  return home()
}

/** A home on another computer with no projects yet: its welcome, under the window's bar, its ways in opening New project. */
function EmptyHome({ onNew }: { onNew: () => void }) {
  const model = useHomeWelcome(onNew)
  if (model === null) return <HomePending />
  return (
    <div className={s.window}>
      <BareBar />
      <HomeWelcome {...model} />
    </div>
  )
}

/** What the setup reads while the draft is being started: nothing chosen. */
const HOLDING: Draft = { ...freshDraft(), id: '' }

/**
 * The first project's one repository, only on this computer: said so, with
 * the way to put it on a code host from here, as its settings have it.
 */
function StaysHere({ projectId }: { projectId: string }) {
  const { client } = useServices()
  const connections = useConnections()
  const repositories = useQuery(reads(client).repositories(projectId)).data ?? null
  const [putting, setPutting] = useState<string | null>(null)
  const [only] = repositories ?? []
  if (repositories === null || repositories.length !== 1 || only === undefined || only.host !== null) return null
  const { ready, hosts } = hostChoices(connections.list)
  const chosen = ready.find((connection) => connection.id === putting)
  if (chosen !== undefined)
    return (
      <PutOnHost
        projectId={projectId}
        repository={only.id}
        name={only.name}
        branch={only.branch ?? 'main'}
        connection={{ id: chosen.id, name: chosen.name, product: chosen.product, thing: thingOn(serviceOfProduct(chosen.product)) }}
        onDone={() => setPutting(null)}
        onBack={() => setPutting(null)}
      />
    )
  if (ready.length === 0) return null
  return (
    <p className={s.staysHere}>
      <Icon name="folder" size={14} />
      <span>{text.staysHere(only.name)}</span>
      <Menu
        label={text.putOn}
        trigger={
          <Button size="small" trailingIcon="chevronD">
            {text.pushTo}
          </Button>
        }
      >
        {hosts
          .filter((host) => host.connected)
          .map((host) => (
            <MenuItem key={host.id} lead={<BrandMark brand={host.brand} size={14} />} onSelect={() => setPutting(host.id)}>
              {text.newOn(host.thing, host.name)}
            </MenuItem>
          ))}
      </Menu>
    </p>
  )
}

/** Whether a key was typed into a form of its own, such as an account's key, or into a dialog or menu open over the screen. */
const theirs = (target: EventTarget | null) =>
  target instanceof Element && target.closest('form, [role="dialog"], [data-radix-popper-content-wrapper]') !== null

/** The first screen: the welcome, its tour, then the agents, the first project of the repositories ticked, its code host and a tracker. */
function First({
  model,
  accounts,
  onProject,
}: {
  model: StartModel
  accounts: AccountSignInModel
  onProject: (projectId: string) => void
}) {
  const project = useFirstProject()
  const connections = useConnections()
  // Whether the tour was seen is read as the welcome opens: once over, it stays on the track, and Back goes to it. Opened
  // with no projects read, because the runtime didn't answer, it isn't a first run: it starts on the agents, where that
  // is said, with no tour.
  const [seen] = useState(() => toured() || model.projects === null)
  const [step, setStep] = useState<WelcomeStep>(seen ? 'agents' : 'projects')
  const [made, setMade] = useState<ProjectSummary | null>(null)
  const firstRun = model.projects !== null && model.projects.length === 0
  // A first run's welcome stays on show until its last step opens the project made on its way.
  useEffect(() => {
    if (firstRun) welcome.begin()
  }, [firstRun])
  // Left with its project made, by Open or by going elsewhere, it is over.
  useEffect(() => {
    if (made === null) return
    return () => welcome.end()
  }, [made])

  // Where its code comes from: a folder, as this computer has them, or a clone, or a new repository, as a new project's page has them.
  const services = useServices()
  const { host } = services
  useEffect(() => {
    if (firstRun || made !== null) host.welcomeUsage?.('step', step)
  }, [firstRun, host, made, step])
  const store = draftsOf(services.client)
  const draft = useSyncExternalStore(store.subscribe, store.get)
  // The welcome's own draft, for a clone or a new repository: it goes with the welcome, so no New project tab is left behind.
  useEffect(() => {
    if (store.get() === null) store.start()
    return () => store.end()
  }, [store])
  const setup = useSetup(draft ?? HOLDING, store, connections.list)
  const codeHosts = (connections.list?.connections ?? []).filter((connection) => {
    const service = serviceOf(connections.list?.products ?? [], connection.product)
    return connection.state === 'ready' && service !== undefined && hostsCode(service)
  })
  // A first run starts on a folder of this computer's, unless a code host is connected and there's nothing here to offer.
  // Made, its draft is gone: the way it was made from stays, and with it the steps after.
  const [madeWay, setMadeWay] = useState<Draft['way']>(null)
  const way =
    madeWay ?? draft?.way ?? (codeHosts.length > 0 && project.candidates !== null && project.candidates.length === 0 ? 'clone' : 'folder')
  const folderWay = way === 'folder'
  // What other tools left in its folders: read as it is made, so its step is there, or isn't, as the welcome moves on.
  const elsewhere = useElsewhere(services.client, null)
  const make = () =>
    void (
      folderWay || draft === null ? project.make() : draftActions(services).create(inkOf(draft, []), { publish: null, tracker: null })
    ).then(async (one) => {
      if (firstRun) host.welcomeUsage?.('project', way, one === null ? 'not_created' : 'created')
      if (one === null) return
      // Never long: a look that takes more than a moment leaves the step out rather than hold the welcome up.
      await Promise.race([elsewhere.load(one.id), new Promise((done) => setTimeout(done, LOOK_MOST))])
      setMadeWay(way)
      // Made, its draft stays on show, as what it was made from, until the welcome goes; it has no tab of its own.
      if (draft !== null) store.change(draft.id, (now) => ({ ...now, made: true }))
      setMade(one)
    })
  const open = () => {
    if (made === null) return
    welcome.end()
    onProject(made.id)
    host.welcomeUsage?.('completed')
  }

  // ⌘N chooses a folder, ⌘↵ makes the project, on its step, as the screen says; Ctrl off a Mac. Keys typed into an account's
  // form, or into what is open over the screen, are theirs.
  useEffect(() => {
    if (step !== 'project' || made !== null) return
    const onKey = (event: KeyboardEvent) => {
      if (!primaryDown(event) || event.shiftKey || event.altKey || event.defaultPrevented || theirs(event.target)) return
      if (event.key.toLowerCase() === 'n') {
        event.preventDefault()
        void project.add()
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        make()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const { preferences, set } = usePreferences()
  const list = connections.list
  const hostConnected =
    list?.connections.some((connection) => {
      const service = serviceOf(list.products, connection.product)
      return service !== undefined && hostsCode(service)
    }) ?? false
  const trackersOffered = list === null || list.products.some((product) => !hostsCode(product.service))
  const words = text.first()
  return (
    <div className={`${s.window} ${s.bare}`}>
      <BareBar className={s.over} />
      <Welcome
        step={step}
        onStepChange={setStep}
        toured={seen}
        onToured={markToured}
        // Still asking until the runtime answers, or says it can't.
        runtimes={model.status === null && model.error === null ? null : runtimesOf(model, accounts)}
        runtimesText={words.runtimes}
        awayText={words.away}
        onSignIn={(id) => signInTo(model, accounts, id)}
        onCheck={() => void model.recheck()}
        onInstall={(id) => void model.install(id)}
        onHelp={(id) => openGuide(model, id)}
        repositories={project.candidates}
        repositoryText={words.repositories}
        picked={
          folderWay
            ? project.picked
            : way === 'clone'
              ? setup.chosen === null
                ? []
                : [setup.chosen]
              : draft?.fresh != null || draft?.folders.some((folder) => folder.came === 'new') === true
                ? ['fresh']
                : []
        }
        onPick={project.toggle}
        onAdd={() => void project.add()}
        onDrop={(files) => {
          if (draft !== null) store.change(draft.id, (now) => ({ ...now, way: 'folder' }))
          void project.addDropped(files)
        }}
        project={
          draft === null ? undefined : (
            <SetupSide
              setup={{ ...setup, way }}
              draft={draft}
              creating={project.making || draft.creating}
              onChoose={() => void project.add()}
              onLeaveOut={() => undefined}
              onReplace={() => undefined}
              onStartFresh={() => void draftActions(services).startFresh()}
              onChooseCloneInto={() => void draftActions(services).chooseCloneInto()}
              onOpenProject={() => undefined}
              dropping={false}
              only="source"
              minHeight={232}
              folderWay={
                <RepositoryPick
                  repositories={project.candidates}
                  picked={project.picked}
                  onPick={project.toggle}
                  onAdd={() => void project.add()}
                  text={words.repositories}
                />
              }
            />
          )
        }
        // A new repository is named after the project, so the name comes first.
        naming={way === 'new'}
        name={folderWay || draft === null ? project.name : draft.name}
        onNameChange={(next) => {
          if (folderWay || draft === null) project.rename(next)
          else store.change(draft.id, (now) => ({ ...now, name: next }))
        }}
        // oxlint-disable-next-line althar/press-at-once -- A form the runtime and a code host check (a clone, a repository made there): it stays, making, until made, so a refusal lands in it.
        onCreate={make}
        creating={project.making || draft?.creating === true}
        made={made !== null}
        // Where the runtime didn't answer, asking again is the way on.
        onRecheck={() => void model.recheck()}
        {...(folderWay && project.error !== null
          ? { error: { step: 'project' as const, said: project.error } }
          : !folderWay && draft?.error != null
            ? { error: { step: 'project' as const, said: draft.error.said } }
            : model.error !== null
              ? { error: { step: 'agents' as const, said: model.error } }
              : {})}
        // A clone's code lives where it came from: no step for it. Otherwise, a host to connect, and the project put on it.
        {...(way === 'clone'
          ? {}
          : {
              hosts: (
                <>
                  <ConnectionsView model={connections} only="hosts" />
                  {made !== null && <StaysHere projectId={made.id} />}
                </>
              ),
            })}
        {...(made !== null && elsewhere.tiles.length > 0
          ? {
              bring: {
                content: <OtherTools tiles={elsewhere.tiles} picked={elsewhere.picked} onPick={elsewhere.onPick} />,
                go: elsewhere.go,
                // Brought in behind the welcome: it moves on at once, and the board shows each task as it comes.
                onGo: () => void elsewhere.bring(made.id),
              },
            }
          : {})}
        hostConnected={hostConnected}
        // Issues are a step only where a tracker can be connected; until the list is read, as though one can.
        {...(trackersOffered ? { trackers: <ConnectionsView model={connections} only="trackers" /> } : {})}
        onOpen={open}
        foot={
          <>
            <CrashReportsLine
              on={preferences.crashReports}
              onChange={(on) => set('crashReports', on)}
              doNotTrack={host.doNotTrack === true}
            />
          </>
        }
        text={words.welcome}
      />
      {model.unremoved !== null && <StartError model={model} />}
    </div>
  )
}
