import { useQuery } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'

import { ApiError, type AppSettings, type FinishedFolder, type FolderWait } from '@althar/contracts'
import type { FinishedFolder as FolderRow, HeldFolder } from '@althar/ui'

import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { ago } from '../../shared/time'

/*
 * Finished tasks' folders, as Work on this computer shows them (ADR-056): when
 * they go, the disk they are on, those Clean up takes and those held back,
 * each with why. A new choice of when shows at once; one the runtime can't
 * keep reads again, and says so, as the other settings do. Clean up and
 * Remove say what they freed, measured after, until the next change. Remove
 * sends what the person was told holds the folder: where more would be lost
 * now, or something runs from it, the runtime's words say so, and the list
 * reads again.
 */

export interface TaskFoldersModel {
  readonly wait: FolderWait
  readonly setWait: (wait: FolderWait) => void
  readonly disk: { readonly total: number; readonly used: number } | null
  /** Clean up takes these: nothing holds them. */
  readonly goes: ReadonlyArray<FolderRow>
  /** These stay, each with why, until removed by hand. */
  readonly held: ReadonlyArray<HeldFolder>
  readonly measuring: boolean
  readonly cleanUp: () => void
  readonly remove: (taskId: string) => void
  /** Opens a folder's task; absent where nothing opens one. */
  readonly open?: (taskId: string) => void
  /** What the last Clean up or Remove freed, in bytes. */
  readonly freed: number | null
  readonly busy: string | null
  /** What went wrong, in words. */
  readonly error: string | null
}

export const text = {
  failed: 'That couldn’t be done. Try again.',
  someFailed: (n: number) =>
    n === 1 ? 'One folder couldn’t be removed: something has it open.' : `${n} folders couldn’t be removed: something has them open.`,
  waitFailed: 'That choice couldn’t be kept.',
}

const rowOf = (folder: FinishedFolder, now: Date): FolderRow => ({
  id: folder.taskId,
  title: folder.title,
  kind: folder.kind,
  when: ago(folder.settledAt, now),
  bytes: folder.bytes,
})

/** Null until both the settings and the folders are read. `onTask` opens a task, by its thread. */
export const useTaskFolders = (onTask?: (threadId: string) => void): TaskFoldersModel | null => {
  const { client, cache } = useServices()
  const settings = useQuery(reads(client).settings()).data
  const folders = useQuery(reads(client).folders()).data
  const [freed, setFreed] = useState<number | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Choices in the order they were made: only the latest failing reads again.
  const made = useRef(0)

  const setWait = useCallback(
    (wait: FolderWait) => {
      const at = ++made.current
      cache.setQueryData<AppSettings>(keys.settings, (was) => (was === undefined ? was : { ...was, folderWait: wait }))
      setError(null)
      client.setFolderWait(wait).then(
        () => void cache.invalidateQueries({ queryKey: keys.folders }),
        () => {
          if (at !== made.current) return
          void cache.refetchQueries({ queryKey: keys.settings })
          setError(text.waitFailed)
        },
      )
    },
    [cache, client],
  )

  const removing = useCallback(
    (doing: string, run: () => Promise<{ readonly freed: number; readonly failed: number }>) => {
      setBusy(doing)
      setError(null)
      run().then(
        (done) => {
          setBusy(null)
          setFreed((was) => (was ?? 0) + done.freed)
          if (done.failed > 0) setError(text.someFailed(done.failed))
          void cache.invalidateQueries({ queryKey: keys.folders })
        },
        (failure: unknown) => {
          setBusy(null)
          setError(
            failure instanceof ApiError && (failure.reason === 'ChangedSinceSeen' || failure.reason === 'TaskRefused')
              ? failure.message
              : text.failed,
          )
          void cache.invalidateQueries({ queryKey: keys.folders })
        },
      )
    },
    [cache],
  )

  if (settings === undefined || folders === undefined) return null
  const now = new Date()
  return {
    wait: settings.folderWait,
    setWait,
    disk: folders.disk,
    goes: folders.folders.filter((one) => one.held === null).map((one) => rowOf(one, now)),
    held: folders.folders.flatMap((one) =>
      one.held === null ? [] : [{ ...rowOf(one, now), why: one.held.why, ...(one.held.count === null ? {} : { count: one.held.count }) }],
    ),
    measuring: folders.measuring,
    cleanUp: () => removing('clean', () => client.cleanUpFolders()),
    remove: (taskId) =>
      removing(taskId, () => client.removeTaskFolder(taskId, folders.folders.find((one) => one.taskId === taskId)?.held ?? null)),
    ...(onTask === undefined
      ? {}
      : {
          open: (taskId: string) => {
            const folder = folders.folders.find((one) => one.taskId === taskId)
            if (folder !== undefined) onTask(folder.threadId)
          },
        }),
    freed,
    busy,
    error,
  }
}
