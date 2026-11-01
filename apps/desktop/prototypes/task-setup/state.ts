// Scrappy: what the page shows, in one small store the switcher and the directions read.
import { useSyncExternalStore } from 'react'

export type Direction = 'A' | 'B' | 'C' | 'D'
export type Which = 'althar' | 'meridian'
/** Whether a lead has recorded the setups yet. */
export type Moment = 'recorded' | 'none'

/** How a step went the last time a task's folder was set up. */
export interface Last {
  readonly ok: boolean
  readonly seconds: number
  readonly code?: number
  /** The end of what it printed. */
  readonly tail?: ReadonlyArray<string>
}

/** One thing done to a new task's folder, named by the lead that recorded it. */
export interface Step {
  readonly id: string
  readonly name: string
  /** A command it runs, or the files it copies from the person's checkout. */
  readonly command?: string
  readonly copy?: ReadonlyArray<string>
  readonly on: boolean
  readonly last?: Last
}

export interface Repo {
  readonly id: string
  readonly name: string
  readonly steps: ReadonlyArray<Step> | null
  /** The task whose folder it last set up. */
  readonly lastIn?: { readonly title: string; readonly at: string }
}

const ALTHAR: ReadonlyArray<Repo> = [
  {
    id: 'repo_althar',
    name: 'althar',
    lastIn: { title: 'Diffs: syntax highlighting, like the code view', at: 'today' },
    steps: [
      { id: 'a1', name: 'Copy local settings', copy: ['.claude/settings.local.json'], on: true, last: { ok: true, seconds: 0.1 } },
      { id: 'a2', name: 'Install dependencies', command: 'bun install --frozen-lockfile', on: true, last: { ok: true, seconds: 14 } },
      {
        id: 'a3',
        name: 'Download Electron',
        command: 'node apps/desktop/node_modules/electron/install.js',
        on: true,
        last: { ok: true, seconds: 6 },
      },
      {
        id: 'a4',
        name: 'Install Playwright’s browsers',
        command: 'bunx playwright install chromium',
        on: true,
        last: { ok: true, seconds: 21 },
      },
    ],
  },
]

const MERIDIAN: ReadonlyArray<Repo> = [
  {
    id: 'repo_api',
    name: 'meridian-api',
    lastIn: { title: 'Retry checkout when the card is declined', at: '1 hour ago' },
    steps: [
      {
        id: 'm1',
        name: 'Copy secrets and local config',
        copy: ['.env', '.env.local', 'config/local.yml'],
        on: true,
        last: { ok: true, seconds: 0.1 },
      },
      { id: 'm2', name: 'Install dependencies', command: 'pnpm install --frozen-lockfile', on: true, last: { ok: true, seconds: 32 } },
      {
        id: 'm3',
        name: 'Generate the database client',
        command: 'pnpm prisma generate',
        on: true,
        last: {
          ok: false,
          seconds: 3,
          code: 1,
          tail: [
            'Prisma schema loaded from prisma/schema.prisma',
            'Error: Environment variable not found: DATABASE_URL.',
            '  -->  schema.prisma:7',
            '   | ',
            ' 6 |   provider = "postgresql"',
            ' 7 |   url      = env("DATABASE_URL")',
          ],
        },
      },
    ],
  },
  {
    id: 'repo_web',
    name: 'meridian-web',
    lastIn: { title: 'Retry checkout when the card is declined', at: '1 hour ago' },
    steps: [
      { id: 'w1', name: 'Copy local settings', copy: ['.env.development.local'], on: true, last: { ok: true, seconds: 0.1 } },
      { id: 'w2', name: 'Install dependencies', command: 'bun install --frozen-lockfile', on: true, last: { ok: true, seconds: 11 } },
      {
        id: 'w3',
        name: 'Install Playwright’s browsers',
        command: 'bunx playwright install chromium webkit',
        on: false,
      },
    ],
  },
  { id: 'repo_infra', name: 'meridian-infra', steps: [] },
]

export interface State {
  readonly direction: Direction
  readonly which: Which
  readonly moment: Moment
  readonly repos: ReadonlyArray<Repo>
}

const reposOf = (which: Which, moment: Moment): ReadonlyArray<Repo> =>
  (which === 'althar' ? ALTHAR : MERIDIAN).map((one) => (moment === 'none' ? { id: one.id, name: one.name, steps: null } : one))

let state: State = { direction: 'A', which: 'althar', moment: 'recorded', repos: reposOf('althar', 'recorded') }
const listeners = new Set<() => void>()
const tell = () => {
  for (const listener of listeners) listener()
}

let made = 0

export const proto = {
  get: () => state,
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  set: (next: Partial<Omit<State, 'repos'>>) => {
    const merged = { ...state, ...next }
    const fresh = next.which !== undefined || next.moment !== undefined
    state = { ...merged, repos: fresh ? reposOf(merged.which, merged.moment) : state.repos }
    tell()
  },
  /** The person's change to a repository's steps. */
  steps: (repo: string, change: (steps: ReadonlyArray<Step>) => ReadonlyArray<Step>) => {
    state = { ...state, repos: state.repos.map((one) => (one.id !== repo ? one : { ...one, steps: change(one.steps ?? []) })) }
    tell()
  },
  /** Puts the steps back as they were. */
  restore: (repo: string, steps: ReadonlyArray<Step> | null) => {
    state = { ...state, repos: state.repos.map((one) => (one.id !== repo ? one : { ...one, steps })) }
    tell()
  },
  id: () => `new${(made += 1)}`,
}

export const useProto = () => useSyncExternalStore(proto.subscribe, proto.get)

/** A step changed in place. */
export const changed = (id: string, change: Partial<Step>) => (steps: ReadonlyArray<Step>) =>
  steps.map((one) => (one.id === id ? { ...one, ...change } : one))

export const without = (id: string) => (steps: ReadonlyArray<Step>) => steps.filter((one) => one.id !== id)
