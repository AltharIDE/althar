import { type ReactNode, useEffect } from 'react'

import type { AgentStatus } from '@althar/contracts'
import { Button, CrashReportsLine, type RuntimeEntry, RuntimeState } from '@althar/ui'
import { Start } from '@althar/ui/screens'

import { brandOf } from '../../shared/agents'
import { useServices } from '../../data/services'
import { device, platform } from '../../shared/device'
import { HomePending } from '../../shared/Pending'
import { usePreferences } from '../../shared/usePreferences'
import { AgentAccounts } from '../accounts/AgentAccounts'
import type { AccountSignInModel } from '../accounts/useAccountSignIn'
import { BareBar } from '../tabs/TabsFrame'
import s from './Start.module.css'
import { useFirstProject } from './useFirstProject'
import type { StartModel } from './useStart'

/*
 * Where the window starts. With no project yet, the kit's Start screen: the
 * agents answering round the mark, and the repositories found where people
 * keep code, ticked into the first project (useFirstProject), and at the
 * sheet's foot crash reports, asked once as a quiet line with their switch
 * (DEV-66), which Settings keeps too. Once there are projects, the home,
 * where a new project starts in a tab of its own.
 */

export const text = {
  removeAnyway: 'Remove anyway',
  /** Asks every agent again, after one couldn't be checked. */
  checkAgain: 'Check again',
  /** The kit's first screen, in this computer's words, with the keys this system has. */
  first: () => {
    const key = platform === 'darwin' ? '⌘' : 'Ctrl+'
    return {
      looking: `Looking around ${device.this}…`,
      agentsLabel: `Agents on ${device.this}`,
      add: { title: 'Add a folder…', note: `anywhere on ${device.this}`, kbd: `${key}N` },
      createKbd: platform === 'darwin' ? '⌘⏎' : 'Ctrl+Enter',
    }
  },
}

/** An agent's sign-in, as a row of the kit's list of agents, with what goes under it: its accounts. */
export const runtimeEntry = (agent: AgentStatus, detail?: RuntimeEntry['detail'], failed?: string): RuntimeEntry => {
  const brand = brandOf(agent.id)
  const base = { id: agent.id, name: agent.name, ...(brand === undefined ? {} : { brand }), ...(detail === undefined ? {} : { detail }) }
  // Couldn't be checked this time: it says so on its own row, and the others stand as they are.
  if (agent.problem !== null)
    return { id: base.id, name: base.name, ...(brand === undefined ? {} : { brand }), state: RuntimeState.Unchecked, why: agent.problem }
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
      state: RuntimeState.Missing,
      ...(agent.download === null ? {} : { download: agent.download.size }),
      ...(failed === undefined ? {} : { failed }),
    }
  switch (agent.signIn) {
    case 'signed_in':
      return { ...base, state: RuntimeState.Ready }
    case 'signed_out':
      return { ...base, state: RuntimeState.SignedOut }
    case 'unknown':
      return { ...base, state: RuntimeState.Ready, account: 'Signed in, as far as it says' }
  }
}

/** The agents on this computer, each with its accounts to add, sign in, rename, order and remove. */
export const runtimesOf = (model: StartModel, signIn: AccountSignInModel): ReadonlyArray<RuntimeEntry> =>
  model.status?.agents.map((agent) =>
    runtimeEntry(
      agent,
      agent.installed ? <AgentAccounts agent={agent} start={model} signIn={signIn} /> : undefined,
      model.installFailed[agent.id],
    ),
  ) ?? []

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
  // With no project, or none read because the runtime didn't answer, the first screen, which says what went wrong.
  const first = (model.projects !== null && model.projects.length === 0) || (model.projects === null && model.error !== null)

  if (first) return <First model={model} accounts={accounts} onProject={onProject} />

  if (model.projects === null) return <HomePending />

  return home()
}

/** Whether a key was typed into a form of its own, such as an account's key, or into a dialog or menu open over the screen. */
const theirs = (target: EventTarget | null) =>
  target instanceof Element && target.closest('form, [role="dialog"], [data-radix-popper-content-wrapper]') !== null

/** The first screen: the agents answering, the repositories found, and the first project made of those ticked. */
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
  const make = () =>
    void project.make().then((made) => {
      if (made !== null) onProject(made.id)
    })

  // ⌘N adds a folder, ⌘⏎ makes the project, as the screen says; Ctrl off a Mac. Keys typed into an account's form, or into
  // what is open over the screen, are theirs.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const command = platform === 'darwin' ? event.metaKey : event.ctrlKey
      if (!command || event.shiftKey || event.altKey || event.defaultPrevented || theirs(event.target)) return
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

  const error = project.error ?? model.error
  const { preferences, set } = usePreferences()
  const { host } = useServices()
  return (
    <div className={`${s.window} ${s.bare}`}>
      <BareBar className={s.over} />
      <Start
        // Still asking until the runtime answers, or says it can't.
        runtimes={model.status === null && model.error === null ? null : runtimesOf(model, accounts)}
        onInstall={(id) => void model.install(id)}
        repositories={project.candidates}
        {...(project.lookedIn === null || project.lookedIn.length === 0 ? {} : { lookedIn: project.lookedIn.join(', ') })}
        picked={project.picked}
        onPick={project.toggle}
        onAdd={() => void project.add()}
        onDrop={(files) => void project.addDropped(files)}
        name={project.name}
        onNameChange={project.rename}
        onCreate={make}
        creating={project.making}
        {...(error === null ? {} : { error })}
        text={text.first()}
        runtimesText={{ missing: `Not installed on ${device.this}` }}
        foot={
          <CrashReportsLine
            on={preferences.crashReports}
            onChange={(on) => set('crashReports', on)}
            doNotTrack={host.doNotTrack === true}
          />
        }
      />
      {model.unremoved !== null && <StartError model={model} />}
    </div>
  )
}
