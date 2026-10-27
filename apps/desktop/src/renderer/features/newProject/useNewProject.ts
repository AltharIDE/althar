import { useQueries, useQuery } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'

import type { ConnectionList, ProjectSummary } from '@althar/contracts'
import type { ProjectInk } from '@althar/ui'
import type { NewProjectFinding, NewProjectFolder, NewProjectFound, NewProjectSuggestion } from '@althar/ui/screens'

import { reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { useFound } from '../../shared/found'
import { contractInk, kitInk } from '../../shared/inks'
import { productBrand } from '../../shared/products'
import { changesOn, codeHostOf, remoteOf } from '../../shared/remotes'
import { type Draft, type DraftFolder, draftActions, draftsOf, inkOf } from './draft'

/*
 * A new project's view model: the draft its tab holds, and what the page
 * shows of it. Its folders as read, each with where its code is hosted;
 * the repositories main found, those named like the project first, each
 * saying the project it is in already; and what reading the folders found:
 * the code hosts they are on, connected as whom or not, and any in another
 * project.
 */

/** How many found repositories show before the rest are asked for. */
const FIRST = 4

export interface NewProjectModel {
  /** Null once it is made or closed. */
  readonly draft: Draft | null
  /** Its mark's ink: the person's, or the runtime's pick, shown. */
  readonly ink: ProjectInk
  /** Which project has each ink. */
  readonly taken: Partial<Record<ProjectInk, string>>
  readonly folders: ReadonlyArray<NewProjectFolder>
  /** What this Mac has to add; null while main still looks. */
  readonly found: NewProjectFound | null
  readonly findings: ReadonlyArray<NewProjectFinding>
  readonly rename: (name: string) => void
  readonly colour: (ink: ProjectInk) => void
  readonly choose: () => Promise<void>
  readonly drop: (files: ReadonlyArray<File>) => Promise<void>
  readonly add: (id: string) => Promise<void>
  readonly leaveOut: (path: string) => void
  /** Makes the project; it, or null when it couldn't. */
  readonly create: () => Promise<ProjectSummary | null>
}

/** The words a project's name is known by, to find repositories named like it: northwind, in Northwind Ops. */
const wordsOf = (name: string) =>
  name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3)

/** A repository named like the project: by its own name, or the folder it is in, as ~/code/northwind/app is. */
const namedLike = (words: ReadonlyArray<string>, repository: { readonly name: string; readonly where: string }) => {
  const parent = repository.where.split('/').at(-2) ?? ''
  return words.some((word) => repository.name.toLowerCase().includes(word) || parent.toLowerCase().includes(word))
}

/** A folder as the page shows it: its host's name and mark, and its remote as the host names it. */
const folderOf = (folder: DraftFolder, list: ConnectionList | null): NewProjectFolder => {
  const ref = folder.remote === null ? null : remoteOf(folder.remote)
  const host = ref === null ? null : codeHostOf(ref, list)
  return {
    id: folder.path,
    name: folder.name,
    where: folder.where,
    host: host === null ? null : { name: host.name, ...(host.product === null ? {} : { brand: productBrand(host.product) }) },
    remote: ref?.path ?? null,
  }
}

/**
 * What reading the folders found: for each code host they are on, whose
 * repositories they are and as whom Althar is connected there, or that it
 * isn't; and each folder in another project already. Hosts are said once
 * the connections are read.
 */
const findingsOf = (
  folders: ReadonlyArray<DraftFolder>,
  list: ConnectionList | null,
  inProject: (folder: DraftFolder) => string | null,
) => {
  const findings: Array<NewProjectFinding> = []
  if (list !== null) {
    const byHost = new Map<string, Array<{ readonly path: string }>>()
    for (const folder of folders) {
      const ref = folder.remote === null ? null : remoteOf(folder.remote)
      if (ref !== null) byHost.set(ref.host, [...(byHost.get(ref.host) ?? []), ref])
    }
    for (const [host, remotes] of byHost) {
      const [first] = remotes
      if (first === undefined) continue
      const on = codeHostOf({ host, path: first.path }, list)
      // A host Althar has no product for is only named in its folders' rows.
      if (on.product === null) continue
      const shown = { name: on.name, brand: productBrand(on.product) }
      findings.push(
        on.account === null
          ? { id: host, kind: 'unconnected', host: shown, remote: first.path, changes: changesOn(on.product) }
          : {
              id: host,
              kind: 'connected',
              host: shown,
              owners: [...new Set(remotes.map((remote) => remote.path.split('/')[0] ?? remote.path))],
              account: on.account,
            },
      )
    }
  }
  for (const folder of folders) {
    const project = inProject(folder)
    if (project !== null) findings.push({ id: `in-${folder.path}`, kind: 'shared', name: folder.name, project })
  }
  return findings
}

