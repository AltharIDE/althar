import { useCallback, useEffect, useState } from 'react'

import type { DiffLine as ApiDiffLine } from '@althar/contracts'
import { type DiffLine, DiffLineKind, type FileView } from '@althar/ui'

import { messageOf } from '../../data/client'
import { useServices } from '../../data/services'

/*
 * A task's change, over the whole window: whether it's open, the file you're
 * on, and that file's diff, read from the runtime when you get to it.
 */

export interface ChangesModel {
  /** Open, on a file or on the first. */
  readonly open: boolean
  readonly selected: string | null
  readonly view: FileView
  readonly show: (path?: string) => void
  readonly select: (path: string) => void
  readonly retry: () => void
  readonly close: () => void
}

const KINDS: Readonly<Record<ApiDiffLine['kind'], DiffLineKind>> = {
  hunk: DiffLineKind.Hunk,
  context: DiffLineKind.Context,
  added: DiffLineKind.Added,
  removed: DiffLineKind.Removed,
}

/** A line as the runtime gives it, as the kit draws it. */
export const lineOf = (line: ApiDiffLine): DiffLine => ({ ...line, kind: KINDS[line.kind] }) as DiffLine

export const useChanges = (taskId: string | null, first: string | null): ChangesModel => {
  const { client } = useServices()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  /* The last diff read, by the file and attempt it was read for: until the one you're on arrives, it is loading. */
  const [read, setRead] = useState<{ readonly key: string; readonly view: FileView } | null>(null)
  const path = selected ?? first
  const key = `${taskId ?? ''}:${path ?? ''}:${attempt}`

  useEffect(() => {
    if (!open || taskId === null || path === null) return
    let current = true
    client.getFileDiff(taskId, path).then(
      (diff) => {
        if (current) setRead({ key, view: { state: 'ready', lines: diff.lines.map(lineOf), truncated: diff.truncated } })
      },
      (error: unknown) => {
        if (current) setRead({ key, view: { state: 'failed', message: messageOf(error) } })
      },
    )
    return () => {
      current = false
    }
  }, [client, open, taskId, path, key])

  return {
    open,
    selected: path,
    view: read?.key === key ? read.view : { state: 'loading' },
    show: useCallback((at?: string) => {
      if (at !== undefined) setSelected(at)
      setOpen(true)
    }, []),
    select: setSelected,
    retry: useCallback(() => setAttempt((count) => count + 1), []),
    close: useCallback(() => setOpen(false), []),
  }
}
