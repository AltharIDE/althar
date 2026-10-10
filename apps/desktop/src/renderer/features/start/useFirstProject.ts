import { useQuery } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import type { ProjectSummary } from '@althar/contracts'

import { messageOf } from '../../data/client'
import { keys } from '../../data/reads'
import { useServices } from '../../data/services'
import { shortFolder } from '../../shared/folders'
import { ago } from '../../shared/time'

/*
 * The first screen's project, before there is one: the repositories main
 * found where people keep code, any the person adds or drops on the
 * window, which of them are ticked, and the name. A repository found is
 * granted only when the project is made, and only the ones ticked; the
 * window never names a path. A folder added is read at once, and a folder
 * of several repositories adds each of them, ticked.
 */

/** A repository that could be in the first project. */
export interface Candidate {
  /** Its id on the screen: main's id for one found, its root for one added. */
  readonly id: string
  readonly name: string
  /** Where it is, as the person knows the place. */
  readonly where: string
  /** Its branch and when it was last worked on, or that it was just added. */
  readonly facts: string
  /** Main's id for it, to grant it by once the project is made; null for one added. */
  readonly found: string | null
  /** The grant of the folder it was added by, and its root as the runtime read it; null for one found. */
  readonly added: { readonly grant: string; readonly path: string; readonly alone: boolean } | null
}

export interface FirstProjectModel {
  /** Where main looked, as the person knows the places; null while it looks. */
  readonly lookedIn: ReadonlyArray<string> | null
  /** Those added, newest first, then those found; null while main looks. */
  readonly candidates: ReadonlyArray<Candidate> | null
  /** The ticked, by id, in the order they were. */
  readonly picked: ReadonlyArray<string>
  readonly toggle: (id: string) => void
  /** The project's name: the person's, or the first ticked one's. */
  readonly name: string
  readonly rename: (name: string) => void
  /** Asks for a folder and adds what is in it, ticked. */
  readonly add: () => Promise<void>
  /** Adds folders dropped on the window, ticked. */
  readonly addDropped: (files: ReadonlyArray<File>) => Promise<void>
  /** Makes the project of what is ticked; null when it couldn't. */
  readonly make: () => Promise<ProjectSummary | null>
  readonly making: boolean
  readonly error: string | null
}

/** A repository that couldn't be had as the project was made, in the screen's words. */
class Unopened extends Error {}

/** The repositories found, read once a window: the first screen shows them, and nothing else does. */
const foundKey = ['found-repositories'] as const

const factsOf = (branch: string | null, worked: number, now: Date) =>
  [branch, worked > 0 ? ago(new Date(worked).toISOString(), now) : null].filter((part) => part !== null).join(' · ')

export const useFirstProject = (): FirstProjectModel => {
  const { client, host, cache } = useServices()
  const found = useQuery({ queryKey: foundKey, queryFn: () => host.findRepositories(), staleTime: Infinity })
  const [added, setAdded] = useState<ReadonlyArray<Candidate>>([])
  const [picked, setPicked] = useState<ReadonlyArray<string>>([])
  const [named, setNamed] = useState<string | null>(null)
  const [making, setMaking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const now = new Date()
  // A repository found and added too is listed once, as added: it has its grant already. The window knows a found one only by where it is.
  const addedAt = new Set(added.map((candidate) => candidate.where))
  const fromMain =
    found.data?.repositories.map((repository): Candidate => ({
      id: repository.id,
      name: repository.name,
      where: repository.where,
      facts: factsOf(repository.branch, repository.worked, now),
      found: repository.id,
      added: null,
    })) ?? null
  // A failed look offers no repositories, but still Add a folder.
  const candidates = found.isError
    ? added
    : fromMain === null
      ? null
      : [...added, ...fromMain.filter((candidate) => !addedAt.has(candidate.where))]
  const chosen = picked.flatMap((id) => candidates?.find((candidate) => candidate.id === id) ?? [])
  const name = named ?? chosen[0]?.name ?? ''

  const toggle = useCallback((id: string) => setPicked((now) => (now.includes(id) ? now.filter((x) => x !== id) : [...now, id])), [])

  /** Reads the folder by its grant and adds the repositories in it, ticked. */
  const addGranted = useCallback(
    async (grant: string | null) => {
      if (grant === null) return
      setError(null)
      try {
        const reading = await client.readFolder(grant)
        // A repository, or a folder inside one, is opened as itself when it is the only one; a folder of several adds each.
        const alone = reading.kind !== 'folder'
        const more = reading.repositories.map((repository): Candidate => ({
          id: repository.path,
          name: alone ? reading.name : repository.name,
          where: shortFolder(repository.folder === null ? repository.path : `${repository.path}/${repository.folder}`),
          facts: 'added',
          found: null,
          added: { grant, path: repository.path, alone },
        }))
        if (more.length === 0) return setError(`There’s no git repository in ${reading.name}.`)
        setAdded((now) => [...more, ...now.filter((candidate) => !more.some((m) => m.id === candidate.id))])
        setPicked((now) => [...now, ...more.map((m) => m.id).filter((id) => !now.includes(id))])
      } catch (failure) {
        setError(messageOf(failure))
      }
    },
    [client],
  )

  const add = useCallback(async () => addGranted(await host.pickFolder()), [host, addGranted])

  const addDropped = useCallback(
    async (files: ReadonlyArray<File>) => {
      for (const file of files) {
        const grant = await host.grantDropped(file)
        if (grant === null) setError(`${file.name} isn’t a folder on this computer.`)
        else await addGranted(grant)
      }
    },
    [host, addGranted],
  )

  const make = useCallback(async () => {
    if (chosen.length === 0) {
      setError('Tick a repository for the project first.')
      return null
    }
    setError(null)
    setMaking(true)
    try {
      // Each found one is granted now, and read for its root, as the runtime names it.
      const repositories = await Promise.all(
        chosen.map(async (candidate) => {
          if (candidate.added !== null) return candidate.added
          const grant = candidate.found === null ? null : await host.grantFound(candidate.found)
          if (grant === null) throw new Unopened(`Althar couldn’t open ${candidate.name}. Add it with Add a folder.`)
          const [root] = (await client.readFolder(grant)).repositories
          if (root === undefined) throw new Unopened(`${candidate.name} isn’t a git repository any more.`)
          return { grant, path: root.path, alone: true }
        }),
      )
      const [first] = repositories
      if (first === undefined) return null
      const title = name.trim() === '' ? undefined : name.trim()
      // One repository added as itself opens as the folder it was, a package of a monorepo included.
      const made =
        repositories.length === 1 && first.alone
          ? await (title === undefined ? client.openProject(first.grant) : client.openProject(first.grant, { name: title }))
          : await client.openProject(first.grant, {
              ...(title === undefined ? {} : { name: title }),
              repositories: repositories.map(({ grant, path }) => ({ grant, path })),
            })
      await cache.refetchQueries({ queryKey: keys.projects }).catch(() => undefined)
      return made
    } catch (failure) {
      setError(failure instanceof Unopened ? failure.message : messageOf(failure))
      return null
    } finally {
      setMaking(false)
    }
  }, [cache, chosen, client, host, name])

  return {
    lookedIn: found.data?.lookedIn ?? (found.isError ? [] : null),
    candidates,
    picked: picked.filter((id) => candidates?.some((candidate) => candidate.id === id) ?? true),
    toggle,
    name,
    rename: setNamed,
    add,
    addDropped,
    make,
    making,
    error,
  }
}
