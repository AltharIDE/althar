import type { ProjectSummary } from '@althar/contracts'
import { type ProjectTab, Room } from '@althar/ui'

import { refOf } from '../home/glance'
import { isSection, type Section } from '../settings/sections'

/*
 * The window's tabs, worked out: which projects have one, where in each the
 * person last was, and which has the window, from where the window is. The
 * home has the first tab; Althar's settings have one beside it while they
 * are open, kept on the section they were last on; every other place
 * belongs to a project. A task's address names only its thread, so its
 * project is learnt when the task is read.
 */

/** Where in a project its tab was last: the project, on the view it was last on, or one of its tasks. */
export type Place = { readonly kind: 'project' } | { readonly kind: 'thread'; readonly threadId: string }

/** Where the window is, as the tabs see it: a new project has a tab of its own, and so do the settings. */
export type Where =
  | { readonly kind: 'home' }
  | { readonly kind: 'new' }
  | { readonly kind: 'settings'; readonly section: Section }
  | { readonly kind: 'project'; readonly projectId: string; readonly place: Place }
  | { readonly kind: 'thread'; readonly threadId: string }

/** What a window keeps between launches: its projects' tabs in order, where in each it was, the view each was last on, and the settings' tab. */
export interface Kept {
  readonly open: ReadonlyArray<string>
  readonly places: Readonly<Record<string, Place>>
  readonly rooms?: Readonly<Record<string, Room>>
  /** The settings have a tab, on this section; none while they are closed. */
  readonly settings?: Section
}

/** Where the window is, from its address. */
export const whereOf = (pathname: string): Where => {
  const project = /^\/projects\/([^/]+)\/?$/.exec(pathname)
  if (project?.[1] !== undefined) return { kind: 'project', projectId: decodeURIComponent(project[1]), place: { kind: 'project' } }
  const thread = /^\/threads\/([^/]+)\/?$/.exec(pathname)
  if (thread?.[1] !== undefined) return { kind: 'thread', threadId: decodeURIComponent(thread[1]) }
  if (/^\/new\/?$/.test(pathname)) return { kind: 'new' }
  // A section the settings don't have is their first.
  const settings = /^\/settings\/([^/]+)\/?$/.exec(pathname)
  if (settings?.[1] !== undefined) {
    const section = decodeURIComponent(settings[1])
    return { kind: 'settings', section: isSection(section) ? section : 'agents' }
  }
  return { kind: 'home' }
}

/** What waits on the person in a project, as its board counts it: its calls, and its tasks ready for them. */
export const yoursIn = (project: ProjectSummary): number => project.waiting + project.ready

/**
 * The tabs a window opens with before it has kept any: the projects where
 * work runs or something waits on the person, else the one worked in last.
 */
export const firstOpen = (projects: ReadonlyArray<ProjectSummary>): ReadonlyArray<string> => {
  const busy = projects.filter((project) => project.working > 0 || yoursIn(project) > 0)
  if (busy.length > 0) return busy.map((project) => project.id)
  const [last] = projects
    .filter((project) => project.lastWorkAt !== null)
    .toSorted((a, b) => (b.lastWorkAt ?? '').localeCompare(a.lastWorkAt ?? ''))
  return last === undefined ? [] : [last.id]
}

/** Which tab has the window once one closes: the one after it, else the one before, else the home. */
export const afterClosing = (open: ReadonlyArray<string>, id: string): string | null => {
  const at = open.indexOf(id)
  const rest = open.filter((other) => other !== id)
  return rest[Math.min(Math.max(at, 0), rest.length - 1)] ?? null
}

/** The tab ⌘ and a number goes to: 1 is the home, 2 to 8 the projects in order, 9 the last; undefined where there's none. */
export const byNumber = (open: ReadonlyArray<string>, n: number): string | null | undefined => {
  if (n === 1) return null
  if (n === 9) return open.at(-1)
  return open[n - 2]
}

/** The tab before or after the one with the window, round the ends, the home among them. */
export const beside = (open: ReadonlyArray<string>, current: string | null, step: 1 | -1): string | null => {
  const all = [null, ...open]
  const at = all.indexOf(current)
  return all[(at + step + all.length) % all.length] ?? null
}

/** A project as its tab shows it: its mark, its name, whether a task is under way, and what waits on the person. */
export const tabOf = (project: ProjectSummary): ProjectTab => {
  const { seed, ink, name } = refOf(project)
  return { id: project.id, name, seed, ink, running: project.working > 0, yours: yoursIn(project) }
}

const isRoom = (value: unknown): value is Room => Object.values(Room).some((room) => room === value)

const isPlace = (value: unknown): value is Place => {
  if (typeof value !== 'object' || value === null || !('kind' in value)) return false
  // A project's rules and repositories were places of their own before they were sections of its settings: the project now.
  if (value.kind === 'project') return true
  return value.kind === 'thread' && 'threadId' in value && typeof value.threadId === 'string'
}

/** What storage kept, as far as it reads; nothing where it doesn't. */
export const keptFrom = (raw: string | null): Kept | null => {
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || !('open' in parsed) || !Array.isArray(parsed.open)) return null
    const open = parsed.open.filter((id): id is string => typeof id === 'string')
    const places: Record<string, Place> = {}
    if ('places' in parsed && typeof parsed.places === 'object' && parsed.places !== null)
      for (const [id, place] of Object.entries(parsed.places)) if (isPlace(place)) places[id] = place
    const rooms: Record<string, Room> = {}
    if ('rooms' in parsed && typeof parsed.rooms === 'object' && parsed.rooms !== null)
      for (const [id, room] of Object.entries(parsed.rooms)) if (isRoom(room)) rooms[id] = room
    const settings = 'settings' in parsed && isSection(parsed.settings) ? { settings: parsed.settings } : {}
    return { open, places, ...(Object.keys(rooms).length === 0 ? {} : { rooms }), ...settings }
  } catch {
    return null
  }
}
