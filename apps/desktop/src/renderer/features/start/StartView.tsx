import { type DragEvent, useEffect } from 'react'

import type { AccountStatus, AgentStatus, ProjectSummary } from '@charrette/contracts'
import { type AccountEntry, Accounts, Button, Heading, type RuntimeEntry, Runtimes, RuntimeState, Spinner, TitleBar } from '@charrette/ui'
import { Start } from '@charrette/ui/screens'

import { brandOf } from '../../shared/agents'
import { clock } from '../../shared/time'
import { ConnectionsView, text as connectionsText } from '../connections/ConnectionsView'
import type { ConnectionsModel } from '../connections/useConnections'
import s from './Start.module.css'
import type { StartModel } from './useStart'

/*
 * Before anything else: the agents on this Mac, and the projects. With no
 * project yet, the kit's Start screen, whose one way in is opening a folder.
 */

export const text = {
  agents: 'Agents on this Mac',
  projects: 'Projects',
  open: 'Open a folder',
  opening: 'Opening…',
  tasks: (n: number) => (n === 1 ? '1 task' : `${n} tasks`),
  running: (n: number) => `${n} working`,
  waiting: (n: number) => (n === 1 ? '1 call waits on you' : `${n} calls wait on you`),
  connecting: 'Looking at the agents on this Mac…',
  /** The kit's start screen, saying only what this app does: one folder, by the button or ⌘N. */
  first: {
    create: { title: 'Open a folder', note: 'A folder in a git repository becomes a project', kbd: '⌘N' },
    drop: 'Or drop a repository folder anywhere on this window.',
  },
}

/** A folder as the person would recognise it: under their home, from ~. */
export const shortFolder = (path: string) => path.replace(/^\/Users\/[^/]+(?=\/)/, '~')

/** An account, as a row of the kit's list of an agent's accounts. */
export const accountEntry = (account: AccountStatus, now: Date = new Date()): AccountEntry => ({
  id: account.id,
  name: account.name,
  place:
    account.home === null
      ? { kind: 'usual' }
      : account.adoptedFrom === null
        ? { kind: 'own' }
        : { kind: 'adopted', folder: shortFolder(account.home), from: account.adoptedFrom },
  state:
    account.outUntil !== null
      ? { kind: 'out', back: clock(account.outUntil, now) }
      : account.signIn === 'signed_out'
        ? { kind: 'signedOut' }
        : { kind: 'ready', ...(account.paidBy === 'unknown' ? {} : { paid: account.paidBy }) },
})

/** An agent's sign-in, as a row of the kit's list of agents, with what goes under it: its accounts. */
export const runtimeEntry = (agent: AgentStatus, detail?: RuntimeEntry['detail']): RuntimeEntry => {
  const brand = brandOf(agent.id)
  const base = { id: agent.id, name: agent.name, ...(brand === undefined ? {} : { brand }), ...(detail === undefined ? {} : { detail }) }
  switch (agent.signIn) {
    case 'signed_in':
      return { ...base, state: RuntimeState.Ready }
    case 'signed_out':
      return { ...base, state: RuntimeState.SignedOut }
    case 'unknown':
      return { ...base, state: RuntimeState.Ready, account: 'Signed in, as far as it says' }
  }
}

function ProjectRow({ project, onOpen }: { project: ProjectSummary; onOpen: () => void }) {
  const notes = [
    text.tasks(project.tasks),
    ...(project.running > 0 ? [text.running(project.running)] : []),
    ...(project.waiting > 0 ? [text.waiting(project.waiting)] : []),
  ]
  return (
    <li>
      <button type="button" className={s.project} onClick={onOpen}>
        <span className={s.name}>{project.name}</span>
        <span className={s.where}>{project.repository}</span>
        <span className={s.notes}>{notes.join(' · ')}</span>
      </button>
    </li>
  )
}

export function StartView({
  model,
  connections,
  onProject,
}: {
  model: StartModel
  connections: ConnectionsModel
  onProject: (projectId: string) => void
}) {
  const opened = (project: ProjectSummary | null) => {
    if (project !== null) onProject(project.id)
  }
  const open = () => void model.openFolder().then(opened)

  // ⌘N opens a folder, as the first screen says.
  useEffect(() => {
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
  const runtimes =
    model.status?.agents.map((agent) =>
      runtimeEntry(
        agent,
        <Accounts
          agent={agent.name}
          accounts={agent.accounts.map((account) => accountEntry(account))}
          found={(model.found[agent.id] ?? []).map((place) => ({
            id: place.grant,
            name: place.name,
            folder: shortFolder(place.path),
            from: place.tool,
          }))}
          onAdding={() => model.lookForAccounts(agent.id)}
          onAdd={({ name, where }) => model.addAccount(agent.id, name, where.kind === 'found' ? { kind: 'found', grant: where.id } : where)}
          onSignIn={(accountId) => void model.signInAccount(accountId)}
          onRename={(accountId, name) => void model.renameAccount(accountId, name)}
          onMove={(accountId, to) => void model.moveAccount(agent.id, accountId, to)}
          onRemove={(accountId) => void model.removeAccount(accountId)}
        />,
      ),
    ) ?? []
  const error =
    model.error === null ? null : (
      <p className={s.error} role="alert">
        {model.error}
      </p>
    )

  if (model.projects !== null && model.projects.length === 0) {
    return (
      <div className={s.window} {...drop}>
        <TitleBar>{null}</TitleBar>
        <div className={`${s.scroll} ${s.first}`}>
          <Start runtimes={runtimes} onCreate={open} text={text.first} />
          {error}
        </div>
      </div>
    )
  }

  return (
    <div className={s.window} {...drop}>
      <TitleBar>{null}</TitleBar>
      <main className={`${s.scroll} ${s.start}`}>
        <section aria-labelledby="projects">
          <div className={s.head}>
            <Heading level={1} id="projects">
              {text.projects}
            </Heading>
            <Button icon="plus" onClick={open} busy={model.opening}>
              {model.opening ? text.opening : text.open}
            </Button>
          </div>
          {error}
          {model.projects === null ? (
            <Spinner />
          ) : (
            <ul className={s.projects}>
              {model.projects.map((project) => (
                <ProjectRow key={project.id} project={project} onOpen={() => onProject(project.id)} />
              ))}
            </ul>
          )}
        </section>
        <div className={s.side}>
          <section aria-labelledby="agents" className={s.agents}>
            <Heading level={2} id="agents">
              {text.agents}
            </Heading>
            {model.status === null ? <p className={s.quiet}>{text.connecting}</p> : <Runtimes label={text.agents} runtimes={runtimes} />}
          </section>
          <section aria-labelledby="connections" className={s.agents}>
            <Heading level={2} id="connections">
              {connectionsText.label}
            </Heading>
            <ConnectionsView model={connections} />
          </section>
        </div>
      </main>
    </div>
  )
}
