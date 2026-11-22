import type { BoardSnapshot, ProjectSummary, ThreadItem } from '@althar/contracts'
import { Brand, type HostedRepository, ProjectInk, type RepositoryChoice, type SetupHost } from '@althar/ui'

import type { HomesHost, HomesOverview, HomeState, RemoteHome } from '../../src/homes'
import { lab } from './state'

/*
 * The lab's world: the home the window is on (runner-1, a Linux server with
 * no projects yet, or this Mac with one), the repositories on the code hosts
 * this Mac is connected to, what is found on the home's disk, and the agents
 * there. Making a project is a job the home runs, step by step, each said as
 * it goes, the clone with how much has come; at its end the project is
 * there, and every read of the runtime says so.
 */

export const RUNNER: RemoteHome = { id: 'home_runner', name: 'runner-1', homeId: 'h_runner1', ssh: { target: 'althar@runner-1' } }

export interface Home {
  readonly remote: boolean
  /** As the window's chip names it. */
  readonly name: string
  /** Where clones and new repositories go there. */
  readonly place: string
  /** What it is, in a few words. */
  readonly what: string
}

export const HOME: Home =
  lab.get().home === 'mac'
    ? { remote: false, name: 'this Mac', place: '~/Code', what: 'macOS 26' }
    : { remote: true, name: 'runner-1', place: '~/code', what: 'Ubuntu 24.04 · 8 cores · 212 GB free' }

/** "on runner-1", "on this Mac". */
export const on = `on ${HOME.name}`
export const On = `On ${HOME.name}`

export const ACCOUNT = 'balazs'

export const HOSTS: readonly SetupHost[] = [
  { id: 'github', name: 'GitHub', brand: Brand.GitHub, thing: 'repository', connected: true, how: 'In the browser' },
  { id: 'gitlab', name: 'GitLab', brand: Brand.GitLab, thing: 'project', connected: false, how: 'In the browser' },
]

interface Repo extends HostedRepository {
  /** What it weighs, in MB, for the clone's progress. */
  readonly size: number
  /** What reading it finds. */
  readonly reads: string
  readonly ink: ProjectInk
}

const repo = (
  owner: string,
  name: string,
  facts: { private?: boolean; pushed: string; description?: string; size?: number; reads?: string; ink?: ProjectInk },
): Repo => ({
  id: `github:${owner}/${name}`,
  host: 'github',
  owner,
  name,
  description: facts.description ?? null,
  private: facts.private ?? true,
  pushed: facts.pushed,
  like: false,
  here: null,
  size: facts.size ?? 24,
  reads: facts.reads ?? 'Node, with npm',
  ink: facts.ink ?? ProjectInk.Teal,
})

export const REPOS: readonly Repo[] = [
  repo('AltharIDE', 'althar', {
    pushed: '2 hours ago',
    description: 'Agents at work on your code, in parallel',
    size: 66,
    reads: 'A Bun workspace of 11 packages, with Rust in two',
    ink: ProjectInk.Clay,
  }),
  repo('northwind-co', 'app', {
    pushed: 'today',
    description: 'Northwind’s web app',
    size: 38,
    reads: 'Next.js, with pnpm',
    ink: ProjectInk.Indigo,
  }),
  repo('northwind-co', 'api', { pushed: 'yesterday', size: 21, reads: 'Go 1.23, with a Makefile', ink: ProjectInk.Moss }),
  repo('AltharIDE', 'althar-mobile', { pushed: 'yesterday', size: 44, reads: 'Expo, with Bun', ink: ProjectInk.Plum }),
  repo('northwind-co', 'infra', { pushed: '3 days ago', size: 6, reads: 'Terraform and a few shell scripts', ink: ProjectInk.Slate }),
  repo('AltharIDE', 'site', { private: false, pushed: '4 days ago', size: 18, reads: 'Astro, with Bun', ink: ProjectInk.Ochre }),
  repo('northwind-co', 'design-system', { private: false, pushed: 'last week', size: 12, ink: ProjectInk.Rose }),
  repo('balazs', 'dotfiles', { private: false, pushed: 'last month', size: 1, reads: 'Shell scripts', ink: ProjectInk.Umber }),
  repo('balazs', 'notes', { pushed: '2 months ago', size: 2, reads: 'Markdown', ink: ProjectInk.Sand }),
]

