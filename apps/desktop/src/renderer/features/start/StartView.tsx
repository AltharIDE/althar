import { type ReactNode, useEffect } from 'react'

import type { AgentStatus, ProjectSummary } from '@althar/contracts'
import { Button, PermissionPolicy, type RuntimeEntry, RuntimeState, SourceOrigin } from '@althar/ui'
import { NewProject, Start } from '@althar/ui/screens'

import { brandOf } from '../../shared/agents'
import { shortFolder } from '../../shared/folders'
import { HomePending } from '../../shared/Pending'
import { AgentAccounts } from '../accounts/AgentAccounts'
import type { AccountSignInModel } from '../accounts/useAccountSignIn'
import { text as rulesText } from '../rules/RulesView'
import s from './Start.module.css'
import { useFirstProject } from './useFirstProject'
import type { StartModel } from './useStart'
import { device, platform } from '../../shared/device'
import { BareBar } from '../tabs/TabsFrame'

/*
 * Where the window starts. With no project yet, the kit's Start screen: the
 * agents answering round the mark, and the repositories found where people
 * keep code, ticked into the first project (useFirstProject). Once there are
 * projects, the home, whose Open a folder reads the folder first; one of
 * several repositories asks which to keep.
 */

export const text = {
  removeAnyway: 'Remove anyway',
  /** A folder of several repositories, before it is a project: what was found, and the answers Althar gives. */
  forming: {
    because: (name: string, n: number) => `Althar found ${n} git repositories in ${name}. Leave out any its tasks shouldn’t change.`,
    sources: { label: 'Repositories', note: 'The ones its tasks may change. You can add others from elsewhere.' },
    foot: 'Althar read these folders and changed nothing in them. Tasks work in worktrees of their own.',
  },
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
  const opened = (project: ProjectSummary | null) => {
    if (project !== null) onProject(project.id)
  }
  const modes = { [PermissionPolicy.Rules]: 'rules', [PermissionPolicy.Ask]: 'ask', [PermissionPolicy.AllowAll]: 'allow' } as const
  // With no project, or none read because the runtime didn't answer, the first screen, which says what went wrong.
  const first = (model.projects !== null && model.projects.length === 0) || (model.projects === null && model.error !== null)

  // A folder of several repositories: which to keep, the project's name, and who answers when agents need a yes.
  if (model.forming !== null) {
    const { forming } = model
    return (
      <div className={`${s.window} ${s.bare}`}>
        <BareBar className={s.over} />
        <div className={`${s.scroll} ${s.first}`}>
          <NewProject
            defaultName={forming.name}
            because={text.forming.because(forming.name, forming.repositories.length)}
            sources={forming.repositories.map((kept) => ({
              id: kept.path,
              name: kept.name,
              where: shortFolder(kept.path),
              origin: SourceOrigin.Existing,
              ...(kept.branch === null ? {} : { branch: kept.branch }),
              ...(kept.remote === null ? {} : { remote: kept.remote }),
              role: '',
            }))}
            onRemove={model.leaveOut}
            onChooseFolders={() => void model.addFolders()}
            defaultPermissions={PermissionPolicy.Rules}
            permissionOptions={[PermissionPolicy.Rules, PermissionPolicy.Ask, PermissionPolicy.AllowAll]}
            onCreate={({ name, permissions }) =>
              void model.create({ name, permissions: modes[permissions as keyof typeof modes] ?? 'rules' }).then(opened)
            }
            onCancel={model.cancelForming}
            creating={model.creating}
            {...(model.error === null ? {} : { error: model.error })}
            text={{ sources: text.forming.sources, foot: text.forming.foot, permission: rulesText.screen.permission }}
          />
        </div>
      </div>
    )
  }

  if (first) return <First model={model} accounts={accounts} onProject={onProject} />

  if (model.projects === null) return <HomePending />

  return home()
}

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

  // ⌘N adds a folder, ⌘⏎ makes the project, as the screen says; Ctrl off a Mac.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const command = platform === 'darwin' ? event.metaKey : event.ctrlKey
      if (!command || event.shiftKey || event.altKey) return
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
      />
      {model.unremoved !== null && <StartError model={model} />}
    </div>
  )
}
