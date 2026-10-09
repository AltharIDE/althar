import { type DragEvent, type ReactNode, useEffect } from 'react'

import type { AgentStatus, ProjectSummary } from '@althar/contracts'
import { Button, PermissionPolicy, type RuntimeEntry, RuntimeState, SourceOrigin, TitleBar } from '@althar/ui'
import { NewProject, Start } from '@althar/ui/screens'

import { brandOf } from '../../shared/agents'
import { shortFolder } from '../../shared/folders'
import { HomePending } from '../../shared/Pending'
import { AgentAccounts } from '../accounts/AgentAccounts'
import type { AccountSignInModel } from '../accounts/useAccountSignIn'
import { text as rulesText } from '../rules/RulesView'
import s from './Start.module.css'
import type { StartModel } from './useStart'

/*
 * Where the window starts. With no project yet, the kit's Start screen, whose
 * one way in is opening a folder; a folder of several repositories first
 * asks which to keep. Once there are projects, the home.
 */

export const text = {
  removeAnyway: 'Remove anyway',
  /** A folder of several repositories, before it is a project: what was found, and the answers Althar gives. */
  forming: {
    because: (name: string, n: number) => `Althar found ${n} git repositories in ${name}. Leave out any its tasks shouldn’t change.`,
    sources: { label: 'Repositories', note: 'The ones its tasks may change. You can add others from elsewhere.' },
    foot: 'Althar read these folders and changed nothing in them. Tasks work in worktrees of their own.',
  },
  /** The kit's start screen, saying only what this app does: one folder, by the button or ⌘N. */
  first: {
    create: { title: 'Open a folder', note: 'A repository, a folder in one, or a folder of them becomes a project', kbd: '⌘N' },
    drop: 'Or drop the folder anywhere on this window.',
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

/** The agents on this Mac, each with its accounts to add, sign in, rename, order and remove. */
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
  const open = () => void model.openFolder().then(opened)
  const modes = { [PermissionPolicy.Rules]: 'rules', [PermissionPolicy.Ask]: 'ask', [PermissionPolicy.AllowAll]: 'allow' } as const
  // With no project, or none read because the runtime didn't answer, the first screen, which says what went wrong.
  const first = (model.projects !== null && model.projects.length === 0) || (model.projects === null && model.error !== null)

  // ⌘N opens a folder, as the first screen says; the home has its own.
  useEffect(() => {
    if (!first) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'n' && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        open()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const drop = {
    onDragOver: (event: DragEvent) => event.preventDefault(),
    onDrop: (event: DragEvent) => {
      event.preventDefault()
      const file = event.dataTransfer.files[0]
      if (file !== undefined) void model.openDropped(file).then(opened)
    },
  }

  // A folder of several repositories: which to keep, the project's name, and who answers when agents need a yes.
  if (model.forming !== null) {
    const { forming } = model
    return (
      <div className={s.window}>
        <TitleBar lights="none">{null}</TitleBar>
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

  if (first) {
    return (
      <div className={s.window} {...drop}>
        <TitleBar lights="none">{null}</TitleBar>
        <div className={`${s.scroll} ${s.first}`}>
          <Start runtimes={runtimesOf(model, accounts)} onCreate={open} onInstall={(id) => void model.install(id)} text={text.first} />
          <StartError model={model} />
        </div>
      </div>
    )
  }

  if (model.projects === null) return <HomePending />

  return home()
}