/** A repository a pasted URL names, read from it. */
export const pastedOf = (typed: string): Repo | null => {
  const found = /(?:github\.com[/:])?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(typed.trim())
  if (found === null || !typed.includes('/') || !/github\.com|^[\w.-]+\/[\w.-]+$/.test(typed.trim())) return null
  const [, owner = '', name = ''] = found
  return REPOS.find((one) => one.owner === owner && one.name === name) ?? repo(owner, name, { pushed: '', private: false })
}

/** A folder found on the home's disk: a repository, or a folder git could start in. */
export interface Found extends RepositoryChoice {
  readonly git: 'ready' | 'none'
  readonly remote: string | null
  readonly reads: string
  readonly ink: ProjectInk
}

export const FOUND: readonly Found[] = HOME.remote
  ? [
      {
        id: 'found:legacy-billing',
        name: 'legacy-billing',
        where: '~/code/legacy-billing',
        facts: 'main · northwind-co/legacy-billing',
        git: 'ready',
        remote: 'northwind-co/legacy-billing',
        reads: 'Ruby 3.3, with Bundler',
        ink: ProjectInk.Brick,
      },
      {
        id: 'found:deploy-scripts',
        name: 'deploy-scripts',
        where: '/srv/tools/deploy-scripts',
        facts: 'main · no remote',
        git: 'ready',
        remote: null,
        reads: 'Shell scripts',
        ink: ProjectInk.Olive,
      },
      {
        id: 'found:scratch',
        name: 'scratch',
        where: '~/scratch',
        facts: 'No git yet',
        git: 'none',
        remote: null,
        reads: 'A few Python files',
        ink: ProjectInk.Sand,
      },
    ]
  : [
      {
        id: 'found:althar-mobile',
        name: 'althar-mobile',
        where: '~/Code/althar-mobile',
        facts: 'main · 2 days ago',
        git: 'ready',
        remote: 'AltharIDE/althar-mobile',
        reads: 'Expo, with Bun',
        ink: ProjectInk.Plum,
      },
      {
        id: 'found:site',
        name: 'site',
        where: '~/Code/site',
        facts: 'main · last week',
        git: 'ready',
        remote: 'AltharIDE/site',
        reads: 'Astro, with Bun',
        ink: ProjectInk.Ochre,
      },
    ]

/** The agents on the home, as it reads them. */
export const AGENTS = [
  { id: 'claude-code', name: 'Claude Code', state: 'ready' as const, note: 'Signed in' },
  { id: 'codex', name: 'Codex', state: 'out' as const, note: 'Signed out' },
]

/*
 * Yours, and the home's. Your settings (models, presets, how tasks and pull
 * requests go, skills, which MCP servers) are the person's, not a machine's:
 * kept in step on every home, as they would be from an account once there is
 * a cloud. What a home has of its own is what can't travel: a sign-in made
 * there (never a copy of this Mac's), a tool installed there.
 */

/** Your settings, as every home has them. */
export const YOURS = { presets: 4, skills: 3, servers: 5 }

export type NeedKey = 'github' | 'claude-code' | 'codex' | 'docker'
export interface Need {
  readonly key: NeedKey
  readonly name: string
  readonly brand: Brand | null
  readonly state: 'there' | 'missing' | 'doing'
  /** Said beside it: how it is there, or what it's for. */
  readonly note: string
  /** What fixing it does, said while it does. */
  readonly doing: string
  /** The fix, as its button says. */
  readonly fix: string
  /** Work goes on without it until something asks for it. */
  readonly optional: boolean
}

const needState: Record<NeedKey, Need['state']> = {
  github: HOME.remote ? 'missing' : 'there',
  'claude-code': 'there',
  codex: HOME.remote ? 'missing' : 'there',
  docker: HOME.remote ? 'missing' : 'there',
}

