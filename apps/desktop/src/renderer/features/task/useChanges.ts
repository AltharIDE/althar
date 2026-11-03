import { useCallback, useEffect, useState } from 'react'

import type { DiffLine as ApiDiffLine, TaskFinding } from '@althar/contracts'
import { type DiffLine, DiffLineKind, type FileView, type ViewedFinding, worstFirst } from '@althar/ui'

import { messageOf } from '../../data/client'
import { useServices } from '../../data/services'

/*
 * A task's change, over the whole window: whether it's open, the file you're
 * on, and that file's diff, read from the runtime when you get to it. And
 * what its reviews found, read each time it opens and as the change moves,
 * each where it is in the change now: the finding you're on, and a way to
 * open it on a review's findings.
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
  /** What the task's reviews found, as the Changes view shows them. */
  readonly findings: ReadonlyArray<ViewedFinding>
  /** The files they name that the change left alone. */
  readonly untouched: ReadonlyArray<string>
  /** The finding you're on. */
  readonly finding: string | null
  readonly goToFinding: (id: string) => void
  /** Opens on a review's findings: its worst first, or with `index`, that one, in the reviewer's order. */
  readonly showFindings: (round: number, index?: number) => void
}

const KINDS: Readonly<Record<ApiDiffLine['kind'], DiffLineKind>> = {
  hunk: DiffLineKind.Hunk,
  context: DiffLineKind.Context,
  added: DiffLineKind.Added,
  removed: DiffLineKind.Removed,
}

/** A line as the runtime gives it, as the kit draws it. */
export const lineOf = (line: ApiDiffLine): DiffLine => ({ ...line, kind: KINDS[line.kind] }) as DiffLine

/** A finding as the runtime gives it, as the Changes view shows it. */
export const viewedFinding = (finding: TaskFinding): ViewedFinding => ({
  id: finding.id,
  weight: finding.severity,
  title: finding.title,
  claim: finding.claim,
  state: finding.state,
  reason: finding.reason,
  commit: finding.commit,
  path: finding.at?.path ?? null,
  line: finding.at?.line ?? null,
})

/** Which of a review's findings to open on: that one in the reviewer's order, else its worst. */
export const findingFor = (findings: ReadonlyArray<TaskFinding>, round: number, index?: number): TaskFinding | undefined => {
  const its = findings.filter((finding) => finding.round === round)
  if (index !== undefined && its[index] !== undefined) return its[index]
  return worstFirst(its.map((finding) => ({ ...finding, weight: finding.severity })))[0]
}

/**
 * `moved` says the change moved, so what was found is placed again: the
 * files' paths and sizes, say.
 */
export const useChanges = (taskId: string | null, first: string | null, moved = ''): ChangesModel => {
  const { client } = useServices()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  /* The last diff read, by the file and attempt it was read for: until the one you're on arrives, it is loading. */
  const [read, setRead] = useState<{ readonly key: string; readonly view: FileView } | null>(null)
  /* What the reviews found, by the task it was read for; and the review to open on, once it is read. */
  const [found, setFound] = useState<{ readonly taskId: string; readonly findings: ReadonlyArray<TaskFinding> } | null>(null)
  const [finding, setFinding] = useState<string | null>(null)
  const [wanted, setWanted] = useState<{ readonly round: number; readonly index?: number } | null>(null)
  const findings = found?.taskId === taskId ? found.findings : []
  const path = selected ?? first
  // A file the change left alone that a finding names is read whole, every line unchanged.
  const untouched = [...new Set(findings.flatMap((one) => (one.at?.untouched === true ? [one.at.path] : [])))]
  const whole = path !== null && untouched.includes(path)
  const key = `${taskId ?? ''}:${path ?? ''}:${whole}:${attempt}`

  useEffect(() => {
    if (!open || taskId === null) return
    let current = true
    client.getTaskFindings(taskId).then(
      (answer) => {
        if (current) setFound({ taskId, findings: answer.findings })
      },
      // Without them, the change shows as it would without a review.
      () => {
        if (current) setFound({ taskId, findings: [] })
      },
    )
    return () => {
      current = false
    }
  }, [client, open, taskId, moved])

  // Opened on a review: once what it found is read, its finding, in its file.
  if (wanted !== null && found !== null && found.taskId === taskId) {
    const target = findingFor(found.findings, wanted.round, wanted.index)
    setWanted(null)
    if (target !== undefined) {
      setFinding(target.id)
      if (target.at !== null) setSelected(target.at.path)
    }
  }

  // While it waits for the review's findings, the file it would open on isn't read the wrong way.
  const waiting = wanted !== null
  useEffect(() => {
    if (!open || waiting || taskId === null || path === null) return
    let current = true
    const diff = whole ? client.getFileDiff(taskId, path, true) : client.getFileDiff(taskId, path)
    diff.then(
      (read) => {
        if (current) setRead({ key, view: { state: 'ready', lines: read.lines.map(lineOf), truncated: read.truncated } })
      },
      (error: unknown) => {
        if (current) setRead({ key, view: { state: 'failed', message: messageOf(error) } })
      },
    )
    return () => {
      current = false
    }
  }, [client, open, waiting, taskId, path, whole, key])

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
    findings: findings.map(viewedFinding),
    untouched,
    finding,
    goToFinding: setFinding,
    showFindings: useCallback((round: number, index?: number) => {
      // Read afresh, so it opens on where the finding is now.
      setFound(null)
      setWanted(index === undefined ? { round } : { round, index })
      setOpen(true)
    }, []),
  }
}
