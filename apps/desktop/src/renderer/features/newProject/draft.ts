import type { QueryClient } from '@tanstack/react-query'

import { inkFor, type ProjectInk, type ProjectSummary } from '@althar/contracts'

import { type Client, messageOf, newProjectId } from '../../data/client'
import { keys } from '../../data/reads'
import type { Host } from '../../data/services'
import { shortFolder } from '../../shared/folders'

/*
 * A project before it is made: what its own tab holds, in the window's tabs
 * beside the projects', until it is made or the tab closes. Its id is made
 * now, so its mark is drawn from it as it is named. Its folders are read as
 * they are added, each by the grant of the folder it came from, and a
 * folder of several repositories adds each. One draft a window, kept for
 * this launch only, in a store every part of the window shares, so it is
 * the same draft whichever tab the person went to meanwhile; a read that
 * ends after its tab closed changes nothing. A project that starts from
 * nothing has a new repository, placed in a folder the person chose and
 * named after the project, which is made only as the project is.
 */

/** A repository added, as the runtime read it. */
export interface DraftFolder {
  /** Its root on this Mac, as the runtime names it: what the project is made with, and its key here. */
  readonly path: string
  /** The grant of the folder it came from. */
  readonly grant: string
  readonly name: string
  /** Where it is, as the person knows the place. */
  readonly where: string
  /** Its first remote, without any password in it. */
  readonly remote: string | null
  /** The project whose folder it is already, as reading it said. */
  readonly project: string | null
  /** Main's id for it, when it was added from what main found. */
  readonly found: string | null
}

/** A new repository, placed but not made: in the folder the person chose, by its grant. */
export interface FreshRepository {
  /** The grant of the folder it goes in. */
  readonly grant: string
  /** Its folder's name, from the project's. */
  readonly name: string
  /** Its path, as the runtime placed it: the draft's key for it. */
  readonly path: string
  /** Where it will be, as the person knows the place. */
  readonly where: string
}

/** A folder being read: its name and where it is, and main's id, where they are known before it is read. */
export interface Reading {
  readonly key: string
  readonly name?: string
  readonly where?: string
  readonly found?: string
}

export interface Draft {
  /** The project's id, made now. */
  readonly id: string
  readonly name: string
  /** The ink the person chose; null for the runtime's pick, shown as it would be. */
  readonly ink: ProjectInk | null
  readonly folders: ReadonlyArray<DraftFolder>
  /** A new repository it starts with, made as it is; one at most, as it is named after the project. */
  readonly fresh: FreshRepository | null
  readonly reading: ReadonlyArray<Reading>
  readonly creating: boolean
  /** Made: its tab is the project's now, and stays only until the window has gone there; a new one starts afresh. */
  readonly made: boolean
  /** What went wrong last: reading a folder, or making the project. */
  readonly error: string | null
}

export interface DraftStore {
  readonly subscribe: (listener: () => void) => () => void
  readonly get: () => Draft | null
  /** The draft, made if there is none, or the last one was made into its project. */
  readonly start: () => Draft
  /** Closes it: nothing is made, and what is still being read is dropped. */
  readonly end: () => void
  /** Changes the draft `id`, while it is still the one open. */
  readonly change: (id: string, next: (now: Draft) => Draft) => void
}

/** What is done to the draft that needs the runtime or the main process. */
export interface DraftActions {
  /** Asks for folders, several at once, and adds what is in each. */
  readonly choose: () => Promise<void>
  /** Asks where a new repository named after the project goes, and places it there. */
  readonly startFresh: () => Promise<void>
  /** Adds folders dropped on the window. */
  readonly drop: (files: ReadonlyArray<File>) => Promise<void>
  /** Adds a repository main found, by its id, with its name and place to show while it is read. */
  readonly addFound: (id: string, shown: { readonly name: string; readonly where: string }) => Promise<void>
  /** Makes the project, in the ink shown; the project, or null when it couldn't. */
  readonly create: (ink: ProjectInk) => Promise<ProjectSummary | null>
}

/** The ink a draft's mark is drawn in: the person's, or what the runtime would pick beside the projects there are. */
export const inkOf = (draft: Draft, projects: ReadonlyArray<ProjectSummary>): ProjectInk =>
  draft.ink ??
  inkFor(
    draft.id,
    projects.map((project) => project.ink),
  )

const make = (): DraftStore => {
  let draft: Draft | null = null
  const listeners = new Set<() => void>()
  const set = (next: Draft | null) => {
    draft = next
    listeners.forEach((listener) => listener())
  }
  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    get: () => draft,
    start: () => {
      if (draft !== null && !draft.made) return draft
      const made: Draft = {
        id: newProjectId(),
        name: '',
        ink: null,
        folders: [],
        fresh: null,
        reading: [],
        creating: false,
        made: false,
        error: null,
      }
      set(made)
      return made
    },
    end: () => set(null),
    change: (id, next) => {
      if (draft !== null && draft.id === id) set(next(draft))
    },
  }
}

const stores = new WeakMap<Client, DraftStore>()

/** The window's draft: one store a client, so every part of the window sees the same one, and a test's window starts afresh. */
export const draftsOf = (client: Client): DraftStore => {
  const found = stores.get(client)
  if (found !== undefined) return found
  const made = make()
  stores.set(client, made)
  return made
}

/** Tells each folder being read apart. */
let reads = 0

/**
 * The draft's folders added and read, and the project made, through the
 * runtime and the main process. Each change is to the draft it began on: a
 * folder still being granted or read is shown as being read at once, so
 * Create waits for it, and what ends after that draft closed changes nothing.
 */
