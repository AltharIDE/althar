import type { Launch, RepositoryScript, Runnable } from '@althar/contracts'
import {
  AddRunnable,
  type AddWay,
  EditRunnable,
  type ListedRunnable,
  RunButton,
  runButtonText,
  Runnables,
  type RunTarget,
  type RunTargetRun,
} from '@althar/ui'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { addressOf } from '../../shared/running'
import { ago, running } from '../../shared/time'
import { type RunsModel, useRuns } from './useRuns'

/*
 * What a project runs, from the top of its screen or a task's bar (ADR-044):
 * the Run button, whose one press runs the default and whose list starts and
 * stops the rest, here (in the task's worktree, or a copy of the default
 * branch); and, opened from it or from the project's settings, adding
 * something to run, the whole list, and changing one. Running and stopping
 * are the screen's, which says what went wrong over its composer; each
 * dialog says what went wrong in it.
 */

/** How long a run that hasn't said where it answers is taken as starting; after, as running with no address, as an app's window. */
export const STARTING_FOR = 10_000

/** A run as the button says it: starting, up where it answers, or how it ended. */
const runOf = (launch: Launch, now: string): RunTargetRun =>
  launch.ended !== null
    ? { state: 'ended', code: launch.ended.code, since: ago(launch.ended.at, new Date(now)) }
    : launch.url !== null
      ? { state: 'running', url: addressOf(launch.url), since: running(launch.startedAt, now) }
      : Date.parse(now) - Date.parse(launch.startedAt) < STARTING_FOR
        ? { state: 'starting' }
        : { state: 'running', since: running(launch.startedAt, now) }

/** Its run here: the one still going, else the last; on the project, a task's going is said as elsewhere. */
export const targetsOf = (
  runnables: ReadonlyArray<Runnable>,
  launches: ReadonlyArray<Launch>,
  taskId: string | null,
  now: string,
): ReadonlyArray<RunTarget> =>
  runnables.map((one) => {
    const mine = launches.filter((launch) => launch.runnableId === one.id && launch.taskId === taskId)
    const here = mine.find((launch) => launch.ended === null) ?? mine.at(-1)
    const elsewhere =
      taskId === null && (here === undefined || here.ended !== null)
        ? launches.find((launch) => launch.runnableId === one.id && launch.taskId !== null && launch.ended === null)
        : undefined
    return {
      id: one.id,
      ...(one.name === null ? {} : { name: one.name }),
      command: one.command,
      where: taskId === null ? 'default branch' : 'this task',
      from: one.from,
      ...(here === undefined ? {} : { run: runOf(here, now) }),
      ...(elsewhere === undefined
        ? {}
        : { elsewhere: { where: `in ${elsewhere.where}`, ...(elsewhere.url === null ? {} : { url: addressOf(elsewhere.url) }) } }),
    }
  })

/** A script by its place: its repository, its package and its name. */
const scriptId = (script: RepositoryScript) => `${script.repository}:${script.package}:${script.name}`

/** What runs a command in a repository: the same command in another is another to run. */
const runsAs = (repository: string, command: string) => `${repository}\n${command}`

/** Which of the dialogs for what a project runs is open: adding one, a way, the whole list, or changing one. */
export type RunDialog =
  | { readonly kind: 'add'; readonly way: AddWay }
  | { readonly kind: 'list' }
  | { readonly kind: 'edit'; readonly id: string }
  | null

export interface RunDialogsModel {
  readonly runs: RunsModel
  readonly showing: RunDialog
  /** Opens one, or closes them with null: each says only what went wrong in it, and adding reads the repository's scripts. */
  readonly show: (next: RunDialog) => void
}

/** The dialogs for what a project runs, wherever they open from: Run's list, or the project's settings. */
export const useRunDialogs = (projectId: string): RunDialogsModel => {
  const runs = useRuns({ projectId })
  const [showing, setShowing] = useState<RunDialog>(null)
  return {
    runs,
    showing,
    show: (next) => {
      runs.dismissError()
      setShowing(next)
      if (next?.kind === 'add') void runs.readScripts()
    },
  }
}

/**
 * What the dialogs open on: adding something to run, three ways; the whole
 * list; and changing one, which goes back to `afterEdit` once kept, removed
 * or closed: the list it was opened from, or nothing where the list is on
 * the page.
 */