/** Where a project's code comes from. */
export type Source =
  | { readonly kind: 'clone'; readonly repo: Repo }
  | { readonly kind: 'folder'; readonly folder: Found }
  | { readonly kind: 'new'; readonly name: string }

export const slugOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'project'

/** Where it is, or will be, on the home. */
export const whereOf = (source: Source) =>
  source.kind === 'clone'
    ? `${HOME.place}/${source.repo.name}`
    : source.kind === 'folder'
      ? source.folder.where
      : `${HOME.place}/${slugOf(source.name)}`

/** What the project would be called, from where its code comes. */
export const nameOf = (source: Source) =>
  source.kind === 'clone' ? source.repo.name : source.kind === 'folder' ? source.folder.name : source.name

export const inkOfSource = (source: Source): ProjectInk =>
  source.kind === 'clone' ? source.repo.ink : source.kind === 'folder' ? source.folder.ink : ProjectInk.Teal

/* ---- The world's projects, and what changes them ---- */

const opened = Date.now()
export const minutesAgo = (minutes: number) => new Date(opened - minutes * 60_000).toISOString()

const projectOf = (id: string, name: string, ink: ProjectInk, where: string): ProjectSummary => ({
  id,
  name,
  slug: slugOf(name),
  ink,
  lastWorkAt: null,
  repository: where,
  repositories: [where.split('/').at(-1) ?? name],
  worktrees: null,
  tasks: 0,
  running: 0,
  yours: 0,
  working: 0,
  usageLimit: 'move',
  rotateAccounts: false,
  onlyAccounts: null,
  coordinatorThreadId: `thc_${id}`,
})

const projects: ProjectSummary[] = HOME.remote ? [] : [projectOf('p_meridian', 'meridian', ProjectInk.Teal, '~/Code/meridian')]
/** Each project's coordinator conversation, by project, as it grows. */
const said = new Map<string, ThreadItem[]>()
/** Whose coordinator is at work now. */
const working = new Set<string>()
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((listener) => listener())

const needOf = (key: NeedKey): Need => {
  const state = needState[key]
  const there = state === 'there'
  switch (key) {
    case 'github':
      return {
        key,
        name: 'GitHub',
        brand: Brand.GitHub,
        state,
        note: there ? `Signed in as ${ACCOUNT}` : 'To clone, push and open pull requests',
        doing: 'Approve it in your browser on this Mac',
        fix: 'Sign in',
        optional: false,
      }
    case 'claude-code':
      return {
        key,
        name: 'Claude Code',
        brand: Brand.ClaudeCode,
        state,
        note: there ? 'Signed in, Max' : 'For the coordinator and its tasks',
        doing: 'Approve it in your browser on this Mac',
        fix: 'Sign in',
        optional: false,
      }
    case 'codex':
      return {
        key,
        name: 'Codex',
        brand: Brand.Codex,
        state,
        note: there ? 'Signed in, Pro' : 'For tasks that pick it',
        doing: 'Approve it in your browser on this Mac',
        fix: 'Sign in',
        optional: true,
      }
    case 'docker':
      return {
        key,
        name: 'Docker',
        brand: null,
        state,
        note: there ? 'For your postgres MCP server' : 'Your postgres MCP server needs it',
        doing: `Installing it ${on}`,
        fix: 'Install',
        optional: true,
      }
  }
}

/** Saves the state of what the home has, and says so. */
const setNeed = (key: NeedKey, state: Need['state']) => {
  needState[key] = state
  changed()
}

