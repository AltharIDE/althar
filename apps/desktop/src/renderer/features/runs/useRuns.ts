import type { CoordinatorSnapshot, RepositoryScript, Runnable } from '@althar/contracts'
import { useCallback, useState } from 'react'

import { messageOf } from '../../data/client'
import { useGoneAtOnce } from '../../data/goneAtOnce'
import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { queueShown, sending, unsent as unsentFrom } from '../../shared/items'

/*
 * What a project runs, as one screen keeps it (ADR-044): keeping one,
 * changing, dropping and ordering them, the repository's scripts to pick
 * from, and asking the coordinator to work out what is worth running. Each
 * says what went wrong if it did; the screens read what the project runs
 * again as the runtime says it changed. One removed is gone at once, until a
 * read without it lands, and back, saying why, where the runtime kept it;
 * the ask shows in the coordinator's thread at once, as its composer shows
 * what is said. Running and stopping are the screen's own.
 */

/** What the coordinator is asked, in the person's words, to work out what the project runs. */
export const askText =
  'Work out what this project runs besides its default, and keep each thing worth running by hand with keep_run: a dev server, Storybook, the app itself, tests in watch mode. Then tell me what you kept.'

export interface RunsModel {
  /** Keeps one, new or changed: whether it was kept. */
  readonly keep: (input: {
    readonly id?: string
    readonly name: string | null
    readonly command: string | null
    readonly repository?: string
  }) => Promise<boolean>
  /** Keeps each of these scripts, named after them: whether all were kept. */
  readonly keepScripts: (scripts: ReadonlyArray<RepositoryScript>) => Promise<boolean>
  /** Removes one: gone from what `shown` lists at once, and back, saying why, where the runtime kept it. */
  readonly drop: (runnableId: string) => void
  /** What the project runs as the person left it: those removed gone at once. Null until it is read. */
  readonly shown: ReadonlyArray<Runnable> | null
  /** Puts them in this order: the first is the default. */
  readonly order: (ids: ReadonlyArray<string>) => Promise<boolean>
  /** The repository's scripts, once read; null until then. */
  readonly scripts: ReadonlyArray<RepositoryScript> | null
  readonly readScripts: () => Promise<void>
  /**
   * Asks the coordinator, in the project's conversation, to work out what the project runs: said there at once. Where it
   * couldn't be, it goes from there, `unsent` is called, to ask again where it was asked, and the error says why.
   */
  readonly ask: (unsent?: () => void) => void
  readonly busy: boolean
  readonly error: string | null
  readonly dismissError: () => void
}

/** A script's name as something to run: Storybook for storybook; with its package, for a workspace's. */
export const nameOf = (script: RepositoryScript, root: boolean) => {
  const words = script.name.replace(/[:_-]+/g, ' ')
  const named = words.charAt(0).toUpperCase() + words.slice(1)
  return root ? named : `${named} · ${script.package.replace(/^@[^/]+\//, '')}`
}

export function useRuns({
  projectId,
  runnables = null,
}: {
  readonly projectId: string
  /** What it runs, in its order, as read; null until then. */
  readonly runnables?: ReadonlyArray<Runnable> | null
}): RunsModel {
  const { client, cache } = useServices()
  const gone = useGoneAtOnce(runnables ?? undefined, (one) => one.id)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scripts, setScripts] = useState<ReadonlyArray<RepositoryScript> | null>(null)

  /** Runs an action, saying what went wrong if it did: whether it went. */
  const act = useCallback(async (action: () => Promise<unknown>) => {
    setError(null)
    setBusy(true)
    try {
      await action()
      return true
    } catch (failure) {
      setError(messageOf(failure))
      return false
    } finally {
      setBusy(false)
    }
  }, [])

  return {
    keep: (input) => act(() => client.keepRunnable({ projectId, ...input })),
    keepScripts: (picked) =>
      act(async () => {
        for (const script of picked)
          await client.keepRunnable({
            projectId,
            // A script of the repository's root package is named by itself; a workspace's, with its package.
            name: nameOf(script, !/--filter|--workspace|^yarn workspace /.test(script.command)),
            command: script.command,
            repository: script.repository,
          })
      }),
    drop: (runnableId) => {
      setError(null)
      gone.hide([runnableId])
      client.dropRunnable(projectId, runnableId).catch((failure: unknown) => {
        gone.back(runnableId)
        setError(messageOf(failure))
      })
    },
    shown: gone.shown ?? null,
    order: (ids) => act(() => client.orderRunnables(projectId, ids)),
    scripts,
    readScripts: async () => {
      setScripts(null)
      await act(async () => setScripts(await client.getRepositoryScripts(projectId)))
    },
    ask: (unsent) => {
      setError(null)
      // Said in the coordinator's thread at once, as its composer shows what is said, until the store's copy arrives.
      let id = ''
      cache.setQueryData<CoordinatorSnapshot>(keys.coordinator(projectId), (current) => {
        if (current === undefined) return current
        const next = sending(current.items, {
          text: askText,
          queued: queueShown(current.session, true, current.accepting),
          interrupting: false,
        })
        id = next.id
        return { ...current, items: next.items }
      })
      // Its thread as the window holds it, which never changes: read only where it hasn't been.
      cache
        .ensureQueryData(reads(client).coordinator(projectId))
        .then((coordinator) => client.send({ threadId: coordinator.threadId, body: askText, disposition: 'after_current' }))
        .catch((failure: unknown) => {
          cache.setQueryData<CoordinatorSnapshot>(keys.coordinator(projectId), (current) =>
            current === undefined ? current : { ...current, items: unsentFrom(current.items, id, askText) },
          )
          unsent?.()
          setError(messageOf(failure))
        })
    },
    busy,
    error,
    dismissError: () => setError(null),
  }
}
