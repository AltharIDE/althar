import type { Launch, OfferedRefs, ProjectRepository, RepositoryScript, Runnable } from '@althar/contracts'
import {
  AddRunnable,
  type AddWay,
  type BranchChoice,
  choiceKey,
  EditRunnable,
  type ListedRunnable,
  RunButton,
  runButtonText,
  Runnables,
  type RunPlace,
  RunPlacePicker,
  type RunTarget,
  type RunTargetRun,
} from '@althar/ui'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { messageOf, type RunRef } from '../../data/client'
import { reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { addressOf } from '../../shared/running'
import { useWorkToward } from '../../shared/useWorkToward'
import { ago, running } from '../../shared/time'
import { type RunsModel, useRuns } from './useRuns'

/*
 * What a project runs, from the top of its screen or a task's bar (ADR-090):
 * the Run button, which only opens its list, each line started and stopped
 * there. In a task, what runs is the task's, in its worktree. On the project,
 * where it runs is picked beside it, as a branch is, and stays picked: the
 * default branch, a task's worktree, or a branch or pull request the remote
 * has, which Althar fetches as it runs, in a copy of its own (ADR-066); while
 * it fetches, and when it couldn't, the line says so. A branch picked there
 * is the project's Work toward too (ADR-093): what new tasks work toward, and
 * what Run's own place runs a copy of; a task or a pull request is only where
 * Run runs. A name the remote doesn't have is made there, from the default
 * branch. A run going on the old branch keeps going there until it stops,
 * and the list says so. Adding something to
 * run, the whole list, and changing one open from it or from the project's
 * settings. What runs is said here, not over the composer.
 */

/** How long a run that hasn't said where it answers is taken as starting; after, as running with no address, as an app's window. */
export const STARTING_FOR = 10_000

/** A run as the button says it: starting, up where it answers, or how it ended by itself; a stopped one is gone. */
const runOf = (launch: Launch, now: string): RunTargetRun =>
  launch.ended !== null
    ? { state: 'ended', code: launch.ended.code, since: ago(launch.ended.at, new Date(now)) }
    : launch.url !== null
      ? { state: 'running', url: addressOf(launch.url), since: running(launch.startedAt, now) }
      : Date.parse(now) - Date.parse(launch.startedAt) < STARTING_FOR
        ? { state: 'starting' }
        : { state: 'running', since: running(launch.startedAt, now) }

export const text = {
  /** At the foot of where Run runs: a branch picked there is the project's (ADR-093). */
  picks: 'A branch picked here is what new tasks work toward too. A task or pull request is only where Run runs.',
  /** Work toward moved while something runs on the old branch's copy. */
  runsOn: (names: ReadonlyArray<string>, where: string, next: string) =>
    `${names.join(', ')} ${names.length === 1 ? 'runs' : 'run'} on ${where} until stopped. The next run takes ${next}.`,
}

/** The default branch, where the project's Run runs until another place is picked. */
export const MAIN: RunPlace = { key: 'main', kind: 'main', label: 'main' }

/**
 * Where a run with no task runs, by name. While one runs there, the branch
 * its copy is of, as it says: the copy stays as it was until nothing runs
 * there, even where Work toward has moved since. Otherwise the branch the
 * project works toward (ADR-093), which the next run copies, else its default
 * branch; with repositories that go different ways, the default branch's word.
 */
export const mainOf = (
  repositories: ReadonlyArray<Pick<ProjectRepository, 'defaultBranch' | 'workToward'>> | undefined,
  launches: ReadonlyArray<Launch> = [],
): RunPlace => {
  const running = launches.find((launch) => launch.taskId === null && launch.branch == null && launch.ended === null)
  if (running !== undefined) return { ...MAIN, label: running.where }
  const names = [...new Set((repositories ?? []).map((one) => one.workToward ?? one.defaultBranch ?? MAIN.label))]
  return names.length === 1 && names[0] !== undefined ? { ...MAIN, label: names[0] } : MAIN
}

/** A pull request's number in what a run of it was fetched as: PR #12 · feature/x, MR !12. */
const pullNumber = (label: string) => {
  const found = /^(?:\S+ )?[#!](\d+)(?: · |$)/.exec(label)?.[1]
  return found === undefined ? null : Number(found)
}

/** Whether a run is at a place: the default branch's, a task's, or one fetched of that pull request or branch. */
export const runsAt = (launch: Launch, place: RunPlace) => {
  if (place.kind === 'main') return launch.taskId === null && launch.branch == null
  if (place.kind === 'task') return launch.taskId === place.key.slice('task:'.length)
  if (launch.taskId !== null || launch.branch == null) return false
  const choice = place.choice
  if (choice?.kind === 'pull') return pullNumber(launch.branch) === choice.number
  return choice?.kind === 'branch' && pullNumber(launch.branch) === null && launch.branch === choice.branch
}

/** The place a run is at, from what it says of itself. */
export const placeOfLaunch = (launch: Launch): RunPlace => {
  if (launch.taskId !== null) return { key: `task:${launch.taskId}`, kind: 'task', label: launch.where }
  if (launch.branch == null) return MAIN
  const number = pullNumber(launch.branch)
  if (number === null) {
    const choice: BranchChoice = { kind: 'branch', branch: launch.branch }
    return { key: choiceKey(choice), kind: 'branch', label: launch.branch, choice }
  }
  const [name = launch.branch, branch] = launch.branch.split(' · ')
  const choice: BranchChoice = { kind: 'pull', number, name, title: branch ?? name, ...(branch === undefined ? {} : { branch }) }
  return { key: choiceKey(choice), kind: 'pull', label: name, ...(branch === undefined ? {} : { detail: branch }), choice }
}

/** A run asked for on a branch or pull request, until it runs: fetching, or what went wrong. */
export type Attempt = { readonly state: 'fetching' } | { readonly state: 'unfetched'; readonly why: string; readonly at: string }

/** The same pull request or branch, whatever repository either says: a run's place says none. */
const sameRef = (one: RunPlace, other: RunPlace) => {
  const [a, b] = [one.choice, other.choice]
  if (a === undefined || b === undefined) return false
  if (a.repository !== undefined && b.repository !== undefined && a.repository !== b.repository) return false
  return a.kind === 'pull' ? b.kind === 'pull' && a.number === b.number : b.kind === 'branch' && a.branch === b.branch
}

/** An attempt's key: the place and what it runs. */
const attemptKey = (place: RunPlace, runnableId: string) => `${place.key}\n${runnableId}`

/** What the project runs at a place, each with its run there: one fetching or that couldn't be, else the one going, else the last. */
export const targetsOf = (
  runnables: ReadonlyArray<Runnable>,
  launches: ReadonlyArray<Launch>,
  place: RunPlace,
  now: string,
  attempts: ReadonlyMap<string, Attempt> = new Map(),
): ReadonlyArray<RunTarget> =>
  runnables.map((one) => {
    const attempt = attempts.get(attemptKey(place, one.id))
    const mine = launches.filter((launch) => launch.runnableId === one.id && runsAt(launch, place))
    const here = mine.find((launch) => launch.ended === null) ?? mine.at(-1)
    const run: RunTargetRun | undefined =
      attempt?.state === 'fetching'
        ? { state: 'fetching' }
        : attempt?.state === 'unfetched'
          ? { state: 'unfetched', why: attempt.why, since: ago(attempt.at, new Date(now)) }
          : here === undefined
            ? undefined
            : runOf(here, now)
    return {
      id: one.id,
      ...(one.name === null ? {} : { name: one.name }),
      command: one.command,
      from: one.from,
      ...(run === undefined ? {} : { run }),
    }
  })

/** Where the project's Run runs, kept per project on this Mac, so it stays picked. */
const placeKey = (projectId: string) => `althar.runOn.${projectId}`

const readPlace = (projectId: string): RunPlace => {
  try {
    const kept = JSON.parse(window.localStorage.getItem(placeKey(projectId)) ?? 'null') as RunPlace | null
    return kept !== null && typeof kept.key === 'string' && typeof kept.label === 'string' ? kept : MAIN
  } catch {
    return MAIN
  }
}

const keepPlace = (projectId: string, place: RunPlace) => {
  try {
    const { running: _running, failed: _failed, ...kept } = place
    window.localStorage.setItem(placeKey(projectId), JSON.stringify(kept))
  } catch {
    // Not kept: it is picked until the window reloads.
  }
}

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
 * The switcher of where the project's Run runs: what the remotes have, asked
 * as it opens, so it's fresh; where a host has more open pull requests than
 * it listed, what is typed searched there a moment after, and those it finds
 * added.
 */
function PlaceSwitcher({
  projectId,
  current,
  places,
  onPick,
  onCreate,
  createFrom,
  repositories,
  about,
}: {
  readonly projectId: string
  readonly current: RunPlace
  readonly places: ReadonlyArray<RunPlace>
  readonly onPick: (place: RunPlace) => void
  readonly onCreate: (branch: string, repository?: string) => void
  readonly createFrom: string | undefined
  /** The project's repositories by name, where it has several. */
  readonly repositories: ReadonlyArray<string> | undefined
  /** A line at the list's foot, where the remote has nothing to say: what a branch picked here does. */
  readonly about: string
}) {
  const { client } = useServices()
  const [open, setOpen] = useState(false)
  // Never from the cache: a branch pushed a moment ago is what the person came for.
  const offered = useQuery({
    queryKey: ['runnable-refs', projectId],
    queryFn: () => client.getRunnableRefs(projectId),
    enabled: open,
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
    enabled: open && more && searchable(words),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
  const searching = more && searchable(query.trim()) && (query.trim() !== words || searched.isFetching)
  const note = (offered.isError ? messageOf(offered.error) : offered.data?.find((one) => one.note !== null)?.note) ?? about
  const listed = offered.data === undefined ? [] : choicesOf(offered.data)
  const found = more && searchable(words) && searched.data !== undefined ? choicesOf(searched.data) : []
  const keys = new Set(listed.map(choiceKey))
  return (
    <RunPlacePicker
      current={current}
      places={places}
      remote={
        offered.isError ? [] : offered.data === undefined ? null : [...listed, ...found.filter((choice) => !keys.has(choiceKey(choice)))]
      }
      note={note}
      searching={searching}
      query={query}
      onQueryChange={setQuery}
      onPick={onPick}
      onCreate={onCreate}
      {...(createFrom === undefined ? {} : { createFrom })}
      {...(repositories === undefined ? {} : { repositories })}
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setQuery('')
      }}
    />
  )
}

/** What runs at a place, and what failed there, as the switcher says it. */
const saidAt = (
  place: RunPlace,
  runnables: ReadonlyArray<Runnable>,
  launches: ReadonlyArray<Launch>,
  attempts: ReadonlyMap<string, Attempt>,
) => {
  const nameOf = (id: string | null) => {
    const one = runnables.find((runnable) => runnable.id === id)
    return one?.name ?? one?.command ?? ''
  }
  const here = launches.filter((launch) => runsAt(launch, place))
  const failed = [
    ...here
      .filter((launch) => launch.ended !== null && launch.ended.code !== 0)
      .map((launch) => `${nameOf(launch.runnableId)} exited${launch.ended?.code == null ? '' : ` ${launch.ended.code}`}`),
    ...runnables
      .filter((one) => attempts.get(attemptKey(place, one.id))?.state === 'unfetched')
      .map((one) => `${nameOf(one.id)} couldn’t be fetched`),
  ]
  const live = here.filter((launch) => launch.ended === null).map((launch) => nameOf(launch.runnableId))
  return {
    ...place,
    ...(live.length === 0 ? {} : { running: live }),
    ...(failed.length === 0 ? {} : { failed: failed.length === 1 ? failed[0]! : `${failed.length} failed` }),
  }
}

export function Runs({
  projectId,
  project,
  taskId,
  tasks = null,
  runnables,
  launches,
  now,
  onRun,
  onStop,
  onClear,
  onRunRef,
}: {
  readonly projectId: string
  /** The project's name, for the list's title. */
  readonly project: string
  /** The task whose worktree it runs in; null on the project, where the place is picked. */
  readonly taskId: string | null
  /** On the project, the tasks it may run in, by their worktrees; null while they are read. */
  readonly tasks?: ReadonlyArray<{ readonly id: string; readonly title: string }> | null
  /** What the project runs from here, in its order. */
  readonly runnables: ReadonlyArray<Runnable>
  /** Its runs: the task's, or every one in the project. */
  readonly launches: ReadonlyArray<Launch>
  readonly now: string
  /** Runs one in a task's worktree, or with null a copy of the default branch, as the screen runs it. */
  readonly onRun: (runnableId: string, taskId: string | null) => void
  /** Stops a run, as the screen stops it. */
  readonly onStop: (launchId: string) => void
  /** Clears one that ended by itself. */
  readonly onClear: (launchId: string) => void
  /** Runs one on a branch or a pull request, in a copy of its own; throws what went wrong. Without it, only the default branch is offered. */
  readonly onRunRef?: (runnableId: string, ref: RunRef) => Promise<void>
}) {
  const dialogs = useRunDialogs(projectId)
  const { client } = useServices()
  const toward = useWorkToward(projectId)
  const repositories = useQuery(reads(client).repositories(projectId)).data
  // Each repository's Work toward as the person just picked it, while it is on its way.
  const shown = repositories?.map((one) => ({ ...one, workToward: toward.shown(one.id, one.workToward ?? null) }))
  const main = mainOf(shown, launches)
  const [kept, setPicked] = useState(() => (taskId === null ? readPlace(projectId) : MAIN))
  // The default branch's place says the branch it runs now, whatever it was called when it was kept.
  const picked = kept.kind === 'main' ? main : kept
  const [attempts, setAttempts] = useState<ReadonlyMap<string, Attempt>>(new Map())
  const attempt = (key: string, next: Attempt | null) =>
    setAttempts((was) => {
      const now = new Map(was)
      if (next === null) now.delete(key)
      else now.set(key, next)
      return now
    })

  // In a task, its worktree; on the project, the place picked, back to the default branch where its task is gone, with nothing of it running, or it can't run one.
  const gone =
    (picked.kind === 'task' &&
      tasks !== null &&
      !tasks.some((task) => `task:${task.id}` === picked.key) &&
      !launches.some((launch) => runsAt(launch, picked))) ||
    ((picked.kind === 'pull' || picked.kind === 'branch') && onRunRef === undefined)
  const place: RunPlace = taskId !== null ? { key: `task:${taskId}`, kind: 'task', label: project } : gone ? main : picked
  const pick = (next: RunPlace) => {
    setPicked(next)
    keepPlace(projectId, next)
  }
  /** A repository by the name a branch's choice gives it, or the project's one. */
  const repositoryNamed = (name: string | undefined) =>
    name === undefined ? (repositories?.length === 1 ? repositories[0] : undefined) : repositories?.find((one) => one.name === name)
  // A branch picked is the project's Work toward, and Run runs its own place, a copy of it; one something runs on still
  // opens as a place, so what runs there can be stopped.
  const pickOrMove = (next: RunPlace) => {
    const choice = next.choice?.kind === 'branch' ? next.choice : undefined
    const repository = choice === undefined ? undefined : repositoryNamed(choice.repository)
    const live = launches.some((launch) => launch.ended === null && runsAt(launch, next))
    if (choice === undefined || repository === undefined || live) return pick(next)
    const fallback = repository.defaultBranch ?? MAIN.label
    toward.change(repository.id, choice.branch === fallback ? null : choice.branch)
    pick(MAIN)
  }
  const create = (branch: string, name?: string) => {
    const repository = repositoryNamed(name)
    if (repository === undefined) return
    toward.create(repository.id, branch)
    pick(MAIN)
  }
  // Where the new branch starts: the default branch, where the repositories share one.
  const defaults = [...new Set((repositories ?? []).map((one) => one.defaultBranch ?? MAIN.label))]
  // What the list's foot says: why a branch picked didn't hold; that a run goes on where it is until it stops; or what picking does.
  const going = launches.filter((launch) => launch.taskId === null && launch.branch == null && launch.ended === null)
  const next = mainOf(shown).label
  const about =
    toward.failed?.message ??
    (going.length > 0 && going[0]?.where !== next && repositories !== undefined
      ? text.runsOn(
          going.map((launch) => {
            const one = runnables.find((runnable) => runnable.id === launch.runnableId)
            return one?.name ?? one?.command ?? ''
          }),
          going[0]?.where ?? '',
          next,
        )
      : text.picks)

  const live = (runnableId: string) =>
    launches.find((launch) => launch.runnableId === runnableId && runsAt(launch, place) && launch.ended === null)
  const ended = (runnableId: string) =>
    launches.findLast((launch) => launch.runnableId === runnableId && runsAt(launch, place) && launch.ended !== null)

  const run = (runnableId: string) => {
    if (place.choice === undefined) {
      onRun(runnableId, place.kind === 'task' ? place.key.slice('task:'.length) : null)
      return
    }
    if (onRunRef === undefined) return
    const key = attemptKey(place, runnableId)
    attempt(key, { state: 'fetching' })
    onRunRef(runnableId, refOf(place.choice)).then(
      () => attempt(key, null),
      (failure: unknown) => attempt(key, { state: 'unfetched', why: messageOf(failure), at: new Date().toISOString() }),
    )
  }

  // On the project: the default branch, the tasks, the place picked, and every pull request or branch something runs or failed on.
  const places = (() => {
    if (taskId !== null) return []
    const all: RunPlace[] = [main, ...(tasks ?? []).map((task): RunPlace => ({ key: `task:${task.id}`, kind: 'task', label: task.title }))]
    const add = (one: RunPlace) => {
      if (!all.some((known) => known.key === one.key || sameRef(known, one))) all.push(one)
    }
    if (place.kind !== 'main') add(place)
    for (const launch of launches) add(placeOfLaunch(launch))
    return all.map((one) => saidAt(one, runnables, launches, attempts))
  })()

  return (
    <>
      {taskId === null && (
        <PlaceSwitcher
          projectId={projectId}
          current={place}
          places={places}
          onPick={pickOrMove}
          onCreate={create}
          createFrom={defaults.length === 1 ? defaults[0] : undefined}
          repositories={(repositories?.length ?? 0) > 1 ? repositories?.map((one) => one.name) : undefined}
          about={about}
        />
      )}
      <RunButton
        targets={targetsOf(runnables, launches, place, now, attempts)}
        onRun={run}
        onStop={(id) => {
          const launch = live(id)
          if (launch !== undefined) onStop(launch.id)
        }}
        onOpen={(id) => {
          const url = live(id)?.url
          if (url != null) window.open(url, '_blank')
        }}
        onClear={(id) => {
          const key = attemptKey(place, id)
          if (attempts.has(key)) attempt(key, null)
          else {
            const launch = ended(id)
            if (launch !== undefined) onClear(launch.id)
          }
        }}
        onAdd={(way) => dialogs.show({ kind: 'add', way })}
        onEdit={() => dialogs.show({ kind: 'list' })}
      />
      <RunDialogs projectId={projectId} project={project} runnables={runnables} dialogs={dialogs} afterEdit={{ kind: 'list' }} />
    </>
  )
}
