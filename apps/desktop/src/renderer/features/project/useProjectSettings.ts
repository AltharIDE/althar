import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ProjectInk, ProjectNote, ProjectRulesView, ProjectSummary } from '@althar/contracts'

import { messageOf } from '../../data/client'
import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'

/*
 * A project's settings' view model: its name and ink, changed in place, its
 * rules in a line, the notes its coordinator keeps, and removing it. A note
 * dropped goes at once, and comes back, saying why, where it didn't go. A new name or ink shows at once, and
 * goes to the runtime one change after another; the tabs and the home hear
 * it through the change feed, and the projects are read again at once too,
 * so it shows everywhere before the feed is heard. One that didn't hold goes
 * back, and says why. Removing it from Althar is asked in a dialog first.
 */

export interface ProjectSettingsModel {
  readonly project: ProjectSummary | null
  /** Its name and ink as the person last chose them, before the runtime has said so. */
  readonly name: string | null
  readonly ink: ProjectInk | null
  /** The other projects' names, by the ink each has. */
  readonly taken: Partial<Record<ProjectInk, string>>
  readonly rename: (name: string) => void
  readonly setInk: (ink: ProjectInk) => void
  /** Why the last new name or ink didn't hold. */
  readonly failed: string | null
  readonly rules: ProjectRulesView | null
  /** The decisions its coordinator keeps, oldest first (ADR-029). */
  readonly notes: ReadonlyArray<ProjectNote> | null
  readonly dropNote: (noteId: string) => Promise<void>
  /** Why the last note dropped is still there. */
  readonly noteFailed: string | null
  /** Asking whether to remove it from Althar. */
  readonly removing: boolean
  readonly askRemove: () => void
  readonly closeRemove: () => void
  /** The removal is on its way. */
  readonly busy: boolean
  /** Why it couldn't be removed. */
  readonly error: string | null
  /** Removes the project; `onRemoved` is called once it is gone, from here or from another window. */
  readonly remove: () => Promise<void>
}

/** A name or ink the person chose, and which change it was, in the order they were made. */
interface Chosen {
  readonly name?: { readonly value: string; readonly change: number }
  readonly ink?: { readonly value: ProjectInk; readonly change: number }
}

export const useProjectSettings = (projectId: string, onRemoved: () => void): ProjectSettingsModel => {
  const { client, cache } = useServices()
  const read = reads(client)
  const listed = useQuery(read.projects()).data
  const project = listed?.projects.find((each) => each.id === projectId) ?? null
  const rules = useQuery(read.rules(projectId)).data ?? null
  const notes = useQuery(read.notes(projectId)).data ?? null

  // What the person chose, shown until the runtime says the same or says no.
  const [chosen, setChosen] = useState<Chosen>({})
  const [failed, setFailed] = useState<{ readonly message: string; readonly change: number } | null>(null)
  // One change after another, in the order they were made, so the last one chosen is the one kept.
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const made = useRef(0)

  const change = useCallback(
    <K extends keyof Chosen>(field: K, value: NonNullable<Chosen[K]>['value'], send: () => Promise<void>) => {
      const mine = ++made.current
      setChosen((was) => ({ ...was, [field]: { value, change: mine } }))
      const done = (failure: string | null) => {
        // Only this change's own choice goes, to the runtime's word or back: a later one of the same thing stays shown.
        setChosen((was) => (was[field]?.change === mine ? { ...was, [field]: undefined } : was))
        // A failure is said until a later change holds.
        setFailed((was) => (failure !== null ? { message: failure, change: mine } : was !== null && was.change < mine ? null : was))
      }
      queue.current = queue.current.then(async () => {
        try {
          await send()
          await cache.refetchQueries({ queryKey: keys.projects })
          done(null)
        } catch (failure) {
          done(messageOf(failure))
        }
      })
    },
    [cache],
  )

  const rename = useCallback(
    (name: string) => change('name', name, () => client.renameProject(projectId, name)),
    [change, client, projectId],
  )
  const setInk = useCallback(
    (ink: ProjectInk) => change('ink', ink, () => client.setProjectInk(projectId, ink)),
    [change, client, projectId],
  )

  const taken: Partial<Record<ProjectInk, string>> = {}
  for (const other of listed?.projects ?? []) if (other.id !== projectId && taken[other.ink] === undefined) taken[other.ink] = other.name

  const [noteFailed, setNoteFailed] = useState<string | null>(null)
  const dropNote = useCallback(
    async (noteId: string) => {
      setNoteFailed(null)
      cache.setQueryData<ReadonlyArray<ProjectNote>>(keys.notes(projectId), (was) => was?.filter((note) => note.id !== noteId))
      try {
        await client.dropProjectNote(projectId, noteId)
      } catch (failure) {
        setNoteFailed(messageOf(failure))
      }
      await cache.invalidateQueries({ queryKey: keys.notes(projectId) })
    },
    [cache, client, projectId],
  )

  const [removing, setRemoving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const askRemove = useCallback(() => {
    setError(null)
    setRemoving(true)
  }, [])
  const closeRemove = useCallback(() => {
    setError(null)
    setRemoving(false)
  }, [])
  // Once it is read again without it, the watch below sends the window on.
  const remove = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      await client.removeProject(projectId)
      await cache.refetchQueries({ queryKey: keys.projects })
      setRemoving(false)
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }, [cache, client, projectId])

  useWhenRemoved(projectId, onRemoved)

  return {
    project,
    name: chosen.name?.value ?? project?.name ?? null,
    ink: chosen.ink?.value ?? project?.ink ?? null,
    taken,
    rename,
    setInk,
    failed: failed?.message ?? null,
    rules,
    notes,
    dropNote,
    noteFailed,
    removing,
    askRemove,
    closeRemove,
    busy,
    error,
    remove,
  }
}

/**
 * Removed from another window, or by this one: once listed and then gone, the
 * window goes where `onRemoved` says, from the project or one of its tasks.
 */
export const useWhenRemoved = (projectId: string | undefined, onRemoved: () => void) => {
  const { client } = useServices()
  const listed = useQuery(reads(client).projects()).data
  const there = projectId !== undefined && (listed?.projects.some((each) => each.id === projectId) ?? false)
  const seen = useRef(false)
  useEffect(() => {
    if (there) seen.current = true
    else if (seen.current && listed !== undefined) {
      seen.current = false
      onRemoved()
    }
  }, [there, listed, onRemoved])
}
