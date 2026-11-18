import type { RepositoryScript, Runnable } from '@althar/contracts'
import { useCallback, useState } from 'react'

import { messageOf } from '../../data/client'
import { useGoneAtOnce } from '../../data/goneAtOnce'
import { useServices } from '../../data/services'
import { draftKey, focusDraft, setDraftText } from '../../shared/drafts'

/*
 * What a project runs, as one screen keeps it (ADR-044): keeping one,
 * changing, dropping and ordering them, the repository's scripts to pick
 * from, and asking the coordinator to work out what is worth running. Each
 * says what went wrong if it did; the screens read what the project runs
 * again as the runtime says it changed. One removed is gone at once, until a
 * read without it lands, and back, saying why, where the runtime kept it;
 * asking the coordinator puts the words in its composer, unsent, for the
 * person to change or send. Running and stopping are the screen's own.
 */

/** What the coordinator is asked, in the person's words, to work out what the project runs. */
export const askText =
  'Please work out what this project runs besides its default, and keep each thing worth running by hand, such as a dev server, Storybook, the app itself or the tests in watch mode. Then tell me what you kept.'

/** The same, following on from what the person had written already. */
export const askAfterText = `And p${askText.slice(1)}`

/**
 * The coordinator's draft with the ask in it: alone in an empty one; on a new line after what the person had written,
 * never over it; and once, where it is there already.
 */
export const withAsk = (draft: string) =>
  draft.trim() === '' ? askText : draft.includes(askText) || draft.includes(askAfterText) ? draft : `${draft.trimEnd()}\n${askAfterText}`

/** Puts the ask in a project's coordinator's composer, unsent, which takes the focus as it next shows. */
export const askInDraft = (projectId: string) => {
  const key = draftKey.coordinator(projectId)
  setDraftText(key, withAsk)
  focusDraft(key)
}

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
  const { client } = useServices()
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
    // Read behind the dialog, which says it is reading: nothing in it waits on them but their own list.
    readScripts: async () => {
      setScripts(null)
      try {
        setScripts(await client.getRepositoryScripts(projectId))
      } catch (failure) {
        setError(messageOf(failure))
      }
    },
    busy,
    error,
    dismissError: () => setError(null),
  }
}
