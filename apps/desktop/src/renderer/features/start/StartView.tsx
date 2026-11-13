import { type ReactNode, useEffect, useState } from 'react'

import type { AgentStatus, ProjectSummary } from '@althar/contracts'
import { Button, CrashReportsLine, keys, modKey, primaryDown, type RuntimeEntry, RuntimeState } from '@althar/ui'
import { Welcome, type WelcomeStep, welcomeText } from '@althar/ui/screens'

import { brandOf, pinnedOf } from '../../shared/agents'
import { useServices } from '../../data/services'
import { device } from '../../shared/device'
import { HomePending } from '../../shared/Pending'
import { usePreferences } from '../../shared/usePreferences'
import { AgentSignIn } from '../accounts/AgentAccounts'
import type { AccountSignInModel } from '../accounts/useAccountSignIn'
import { ConnectionsView } from '../connections/ConnectionsView'
import { useConnections } from '../connections/useConnections'
import { hostsCode, serviceOf } from '../connections/ways'
import { BareBar } from '../tabs/TabsFrame'
import s from './Start.module.css'
import { useFirstProject } from './useFirstProject'
import type { StartModel } from './useStart'
import { markToured, toured, useWelcoming, welcome } from './welcome'

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
  if (agent.id === 'copilot-direct' && !agent.installed) return { ...base, state: RuntimeState.SignedOut }
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
      <p className={s.error} role="alert">
        {why}
      </p>
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
      <p className={s.error} role="alert">
        {model.error}
      </p>
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
  home,
}: {
  model: StartModel
  /** Signing the agents' accounts in, on the first screen. */
  accounts: AccountSignInModel
  onProject: (projectId: string) => void
  /** The home, once there are projects. */
  home: () => ReactNode
}) {
  const welcoming = useWelcoming()
  // With no project, or none read because the runtime didn't answer, the first screen, which says what went wrong; and the
  // welcome while it is on show, over the project made on its way.
  const first = welcoming || (model.projects !== null && model.projects.length === 0) || (model.projects === null && model.error !== null)

  if (first) return <First model={model} accounts={accounts} onProject={onProject} />

  if (model.projects === null) return <HomePending />

  return home()
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

  const make = () =>
    void project.make().then((one) => {
      if (one !== null) setMade(one)
    })
  const open = () => {
    if (made === null) return
    welcome.end()
    onProject(made.id)
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
  const { host } = useServices()
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
        picked={project.picked}
        onPick={project.toggle}
        onAdd={() => void project.add()}
        onDrop={(files) => void project.addDropped(files)}
        name={project.name}
        onNameChange={project.rename}
        onCreate={make}
        creating={project.making}
        made={made !== null}
        {...(project.error !== null
          ? { error: { step: 'project' as const, said: project.error } }
          : model.error !== null
            ? { error: { step: 'agents' as const, said: model.error } }
            : {})}
        hosts={<ConnectionsView model={connections} only="hosts" />}
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