export const world = {
  projects: () => projects,
  project: (id: string) => projects.find((one) => one.id === id),
  said: (projectId: string) => said.get(projectId) ?? [],
  working: (projectId: string) => working.has(projectId),
  /** Whether the home has GitHub, signed in there: this Mac does; runner-1 doesn't yet. */
  githubThere: () => needState.github === 'there',
  /** What the home has of what work needs, in the order it's said. */
  needs: (): readonly Need[] => (['github', 'claude-code', 'codex', 'docker'] as const).map(needOf),
  need: needOf,
  /** Signs in, or installs, on the home: a sign-in approved in this Mac's browser, as a device code is. */
  fix: async (key: NeedKey) => {
    if (needState[key] !== 'missing') return
    setNeed(key, 'doing')
    await new Promise((done) => setTimeout(done, key === 'docker' ? 2400 : 1500))
    setNeed(key, 'there')
  },
  board: (projectId: string): BoardSnapshot => ({ cursor: Date.now(), tasks: [], calls: [], settledTotal: projectId === '' ? 0 : 0 }),
  /** A project there, now, with its code on its way. */
  add: (id: string, name: string, ink: ProjectInk, where: string) => {
    const made = projectOf(id, name, ink, where)
    if (!projects.some((one) => one.id === id)) projects.push(made)
    changed()
    return made
  },
  rename: (id: string, name: string) => {
    const at = projects.findIndex((one) => one.id === id)
    const was = projects[at]
    if (was !== undefined) projects[at] = { ...was, name, slug: slugOf(name) }
    changed()
  },
  say: (projectId: string, item: ThreadItem) => {
    said.set(projectId, [...(said.get(projectId) ?? []), item])
    changed()
  },
  /** Changes a line already said, as a command running ends. */
  resay: (projectId: string, id: string, next: (item: ThreadItem) => ThreadItem) => {
    said.set(
      projectId,
      (said.get(projectId) ?? []).map((item) => (item.id === id ? next(item) : item)),
    )
    changed()
  },
  work: (projectId: string, on: boolean) => {
    if (on) working.add(projectId)
    else working.delete(projectId)
    changed()
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => void listeners.delete(listener)
  },
}

/* ---- Making a project on the home: a job of steps ---- */

export type StepState = 'waiting' | 'doing' | 'done' | 'failed'
export interface JobStep {
  readonly key: string
  readonly label: string
  readonly state: StepState
  /** What it ran or found, said under it. */
  readonly detail?: string
}
export interface Job {
  readonly steps: readonly JobStep[]
  /** The clone, as it comes: MB received of all. */
  readonly progress: { readonly done: number; readonly total: number } | null
  readonly phase: 'running' | 'failed' | 'done'
  readonly problem: string | null
  readonly project: ProjectSummary | null
}

export interface JobHandle {
  readonly get: () => Job
  readonly subscribe: (listener: () => void) => () => void
  readonly retry: () => void
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))
let failsLeft = lab.get().fail ? 1 : 0

/**
 * Makes a project on the home as its runtime would: GitHub signed in there
 * where a private clone needs it, the clone with how much has come, git
 * started where a folder has none, its code read, then the project itself.
 * `early`: the project is there from the first press, and its code follows.
 */