export const draftActions = ({ client, host, cache }: { client: Client; host: Host; cache: QueryClient }): DraftActions => {
  const store = draftsOf(client)

  /** Shows a folder as being read on the draft `id`, before it is granted; its key. */
  const begin = (id: string, shown: Omit<Reading, 'key'>) => {
    const key = `read-${(reads += 1)}`
    store.change(id, (now) => ({ ...now, error: null, reading: [...now.reading, { key, ...shown }] }))
    return key
  }

  /** It is read, or couldn't be: no longer shown as being read, and what came of it. */
  const finish = (id: string, key: string, next: (now: Draft) => Draft = (now) => now) =>
    store.change(id, (now) => next({ ...now, reading: now.reading.filter((reading) => reading.key !== key) }))

  /** Reads a granted folder into the draft `id`: its repository, or each one directly inside it. */
  const read = async (id: string, key: string, grant: string, shown: Omit<Reading, 'key'>) => {
    try {
      const reading = await client.readFolder(grant)
      // A folder inside a repository isn't one of a project's folders: the repository itself is what's added.
      const [inside] = reading.kind === 'inside' ? reading.repositories : []
      if (inside !== undefined)
        return finish(id, key, (now) => ({ ...now, error: `That’s a folder inside ${inside.name}. Add ${inside.name} itself.` }))
      if (reading.repositories.length === 0)
        return finish(id, key, (now) => ({ ...now, error: `There’s no git repository in ${reading.name}.` }))
      const alone = reading.kind === 'repository'
      const known = alone ? (reading.project?.name ?? null) : null
      const added = reading.repositories.map((found): DraftFolder => ({
        path: found.path,
        grant,
        name: found.name,
        // One main found is where main said it is, as the person knows the place.
        where: alone && shown.where !== undefined ? shown.where : shortFolder(found.path),
        remote: found.remote,
        project: known,
        found: alone ? (shown.found ?? null) : null,
      }))
      finish(id, key, (now) => ({
        ...now,
        folders: [...now.folders, ...added.filter((one) => !now.folders.some((kept) => kept.path === one.path))],
      }))
    } catch (failure) {
      finish(id, key, (now) => ({ ...now, error: messageOf(failure) }))
    }
  }

  /** Grants a folder, then reads it, shown as being read from the start. */
  const add = async (grant: () => Promise<string | null>, shown: Omit<Reading, 'key'>, refused: string) => {
    const at = store.get()
    if (at === null) return
    const key = begin(at.id, shown)
    const granted = await grant()
    if (granted === null) return finish(at.id, key, (now) => ({ ...now, error: refused }))
    await read(at.id, key, granted, shown)
  }

  return {
    choose: async () => {
      const at = store.get()
      if (at === null) return
      const grants = await host.pickFolders()
      await Promise.all(grants.map((grant) => read(at.id, begin(at.id, {}), grant, {})))
    },
    startFresh: async () => {
      const at = store.get()
      const name = at?.name.trim() ?? ''
      if (at === null || name === '' || at.fresh !== null) return
      const key = begin(at.id, {})
      const grant = await host.pickPlace(name)
      // Cancelled: nothing to say.
      if (grant === null) return finish(at.id, key)
      try {
        const placed = await client.placeRepository(grant, name)
        finish(at.id, key, (now) => ({
          ...now,
          fresh: { grant, name: placed.name, path: placed.path, where: shortFolder(placed.path) },
        }))
      } catch (failure) {
        finish(at.id, key, (now) => ({ ...now, error: messageOf(failure) }))
      }
    },
    drop: async (files) => {
      await Promise.all(
        files.map((file) => add(() => host.grantDropped(file), { name: file.name }, `${file.name} isn’t a folder on this computer.`)),
      )
    },
    addFound: (id, shown) =>
      add(() => host.grantFound(id), { ...shown, found: id }, `Althar couldn’t open ${shown.name}. Choose it with Choose a folder.`),
    create: async (ink) => {
      const at = store.get()
      const name = at?.name.trim() ?? ''
      if (at === null || at.creating || at.reading.length > 0 || name === '' || (at.folders.length === 0 && at.fresh === null)) return null
      store.change(at.id, (now) => ({ ...now, creating: true, error: null }))
      try {
        // The new repository is made first, and is a folder like the others from then on: trying again doesn't make it twice.
        const { fresh } = at
        const folders =
          fresh === null
            ? at.folders
            : await client.makeRepository(fresh.grant, fresh.name).then((made) => {
                const folder: DraftFolder = {
                  path: made.path,
                  grant: made.grant,
                  name: fresh.name,
                  where: fresh.where,
                  remote: null,
                  project: null,
                  found: null,
                }
                store.change(at.id, (now) => ({ ...now, fresh: null, folders: [...now.folders, folder] }))
                return [...at.folders, folder]
              })
        const [first] = folders
        if (first === undefined) return null
        const made = await client.openProject(first.grant, {
          name,
          projectId: at.id,
          ink,
          repositories: folders.map(({ grant, path }) => ({ grant, path })),
        })
        // The projects read again, so the project is in them as its tab opens.
        await cache.refetchQueries({ queryKey: keys.projects }).catch(() => undefined)
        // Made after its tab closed, it is a project like any other: nothing opens on it.
        return store.get()?.id === at.id ? made : null
      } catch (failure) {
        store.change(at.id, (now) => ({ ...now, creating: false, error: messageOf(failure) }))
        return null
      }
    },
  }
}
