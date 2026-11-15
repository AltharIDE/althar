import type { QueryClient } from '@tanstack/react-query'

import {
  ApiError,
  inkFor,
  type FolderReading,
  type Product,
  type ProjectInk,
  type ProjectSummary,
  type ProjectTracker,
  type RepositoryOwner,
} from '@althar/contracts'

import { type Client, messageOf, newProjectId } from '../../data/client'
import { keys } from '../../data/reads'
import type { Host } from '../../data/services'
import { shortFolder } from '../../shared/folders'
import { remoteOf } from '../../shared/remotes'

/*
 * A project before it is made: what its own tab holds, in the window's tabs
 * beside the projects', until it is made or the tab closes. Its id is made
 * now, so its mark is drawn from it as it is named. One draft a window, kept
 * for this launch only, in a store every part of the window shares, so it is
 * the same draft whichever tab the person went to meanwhile, and nothing
 * chosen is lost on leaving it; a read that ends after its tab closed
 * changes nothing.
 *
 * Its code comes in one of three ways: a repository cloned from a code host,
 * folders on this computer, or a new repository, placed in a folder the
 * person chose and named after the project. A folder needn't be a
 * repository yet: one with no git gets it as the project is made, and one
 * with no commit its first. Where its code lives, a repository only here can
 * be put on a connected host as it is made; and its issues can go to a
 * tracker, or its host's own.
 *
 * Create does each part in turn, and keeps what each did as it goes: a
 * clone becomes a folder like any other, a folder made ready is ready, one
 * put on a host has its remote. A part that fails stops it, with a line
 * where it belongs; Create again picks up from there, and nothing is cloned,
 * made or put on a host twice.
 */

/** What git a folder has, as reading it said: ready to be a project's, none yet, or no commit yet. */
export type FolderGit = 'ready' | 'none' | 'unborn'

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
  readonly project: { readonly id: string; readonly name: string } | null
  /** Main's id for it, when it was added from what main found. */
  readonly found: string | null
  /** What git it has; made ready as the project is made. */
  readonly git: FolderGit
  /** A folder with no git: whether it has nothing in it. */
  readonly empty: boolean
  /** Cloned, or made new, as the project was being made: what that way brought, kept for Create again. */
  readonly came?: 'clone' | 'new'
}

/** A new repository, placed but not made: in the folder the person chose, by its grant. */
export interface FreshRepository {
  readonly grant: string
  readonly name: string
  readonly path: string
  readonly where: string
}

/** A folder being read: its name and where it is, and main's id, where they are known before it is read. */
export interface Reading {
  readonly key: string
  readonly name?: string
  readonly where?: string
  readonly found?: string
}

/** A repository chosen to clone: on a connection's host, by its path there, or by a URL pasted. */
export interface DraftClone {
  /** How the list knows it. */
  readonly id: string
  /** As its host names it: balazs/tidepool. */
  readonly remote: string
  readonly from: { readonly connectionId: string; readonly path: ReadonlyArray<string> } | { readonly url: string }
  /** Its host, where Althar knows it: what its changes and issues are called there. */
  readonly product: Product | null
  /** Its host's name: GitHub, or the host a URL names. */
  readonly hostName: string
  /** A repository main found of the same name, which may be it, on this computer already: added, not cloned, where it is. */
  readonly here: { readonly found: string; readonly where: string } | null
}

/** Where a repository only on this computer goes as the project is made: a new one on a connected host, or nowhere. */
export type DraftHome =
  | { readonly kind: 'here' }
  | {
      readonly kind: 'host'
      readonly connectionId: string
      /** Null for the first it may make one in. */
      readonly owner: RepositoryOwner | null
      /** Null for the project's own name, as a folder is named. */
      readonly name: string | null
      readonly private: boolean
    }

/** Where its issues go: its code host's own, a tracker connected and where on it, or nowhere yet. */
export type DraftIssues =
  | { readonly kind: 'none' }
  | { readonly kind: 'host' }
  | { readonly kind: 'tracker'; readonly connectionId: string; readonly container: { readonly id: string; readonly name: string } | null }

/** How a part of making it is going. */
export type StepState = 'idle' | 'waiting' | 'doing' | 'done'

export interface DraftSteps {
  readonly source: StepState
  readonly home: StepState
  readonly issues: StepState
}

/**
 * What stopped it, where it can be put right: Althar not let in to a folder;
 * a folder that is a project already, to open; a host's single sign-on to
 * sign in to; a name the host has taken, said at the name.
 */
export type DraftFix =
  | { readonly kind: 'access' }
  | { readonly kind: 'open'; readonly projectId: string; readonly name: string }
  | { readonly kind: 'sso'; readonly url: string | null }

