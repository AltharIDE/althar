import type { Launch, OfferedRefs, RepositoryScript, Runnable } from '@althar/contracts'
import {
  AddRunnable,
  type AddWay,
  type BranchChoice,
  choiceKey,
  EditRunnable,
  type ListedRunnable,
  RunBranch,
  RunButton,
  runButtonText,
  Runnables,
  type RunTarget,
  type RunTargetRun,
} from '@althar/ui'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { messageOf, type RunRef } from '../../data/client'
import { reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { addressOf } from '../../shared/running'
import { ago, running } from '../../shared/time'
import { type RunsModel, useRuns } from './useRuns'

/*
 * What a project runs, from the top of its screen or a task's bar (ADR-044):
 * the Run button, whose one press runs the default and whose list starts and
 * stops the rest, here (in the task's worktree, or a copy of the default
 * branch); on the project, running a branch or a pull request, picked from
 * what its remote has now, in a copy of its own (ADR-062); and, opened from
 * it or from the project's settings, adding
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

/** It runs the default branch here, or the task's: not a branch's copy, which the pill shows on its own. */
const ofHere = (launch: Launch, taskId: string | null) => launch.taskId === taskId && launch.branch == null

/** Its run here: the one still going, else the last; on the project, a task's going is said as elsewhere. */
export const targetsOf = (
  runnables: ReadonlyArray<Runnable>,
  launches: ReadonlyArray<Launch>,
  taskId: string | null,
  now: string,
): ReadonlyArray<RunTarget> =>
  runnables.map((one) => {
    const mine = launches.filter((launch) => launch.runnableId === one.id && ofHere(launch, taskId))
    const here = mine.find((launch) => launch.ended === null) ?? mine.at(-1)
    const elsewhere =
      taskId === null && (here === undefined || here.ended !== null)
        ? launches.find((launch) => launch.runnableId === one.id && !ofHere(launch, null) && launch.ended === null)
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

/** What the repositories offer, as the picker lists it: each one's pull requests, then its branches, saying which repository where there are several. */
export const choicesOf = (offered: ReadonlyArray<OfferedRefs>): BranchChoice[] => {
  const several = offered.length > 1
  const of = (repository: string) => (several ? { repository } : {})
  return [
    ...offered.flatMap((one) =>
      one.pullRequests.map((pull): BranchChoice => ({
        kind: 'pull',
        number: pull.number,
        name: pull.name,
        title: pull.title,
        branch: pull.branch,
        ...(pull.author === null ? {} : { author: pull.author }),
        draft: pull.draft,
        fork: pull.fork,
        ...of(one.repository),
      })),
    ),
    ...offered.flatMap((one) => one.branches.map((branch): BranchChoice => ({ kind: 'branch', branch, ...of(one.repository) }))),
  ]
}

/** A choice, as a run of it is asked for. */
const refOf = (choice: BranchChoice): RunRef => ({
  ...(choice.kind === 'pull' ? { pullRequest: String(choice.number) } : { branch: choice.branch }),
  ...(choice.repository === undefined ? {} : { repository: choice.repository }),
})

/** Words worth searching the host for: a few letters, not a number, which runs that pull request as it is. */
const searchable = (words: string) => words.length >= 2 && !/^[#!]?\d+$/.test(words)

/**
 * The picker of a branch or a pull request to run: what the remotes have,
 * asked as it opens, so it's fresh; where a host has more open pull requests
 * than it listed, what is typed searched there a moment after, and those it
 * finds added; the one picked fetching until it runs, then closed; what went
 * wrong said in it.
 */
function RunABranch({
  projectId,
  onRun,
  onClose,
}: {
  readonly projectId: string
  readonly onRun: (ref: RunRef) => Promise<void>
  readonly onClose: () => void
}) {
  const { client } = useServices()
  // Never from the cache: a branch pushed a moment ago is what the person came for.
  const offered = useQuery({
    queryKey: ['runnable-refs', projectId],
    queryFn: () => client.getRunnableRefs(projectId),
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  })
  const [query, setQuery] = useState('')
  const [words, setWords] = useState('')
  useEffect(() => {
    const later = setTimeout(() => setWords(query.trim()), 250)
    return () => clearTimeout(later)
  }, [query])
  const more = offered.data?.some((one) => one.more) ?? false
  const searched = useQuery({
    queryKey: ['runnable-refs', projectId, words],
    queryFn: () => client.getRunnableRefs(projectId, words),
    enabled: more && searchable(words),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
  const searching = more && searchable(query.trim()) && (query.trim() !== words || searched.isFetching)
  const [starting, setStarting] = useState<string | null>(null)
  const [error, setError] = useState<string>()
  const note = offered.isError ? messageOf(offered.error) : offered.data?.find((one) => one.note !== null)?.note
  const listed = offered.data === undefined ? [] : choicesOf(offered.data)
  const found = more && searchable(words) && searched.data !== undefined ? choicesOf(searched.data) : []
  const keys = new Set(listed.map(choiceKey))
  return (
    <RunBranch
      choices={
        offered.isError ? [] : offered.data === undefined ? null : [...listed, ...found.filter((choice) => !keys.has(choiceKey(choice)))]
      }
      query={query}
      onQueryChange={setQuery}
      searching={searching}
      {...(note == null ? {} : { note })}
      starting={starting}
      {...(error === undefined ? {} : { error })}
      onRun={async (choice) => {
        setError(undefined)
        setStarting(choiceKey(choice))
        try {
          await onRun(refOf(choice))
          onClose()
        } catch (failure) {
          setError(messageOf(failure))
        } finally {
          setStarting(null)
        }
      }}
      onClose={onClose}
    />
  )
}

export function Runs({
  projectId,
  project,
  taskId,
  runnables,
  launches,
  now,
  onRun,
  onStop,
  onRunBranch,
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
  /** Runs a branch or a pull request, in a copy of its own; throws what went wrong. Without it, the list doesn't offer one. */
  readonly onRunBranch?: (ref: RunRef) => Promise<void>
}) {
  const dialogs = useRunDialogs(projectId)
  const [picking, setPicking] = useState(false)
  const live = (runnableId: string) =>
    launches.find((launch) => launch.runnableId === runnableId && ofHere(launch, taskId) && launch.ended === null)

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
        {...(onRunBranch === undefined ? {} : { onRunBranch: () => setPicking(true) })}
      />
      {picking && onRunBranch !== undefined && <RunABranch projectId={projectId} onRun={onRunBranch} onClose={() => setPicking(false)} />}
      <RunDialogs projectId={projectId} project={project} runnables={runnables} dialogs={dialogs} afterEdit={{ kind: 'list' }} />
    </>
  )
}
