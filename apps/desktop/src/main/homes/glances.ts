import { constants, promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import { ProjectInk } from '@althar/contracts'
import { Schema } from 'effect'

import type { HomeProject, HomeProjects } from '../../homes'

/*
 * What Manage homes draws each home by, beside its settings: the projects a
 * window on it last read, and when each saved home was last opened. A window
 * reports its own home's projects as it reads them; while it is connected
 * they are live (with what runs there and what waits on the person), and once
 * it closes they stay as names and inks only, kept in home-glances.json for
 * the next launch. It is a display cache: an unreadable file is ignored and
 * written over, never a reason to refuse a home. No targets, identities'
 * secrets or credentials belong in it.
 */

const MAX_BYTES = 1024 * 1024
const MAX_REPORTED = 200
const MAX_KEPT = 60
const MAX_COUNT = 100_000
const WRITE_AFTER = 1_000

const controls = (value: string) => Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
const projectId = Schema.String.check(Schema.isMaxLength(128), Schema.isPattern(/^[A-Za-z0-9_-]+$/))
const projectName = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120))
const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(MAX_COUNT))
/** A repository's page on its code host, as a window says it: an https address with no sign-in in it, kept short. */
const remoteUrl = Schema.String.check(Schema.isMaxLength(400), Schema.isPattern(/^https:\/\/[^\s/@]+\/[^\s@]+$/))
const remote = Schema.Struct({ url: remoteUrl, product: Schema.NullOr(Schema.String.check(Schema.isMaxLength(40))) })
const reported = Schema.Struct({
  id: projectId,
  name: projectName,
  ink: ProjectInk,
  working: count,
  yours: count,
  remotes: Schema.optional(Schema.Array(remote).check(Schema.isMaxLength(8))),
})
const kept = Schema.Struct({ id: projectId, name: projectName, ink: ProjectInk })
const file = Schema.Struct({
  version: Schema.Literal(1),
  opened: Schema.Record(Schema.String, Schema.Number),
  projects: Schema.Record(Schema.String, Schema.Array(kept)),
})
type Kept = typeof kept.Type
const named = (one: { readonly name: string }) => one.name.trim() !== '' && !controls(one.name)

/** A window's report, as main takes it: bounded, each project's fields checked; anything else is refused whole. */
export const reportedProjects = (value: unknown): ReadonlyArray<HomeProject> => {
  if (!Array.isArray(value) || value.length > MAX_REPORTED) throw new Error('A window reported projects main can’t read.')
  const projects = Schema.decodeUnknownSync(Schema.Array(reported))(value)
  if (!projects.every(named)) throw new Error('A window reported projects main can’t read.')
  const ids = new Set<string>()
  return projects.filter((one) => !ids.has(one.id) && ids.add(one.id) !== undefined)
}

const keptOf = (projects: ReadonlyArray<HomeProject>): ReadonlyArray<Kept> =>
  projects.slice(0, MAX_KEPT).map(({ id, name, ink }) => ({ id, name, ink: ink as Kept['ink'] }))

export interface HomeGlancesOptions {
  readonly profile: string
  readonly now?: () => number
  /** Saved ids and home identities still wanted, by the store and the homes that can be put back: the rest is pruned as it's written. */
  readonly wanted?: () => Promise<{ readonly ids: ReadonlySet<string>; readonly keys: ReadonlySet<string> }>
  readonly changed?: () => void
  readonly writeAfter?: number
}