export const useNewProject = (): NewProjectModel => {
  const services = useServices()
  const { client } = services
  const store = draftsOf(client)
  const actions = draftActions(services)
  const draft = useSyncExternalStore(store.subscribe, store.get)
  const read = reads(client)
  const projects = useQuery(read.projects()).data?.projects ?? []
  // Each project's repositories, to say where one on this Mac is in a project already.
  const repositories = useQueries({ queries: projects.map((project) => read.repositories(project.id)) })
  const list = useQuery(read.connections()).data ?? null
  const found = useFound()

  // Every project's repository on this Mac, by its root, with the project's name.
  const roots = projects.flatMap((project, index) =>
    (repositories[index]?.data ?? []).flatMap((repository) =>
      repository.path === null ? [] : [{ path: repository.path, project: project.name }],
    ),
  )
  /** The project a repository found is in, by where main says it is: ~/code/app is any root ending in /code/app. */
  const projectAt = (where: string) => {
    const tail = where.startsWith('~/') ? where.slice(1) : where
    return roots.find((root) => root.path === where || root.path.endsWith(tail))?.project
  }
  const inProject = (folder: DraftFolder) => folder.project ?? roots.find((root) => root.path === folder.path)?.project ?? null

  const taken: Partial<Record<ProjectInk, string>> = {}
  for (const project of projects) taken[kitInk(project.ink)] ??= project.name

  const folders: ReadonlyArray<NewProjectFolder> =
    draft === null
      ? []
      : [
          ...draft.folders.map((folder) => folderOf(folder, list)),
          ...draft.reading.map((reading): NewProjectFolder => ({
            id: reading.key,
            reading: true,
            ...(reading.name === undefined ? {} : { name: reading.name }),
          })),
        ]

  const offered = (() => {
    if (draft === null) return null
    if (found.isError) return { like: null, first: [], more: [] }
    if (found.data === undefined) return null
    // What is added, or being read, isn't offered again: by main's id, or by where it is, for one chosen by the picker.
    const taking = [...draft.folders, ...draft.reading]
    const ids = new Set(taking.flatMap((one) => one.found ?? []))
    const here = new Set(taking.flatMap((one) => one.where ?? []))
    const left = found.data.repositories.filter((repository) => !ids.has(repository.id) && !here.has(repository.where))
    const words = wordsOf(draft.name)
    const like = left.filter((repository) => namedLike(words, repository))
    const first = (like.length > 0 ? like : left).slice(0, FIRST)
    const suggestion = (repository: (typeof left)[number]): NewProjectSuggestion => {
      const project = projectAt(repository.where)
      return {
        id: repository.id,
        name: repository.name,
        where: repository.where,
        ...(project === undefined ? {} : { in: project }),
      }
    }
    return {
      like: like.length > 0 ? draft.name.trim() : null,
      first: first.map(suggestion),
      more: left.filter((repository) => !first.includes(repository)).map(suggestion),
    }
  })()

  const ink = draft === null ? kitInk('clay') : kitInk(inkOf(draft, projects))
  return {
    draft,
    ink,
    taken,
    folders,
    found: offered,
    findings: draft === null ? [] : findingsOf(draft.folders, list, inProject),
    rename: (name) => {
      if (draft !== null) store.change(draft.id, (now) => ({ ...now, name }))
    },
    colour: (chosen) => {
      if (draft !== null) store.change(draft.id, (now) => ({ ...now, ink: contractInk(chosen) }))
    },
    choose: actions.choose,
    drop: actions.drop,
    add: (id) => {
      const repository = found.data?.repositories.find((one) => one.id === id)
      return repository === undefined ? Promise.resolve() : actions.addFound(id, { name: repository.name, where: repository.where })
    },
    leaveOut: (path) => {
      if (draft !== null) store.change(draft.id, (now) => ({ ...now, folders: now.folders.filter((folder) => folder.path !== path) }))
    },
    create: () => (draft === null ? Promise.resolve(null) : actions.create(inkOf(draft, projects))),
  }
}