export interface DraftError {
  readonly said: string
  readonly fix?: DraftFix
}

export type DraftWay = 'clone' | 'folder' | 'new'

export interface Draft {
  /** The project's id, made now. */
  readonly id: string
  readonly name: string
  /** The ink the person chose; null for the runtime's pick, shown as it would be. */
  readonly ink: ProjectInk | null
  /** Which way its code comes in; null for the one the page starts on. */
  readonly way: DraftWay | null
  readonly folders: ReadonlyArray<DraftFolder>
  /** A new repository it starts with, made as it is; one at most, as it is named after the project. */
  readonly fresh: FreshRepository | null
  readonly reading: ReadonlyArray<Reading>
  readonly clone: DraftClone | null
  /** What finds a repository to clone, as typed. */
  readonly query: string
  /** Where a clone goes, chosen by the person; null for the usual place. */
  readonly cloneInto: { readonly grant: string; readonly where: string } | null
  /** Null for the first code host connected, else here. */
  readonly home: DraftHome | null
  /** Null for what fits what is chosen. */
  readonly issues: DraftIssues | null
  readonly creating: boolean
  readonly steps: DraftSteps
  /** Made: its tab is the project's now, and stays only until the window has gone there; a new one starts afresh. */
  readonly made: boolean
  /** What went wrong last: reading a folder, or making the project. */
  readonly error: DraftError | null
  /** What is wrong with the new repository's name or owner on its host, said there. */
  readonly homeError: string | null
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

/** What making it will do, worked out from the draft and what is connected: the repository put on a host, and where its issues go. */
export interface DraftPlan {
  /** The one repository only on this computer, put on a host where `home` says. */
  readonly publish: {
    readonly connectionId: string
    readonly owner: RepositoryOwner
    readonly name: string
    readonly private: boolean
  } | null
  readonly tracker: ProjectTracker | null
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
  /** Asks where a clone goes, for this draft. */
  readonly chooseCloneInto: () => Promise<void>
  /** Asks for another folder in place of one; it stays where the person cancels. */
  readonly replace: (path: string) => Promise<void>
  /** Makes the project, in the ink shown, doing what the plan says; the project, or null when it couldn't. */
  readonly create: (ink: ProjectInk, plan: DraftPlan) => Promise<ProjectSummary | null>
}

const IDLE: DraftSteps = { source: 'idle', home: 'idle', issues: 'idle' }

/** The ink a draft's mark is drawn in: the person's, or what the runtime would pick beside the projects there are. */
export const inkOf = (draft: Draft, projects: ReadonlyArray<ProjectSummary>): ProjectInk =>
  draft.ink ??
  inkFor(
    draft.id,
    projects.map((project) => project.ink),
  )

/** A new draft, made now. */
export const freshDraft = (): Draft => ({
  id: newProjectId(),
  name: '',
  ink: null,
  way: null,
  folders: [],
  fresh: null,
  reading: [],
  clone: null,
  query: '',
  cloneInto: null,
  home: null,
  issues: null,
  creating: false,
  steps: IDLE,
  made: false,
  error: null,
  homeError: null,
})

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
      const made = freshDraft()
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

/** What a refusal says, and what puts it right, where something does. */
export const errorOf = (failure: unknown): DraftError => {
  const said = messageOf(failure)
  if (!(failure instanceof ApiError)) return { said }
  if (failure.reason === 'FolderRefused' && failure.why === 'unreadable') return { said, fix: { kind: 'access' } }
  if (failure.reason === 'CloneRefused' && failure.why === 'sso') return { said, fix: { kind: 'sso', url: failure.detail ?? null } }
  return { said }
}

/** The folders a reading adds, with what git each has; or what is wrong with it, in words. */
export const foldersOf = (
  reading: FolderReading,
  grant: string,
  shown: Omit<Reading, 'key'>,
): { readonly folders: ReadonlyArray<DraftFolder> } | { readonly error: string } => {
  // A folder inside a repository isn't one of a project's folders: the repository itself is what's added.
  const [inside] = reading.kind === 'inside' ? reading.repositories : []
  if (inside !== undefined) return { error: `That’s a folder inside ${inside.name}. Add ${inside.name} itself.` }
  const project = reading.project === null ? null : { id: reading.project.id, name: reading.project.name }
  // A folder with no repository in it gets git as the project is made.
  if (reading.kind === 'folder' && reading.repositories.length === 0)
    return {
      folders: [
        {
          path: reading.path ?? grant,
          grant,
          name: reading.name,
          where: reading.path === undefined ? (shown.where ?? reading.name) : shortFolder(reading.path),
          remote: null,
          project,
          found: shown.found ?? null,
          git: 'none',
          empty: reading.empty === true,
        },
      ],
    }
  const alone = reading.kind === 'repository'
  return {
    folders: reading.repositories.map((found): DraftFolder => ({
      path: found.path,
      grant,
      name: found.name,
      // One main found is where main said it is, as the person knows the place.
      where: alone && shown.where !== undefined ? shown.where : shortFolder(found.path),
      remote: found.remote,
      project: alone ? project : null,
      found: alone ? (shown.found ?? null) : null,
      git: found.commits === false ? 'unborn' : 'ready',
      empty: false,
    })),
  }
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

  /** Reads a granted folder into the draft `id`: its repository, each one directly inside it, or the folder, to get git. */
  const read = async (id: string, key: string, grant: string, shown: Omit<Reading, 'key'>) => {
    try {
      const reading = await client.readFolder(grant)
      const read = foldersOf(reading, grant, shown)
      if ('error' in read) return finish(id, key, (now) => ({ ...now, error: { said: read.error } }))
      finish(id, key, (now) => ({
        ...now,
        folders: [...now.folders, ...read.folders.filter((one) => !now.folders.some((kept) => kept.path === one.path))],
      }))
    } catch (failure) {
      finish(id, key, (now) => ({ ...now, error: errorOf(failure) }))
    }
  }

  /** Grants a folder, then reads it, shown as being read from the start. */
  const add = async (grant: () => Promise<string | null>, shown: Omit<Reading, 'key'>, refused: string) => {
    const at = store.get()
    if (at === null) return
    const key = begin(at.id, shown)
    const granted = await grant()
    if (granted === null) return finish(at.id, key, (now) => ({ ...now, error: { said: refused } }))
    await read(at.id, key, granted, shown)
  }

  /** Where a clone goes: the place chosen, else the usual one, else the person is asked; null where they cancel. */
  const placeFor = async (draft: Draft) => {
    if (draft.cloneInto !== null) return draft.cloneInto
    const usual = await host.clonePlace()
    return usual ?? (await host.pickClonePlace())
  }

  /** The repository main found that may be the one chosen to clone, read: added in its place where its remote is the one chosen. */
  const foundClone = async (clone: DraftClone): Promise<DraftFolder | null> => {
    if (clone.here === null) return null
    const grant = await host.grantFound(clone.here.found).catch(() => null)
    if (grant === null) return null
    const reading = await client.readFolder(grant).catch(() => null)
    const [found] = reading?.kind === 'repository' ? reading.repositories : []
    const ref = found?.remote === null || found === undefined ? null : remoteOf(found.remote)
    if (found === undefined || ref === null || ref.path.toLowerCase() !== clone.remote.toLowerCase()) return null
    return {
      path: found.path,
      grant,
      name: found.name,
      where: clone.here.where,
      remote: found.remote,
      project: reading?.project === null || reading === null ? null : { id: reading.project.id, name: reading.project.name },
      found: clone.here.found,
      git: found.commits === false ? 'unborn' : 'ready',
      empty: false,
    }
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
        finish(at.id, key, (now) => ({ ...now, error: errorOf(failure) }))
      }
    },
    drop: async (files) => {
      await Promise.all(
        files.map((file) => add(() => host.grantDropped(file), { name: file.name }, `${file.name} isn’t a folder on this computer.`)),
      )
    },
    addFound: (id, shown) =>
      add(() => host.grantFound(id), { ...shown, found: id }, `Althar couldn’t open ${shown.name}. Choose it with Choose a folder.`),
    replace: async (path) => {
      const at = store.get()
      if (at === null) return
      const grants = await host.pickFolders()
      if (grants.length === 0) return
      store.change(at.id, (now) => ({ ...now, folders: now.folders.filter((folder) => folder.path !== path) }))
      await Promise.all(grants.map((grant) => read(at.id, begin(at.id, {}), grant, {})))
    },
    chooseCloneInto: async () => {
      const at = store.get()
      if (at === null) return
      const place = await host.pickClonePlace()
      if (place !== null) store.change(at.id, (now) => ({ ...now, cloneInto: place }))
    },
    create: async (ink, plan) => {
      const at = store.get()
      const name = at?.name.trim() ?? ''
      if (at === null || at.creating || at.reading.length > 0 || name === '') return null
      const way = at.way ?? 'clone'
      const folders = at.folders.filter((folder) => (folder.came ?? 'folder') === way)
      const cloning = way === 'clone' && at.clone !== null && folders.length === 0
      const making = way === 'new' && at.fresh !== null && folders.length === 0
      if (!cloning && !making && folders.length === 0) return null
      // A folder that is a project already opens that project; it isn't made into a second one here.
      const taken = way === 'folder' ? at.folders.find((folder) => folder.project !== null) : undefined
      if (taken?.project != null) {
        const project = taken.project
        store.change(at.id, (now) => ({
          ...now,
          error: { said: `${taken.name} is ${project.name} already.`, fix: { kind: 'open', projectId: project.id, name: project.name } },
        }))
        return null
      }
      const step = (part: keyof DraftSteps, state: StepState) =>
        store.change(at.id, (now) => ({ ...now, steps: { ...now.steps, [part]: state } }))
      store.change(at.id, (now) => ({
        ...now,
        creating: true,
        error: null,
        homeError: null,
        steps: {
          source: 'doing',
          home: plan.publish === null ? 'idle' : 'waiting',
          issues: plan.tracker === null ? 'idle' : 'waiting',
        },
      }))
      const stop = (next: Partial<Draft>) => store.change(at.id, (now) => ({ ...now, creating: false, steps: IDLE, ...next }))
      try {
        // Where its code comes from: cloned, made, or made ready, each kept as it is done.
        let kept: ReadonlyArray<DraftFolder> = folders
        if (cloning && at.clone !== null) {
          const clone = at.clone
          const here = await foundClone(clone)
          let folder = here
          if (folder === null) {
            const place = await placeFor(at)
            if (place === null) {
              stop({})
              return null
            }
            const cloned = await client.cloneRepository(place.grant, clone.from)
            folder = {
              path: cloned.path,
              grant: cloned.grant,
              name: cloned.path.split(/[\\/]/).at(-1) ?? clone.remote,
              where: shortFolder(cloned.path),
              remote: clone.remote,
              project: null,
              found: null,
              git: 'ready',
              empty: false,
            }
          }
          const made = { ...folder, came: 'clone' as const }
          kept = [made]
          store.change(at.id, (now) => ({ ...now, folders: [...now.folders.filter((one) => one.came !== 'clone'), made] }))
        } else if (making && at.fresh !== null) {
          const fresh = at.fresh
          const made = await client.makeRepository(fresh.grant, fresh.name)
          const folder: DraftFolder = {
            path: made.path,
            grant: made.grant,
            name: fresh.name,
            where: fresh.where,
            remote: null,
            project: null,
            found: null,
            git: 'ready',
            empty: false,
            came: 'new',
          }
          kept = [folder]
          store.change(at.id, (now) => ({ ...now, fresh: null, folders: [...now.folders, folder] }))
        }
        for (const folder of kept) {
          if (folder.git === 'ready') continue
          // A folder not read for its path (an older runtime's reading) is the grant's own.
          const prepared = await client.prepareFolder(folder.grant, folder.path.startsWith('grant_') ? undefined : folder.path)
          const ready = { ...folder, path: prepared.path, git: 'ready' as const }
          kept = kept.map((one) => (one.path === folder.path ? ready : one))
          store.change(at.id, (now) => ({ ...now, folders: now.folders.map((one) => (one.path === folder.path ? ready : one)) }))
        }
        step('source', 'done')

        // Where its code lives: the one repository only here, put on its host before the project is made, so it opens there.
        const [alone] = kept
        if (plan.publish !== null && kept.length === 1 && alone !== undefined && alone.remote === null) {
          step('home', 'doing')
          try {
            const published = await client.publishRepository({
              at: { grant: alone.grant, path: alone.path },
              ...plan.publish,
            })
            const there = { ...alone, remote: published.webUrl }
            kept = [there]
            store.change(at.id, (now) => ({ ...now, folders: now.folders.map((one) => (one.path === alone.path ? there : one)) }))
          } catch (failure) {
            // A name the host has already is said at the name.
            if (failure instanceof ApiError && failure.reason === 'PublishRefused' && failure.why === 'taken') {
              stop({ homeError: failure.message })
              return null
            }
            throw failure
          }
          step('home', 'done')
        }

        // The project itself, under the id the window gave it.
        const [first] = kept
        if (first === undefined) {
          stop({})
          return null
        }
        const made = await client.openProject(first.grant, {
          name,
          projectId: at.id,
          ink,
          repositories: kept.map(({ grant, path }) => ({ grant, path })),
        })

        // Where its issues go: the project is made, so a tracker that can't be set is said in its settings, not here.
        if (plan.tracker !== null) {
          step('issues', 'doing')
          await client.setProjectTracker(made.id, plan.tracker).catch(() => undefined)
          step('issues', 'done')
        }
        // The projects read again, so the project is in them as its tab opens.
        await cache.refetchQueries({ queryKey: keys.projects }).catch(() => undefined)
        // Made after its tab closed, it is a project like any other: nothing opens on it.
        return store.get()?.id === at.id ? made : null
      } catch (failure) {
        stop({ error: errorOf(failure) })
        return null
      }
    },
  }
}