export const homeGlances = ({ profile, now = Date.now, wanted, changed = () => {}, writeAfter = WRITE_AFTER }: HomeGlancesOptions) => {
  const path = join(profile, 'home-glances.json')
  let opened: Record<string, number> = {}
  let projects: Record<string, ReadonlyArray<Kept>> = {}
  const reports = new Map<number, { readonly key: string; readonly projects: ReadonlyArray<HomeProject> }>()
  let written = ''
  let timer: ReturnType<typeof setTimeout> | undefined
  let writing: Promise<void> = Promise.resolve()

  const read = async () => {
    let handle
    try {
      handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    } catch {
      return
    }
    try {
      const stat = await handle.stat()
      if (
        !stat.isFile() ||
        stat.nlink !== 1 ||
        stat.size > MAX_BYTES ||
        (process.getuid !== undefined && stat.uid !== process.getuid()) ||
        (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)
      )
        return
      const bytes = Buffer.alloc(MAX_BYTES + 1)
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
      if (bytesRead > MAX_BYTES) return
      const parsed = Schema.decodeUnknownSync(file)(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, bytesRead))),
      )
      opened = Object.fromEntries(Object.entries(parsed.opened).filter(([, at]) => Number.isFinite(at) && at > 0))
      projects = Object.fromEntries(Object.entries(parsed.projects).map(([key, list]) => [key, list.filter(named).slice(0, MAX_KEPT)]))
      written = JSON.stringify({ opened, projects })
    } catch {
      // A cache that doesn't read is as good as none: it is written over.
    } finally {
      await handle.close().catch(() => undefined)
    }
  }
  const loaded = read().then(() => changed())

  const write = async () => {
    await loaded
    if (wanted !== undefined) {
      const still = await wanted().catch(() => undefined)
      if (still !== undefined) {
        opened = Object.fromEntries(Object.entries(opened).filter(([id]) => still.ids.has(id)))
        projects = Object.fromEntries(Object.entries(projects).filter(([key]) => key === 'local' || still.keys.has(key)))
      }
    }
    const contents = JSON.stringify({ opened, projects })
    if (contents === written) return
    const temporary = join(profile, `home-glances-${randomUUID()}.tmp`)
    try {
      await fs.mkdir(profile, { recursive: true, mode: 0o700 })
      const handle = await fs.open(temporary, 'wx', 0o600)
      try {
        await handle.writeFile(JSON.stringify({ version: 1, opened, projects }))
        await handle.sync()
      } finally {
        await handle.close()
      }
      await fs.rename(temporary, path)
      written = contents
    } catch {
      // Kept in memory for this run; the next change tries again.
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => undefined)
    }
  }
  const later = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      writing = writing.then(write)
    }, writeAfter)
  }
  const keep = (key: string, list: ReadonlyArray<HomeProject>) => {
    const next = keptOf(list)
    if (JSON.stringify(projects[key] ?? null) === JSON.stringify(next)) return
    projects = { ...projects, [key]: next }
    later()
  }

  return {
    loaded,
    /** A saved home's window opened, now. */
    opened: (id: string) => {
      opened = { ...opened, [id]: now() }
      later()
      changed()
    },
    openedAt: (): Readonly<Record<string, number>> => opened,
    report: (owner: number, key: string, list: ReadonlyArray<HomeProject>) => {
      const previous = reports.get(owner)
      reports.set(owner, { key, projects: list })
      keep(key, list)
      if (previous === undefined || previous.key !== key || JSON.stringify(previous.projects) !== JSON.stringify(list)) changed()
    },
    /** A window gone, or reading again from the start: what it reported isn't live any more. */
    drop: (owner: number) => {
      if (reports.delete(owner)) changed()
    },
    /** A home's projects: from a live window on it where `live` says one is, else as last kept, with nothing under way known. */
    projectsOf: (key: string, live: (owner: number) => boolean): HomeProjects | undefined => {
      for (const [owner, report] of reports) if (report.key === key && live(owner)) return { live: true, list: report.projects }
      const known = projects[key]
      return known === undefined ? undefined : { live: false, list: known.map((one) => ({ ...one, working: 0, yours: 0 })) }
    },
    keys: (): ReadonlyArray<string> => [...new Set([...Object.keys(projects), ...[...reports.values()].map((one) => one.key)])],
    /** Writes what waits, at once: for quitting, and for tests. */
    flush: async () => {
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
        writing = writing.then(write)
      }
      await writing
    },
  }
}
export type HomeGlances = ReturnType<typeof homeGlances>