export function RunDialogs({
  projectId,
  project,
  runnables,
  dialogs,
  afterEdit,
}: {
  readonly projectId: string
  /** The project's name, for the list's title. */
  readonly project: string
  readonly runnables: ReadonlyArray<Runnable>
  readonly dialogs: RunDialogsModel
  readonly afterEdit: RunDialog
}) {
  const { client } = useServices()
  const repositories = (useQuery(reads(client).repositories(projectId)).data ?? []).map((one) => one.name)
  const { runs: model, showing, show } = dialogs
  const close = () => show(null)
  const error = model.error === null ? {} : { error: model.error }
  const ids = runnables.map((one) => one.id)
  const kept = new Set(runnables.map((one) => runsAs(one.repository, one.command)))
  const fresh = model.scripts?.filter((script) => !kept.has(runsAs(script.repository, script.command))) ?? null
  const editing = showing?.kind === 'edit' ? runnables.find((one) => one.id === showing.id) : undefined

  return (
    <>
      {showing?.kind === 'add' && (
        <AddRunnable
          way={showing.way}
          repositories={repositories}
          scripts={
            fresh?.map((script) => ({
              id: scriptId(script),
              command: script.command,
              body: script.body,
              // With more than one repository, the same script can be in each: each says which.
              ...(repositories.length > 1 ? { repository: script.repository } : {}),
            })) ?? null
          }
          onAdd={async ({ name, command, repository }) => {
            if (await model.keep({ name, command, ...(repository === null ? {} : { repository }) })) close()
          }}
          onAddScripts={async (picked) => {
            if (await model.keepScripts((fresh ?? []).filter((script) => picked.includes(scriptId(script))))) close()
          }}
          onAsk={async () => {
            if (await model.ask()) close()
          }}
          onClose={close}
          busy={model.busy}
          {...error}
        />
      )}
      {showing?.kind === 'list' && (
        <Runnables
          project={project}
          runnables={runnables.map(listedOf)}
          onOrder={(next) => void model.order(next)}
          onDefault={(id) => void model.order([id, ...ids.filter((one) => one !== id)])}
          onEdit={(id) => show({ kind: 'edit', id })}
          onRemove={(id) => void model.drop(id)}
          onAdd={() => show({ kind: 'add', way: 'type' })}
          onClose={close}
          {...error}
        />
      )}
      {editing !== undefined && (
        <EditRunnable
          name={editing.name}
          command={editing.command}
          own={editing.own}
          from={editing.from}
          repository={editing.repository}
          repositories={repositories.length > 0 ? repositories : [editing.repository]}
          onSave={async ({ name, command, repository }) => {
            if (await model.keep({ id: editing.id, name, command, repository })) show(afterEdit)
          }}
          onRemove={async () => {
            if (await model.drop(editing.id)) show(afterEdit)
          }}
          onClose={() => show(afterEdit)}
          busy={model.busy}
          {...error}
        />
      )}
    </>
  )
}

/** One of what the project runs, as the list shows it: where it runs, and who said how. */
export const listedOf = (one: Runnable): ListedRunnable => ({
  id: one.id,
  ...(one.name === null ? {} : { name: one.name }),
  command: one.command,
  about: `${one.repository} · ${runButtonText.from[one.from]}`,
})

export function Runs({
  projectId,
  project,
  taskId,
  runnables,
  launches,
  now,
  onRun,
  onStop,
}: {
  readonly projectId: string
  /** The project's name, for the list's title. */
  readonly project: string
  /** The task whose worktree it runs in; null for a copy of the default branch. */
  readonly taskId: string | null
  /** What the project runs from here, in its order. */
  readonly runnables: ReadonlyArray<Runnable>
  /** Its runs: the task's, or every one in the project. */
  readonly launches: ReadonlyArray<Launch>
  readonly now: string
  /** Runs one here, as the screen runs it. */
  readonly onRun: (runnableId: string) => void
  /** Stops a run, as the screen stops it. */
  readonly onStop: (launchId: string) => void
}) {
  const dialogs = useRunDialogs(projectId)
  const live = (runnableId: string) =>
    launches.find((launch) => launch.runnableId === runnableId && launch.taskId === taskId && launch.ended === null)

  return (
    <>
      <RunButton
        targets={targetsOf(runnables, launches, taskId, now)}
        onRun={onRun}
        onStop={(id) => {
          const launch = live(id)
          if (launch !== undefined) onStop(launch.id)
        }}
        onOpen={(id) => {
          const url = live(id)?.url
          if (url != null) window.open(url, '_blank')
        }}
        onAdd={(way) => dialogs.show({ kind: 'add', way })}
        onEdit={() => dialogs.show({ kind: 'list' })}
      />
      <RunDialogs projectId={projectId} project={project} runnables={runnables} dialogs={dialogs} afterEdit={{ kind: 'list' }} />
    </>
  )
}