export const makeOnHome = (plan: { id: string; name: string; ink: ProjectInk; source: Source; early?: boolean }): JobHandle => {
  const { source } = plan
  const where = whereOf(source)
  const steps: JobStep[] = [
    ...(source.kind === 'clone' && source.repo.private && !world.githubThere()
      ? [{ key: 'github', label: `Sign GitHub in ${on}`, state: 'waiting' as const, detail: `As ${ACCOUNT}, from this Mac` }]
      : []),
    source.kind === 'clone'
      ? { key: 'code', label: `Clone ${source.repo.owner}/${source.repo.name}`, state: 'waiting' as const, detail: `Into ${where}` }
      : source.kind === 'folder'
        ? {
            key: 'code',
            label: source.folder.git === 'none' ? `Start git in ${source.folder.name}` : `Open ${source.folder.name}`,
            state: 'waiting' as const,
            detail: source.folder.git === 'none' ? 'On main, with what’s in it as the first commit' : where,
          }
        : {
            key: 'code',
            label: `Make ${slugOf(source.name)}`,
            state: 'waiting' as const,
            detail: `A new repository in ${HOME.place}, on main`,
          },
    { key: 'read', label: 'Read it', state: 'waiting' as const },
    { key: 'make', label: `Make ${plan.name}`, state: 'waiting' as const },
  ]
  let job: Job = { steps, progress: null, phase: 'running', problem: null, project: null }
  const listeners = new Set<() => void>()
  const set = (next: Partial<Job>) => {
    job = { ...job, ...next }
    listeners.forEach((listener) => listener())
  }
  const step = (key: string, state: StepState, detail?: string) =>
    set({ steps: job.steps.map((one) => (one.key === key ? { ...one, state, ...(detail === undefined ? {} : { detail }) } : one)) })

  const run = async () => {
    set({ phase: 'running', problem: null })
    if (plan.early === true && job.project === null) set({ project: world.add(plan.id, plan.name, plan.ink, where) })
    for (const one of job.steps) {
      if (one.state === 'done') continue
      step(one.key, 'doing')
      if (one.key === 'github') {
        await wait(900)
        setNeed('github', 'there')
      } else if (one.key === 'code' && source.kind === 'clone') {
        const total = source.repo.size
        const from = job.progress?.done ?? 0
        for (let at = from; at <= total; at += Math.max(1, Math.round(total / 22))) {
          set({ progress: { done: Math.min(at, total), total } })
          if (failsLeft > 0 && at >= total * 0.4) {
            failsLeft -= 1
            step(one.key, 'failed')
            set({
              phase: 'failed',
              problem: `${HOME.name} lost its connection to github.com at ${Math.round((at / total) * 100)}%.`,
              progress: null,
            })
            return
          }
          await wait(130)
        }
        set({ progress: { done: total, total } })
      } else if (one.key === 'read') {
        await wait(800)
        step(
          one.key,
          'done',
          source.kind === 'clone' ? source.repo.reads : source.kind === 'folder' ? source.folder.reads : 'Empty, on main',
        )
        continue
      } else if (one.key === 'make') {
        await wait(450)
        set({ project: job.project ?? world.add(plan.id, plan.name, plan.ink, where) })
      } else await wait(900)
      step(one.key, 'done')
    }
    set({ phase: 'done' })
  }
  void run()
  return {
    get: () => job,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    retry: () => void run(),
  }
}

/* ---- The home, as the window's main process tells it ---- */

const homeListeners = new Set<(state: HomeState) => void>()
const overviewListeners = new Set<(overview: HomesOverview) => void>()
const state = (): HomeState =>
  HOME.remote ? { current: { kind: 'ssh', home: RUNNER }, connection: 'connected' } : { current: { kind: 'local' }, connection: 'local' }
const shelf = (list: readonly ProjectSummary[]) => ({
  live: true,
  list: list.map((one) => ({ id: one.id, name: one.name, ink: one.ink, working: 0, yours: 0 })),
})
const overview = (): HomesOverview => ({
  homes: [RUNNER],
  windows: HOME.remote ? { local: 'local', [RUNNER.homeId]: 'connected' } : { local: 'local' },
  projects: HOME.remote
    ? { local: shelf([projectOf('p_meridian', 'meridian', ProjectInk.Teal, '~/Code/meridian')]), [RUNNER.homeId]: shelf(projects) }
    : { local: shelf(projects), [RUNNER.homeId]: shelf([]) },
  opened: { [RUNNER.id]: opened - 60_000 },
})
world.subscribe(() => {
  const now = overview()
  overviewListeners.forEach((listener) => listener(now))
})

/** What a project's press in Manage homes or the chip's menu opens on, here. */
let openProject: (projectId: string) => void = () => undefined
export const onOpenProject = (open: (projectId: string) => void) => {
  openProject = open
}

const nothing = async () => undefined
export const homesHost: HomesHost = {
  state: async () => state(),
  list: async () => [RUNNER],
  overview: async () => overview(),
  inspect: async () => {
    throw new Error('Not in the lab.')
  },
  connect: nothing,
  save: nothing,
  open: async (id, projectId) => {
    if (projectId !== undefined && (id === 'local') !== HOME.remote) openProject(projectId)
  },
  rename: nothing,
  change: nothing,
  forget: nothing,
  restore: nothing,
  cancelCheck: nothing,
  reconnect: nothing,
  report: () => undefined,
  onState: (listener) => {
    homeListeners.add(listener)
    return () => void homeListeners.delete(listener)
  },
  onOverview: (listener) => {
    overviewListeners.add(listener)
    return () => void overviewListeners.delete(listener)
  },
  onOpen: () => () => undefined,
  onProject: () => () => undefined,
}
