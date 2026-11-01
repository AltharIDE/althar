// Scrappy: what the page shows, in one small store the switcher and the view read.
import { useSyncExternalStore } from 'react'

export type Direction = 'A' | 'B' | 'C'
export type Which = 'althar' | 'meridian'
/** Whether a lead has recorded the setups yet. */
export type Moment = 'recorded' | 'none'

export interface Repo {
  readonly id: string
  readonly name: string
  /** The person's checkout, where its files are copied from. */
  readonly checkout: string
  /** What it runs, in order, and what it copies from the person's checkout; null before a lead records them. */
  readonly commands: ReadonlyArray<string> | null
  readonly copy: ReadonlyArray<string> | null
}

const ALTHAR: ReadonlyArray<Repo> = [
  {
    id: 'repo_althar',
    name: 'althar',
    checkout: '~/Projects/charrette-project/althar',
    commands: ['bun install --frozen-lockfile', 'node apps/desktop/node_modules/electron/install.js', 'bunx playwright install chromium'],
    copy: ['.claude/settings.local.json'],
  },
]

const MERIDIAN: ReadonlyArray<Repo> = [
  {
    id: 'repo_api',
    name: 'meridian-api',
    checkout: '~/code/meridian-api',
    commands: ['pnpm install --frozen-lockfile', 'pnpm prisma generate'],
    copy: ['.env', '.env.local', 'config/local.yml'],
  },
  {
    id: 'repo_web',
    name: 'meridian-web',
    checkout: '~/code/meridian-web',
    commands: ['bun install --frozen-lockfile', 'bunx playwright install chromium webkit'],
    copy: ['.env.development.local'],
  },
  { id: 'repo_infra', name: 'meridian-infra', checkout: '~/code/meridian-infra', commands: [], copy: [] },
]

export interface State {
  readonly direction: Direction
  readonly which: Which
  readonly moment: Moment
  readonly repos: ReadonlyArray<Repo>
}

const reposOf = (which: Which, moment: Moment): ReadonlyArray<Repo> =>
  (which === 'althar' ? ALTHAR : MERIDIAN).map((one) => (moment === 'none' ? { ...one, commands: null, copy: null } : one))

let state: State = { direction: 'A', which: 'althar', moment: 'recorded', repos: reposOf('althar', 'recorded') }
const listeners = new Set<() => void>()

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
    for (const listener of listeners) listener()
  },
  /** The person's change to a repository's setup. */
  change: (id: string, change: Partial<Pick<Repo, 'commands' | 'copy'>>) => {
    state = { ...state, repos: state.repos.map((one) => (one.id !== id ? one : { ...one, ...change })) }
    for (const listener of listeners) listener()
  },
}

export const useProto = () => useSyncExternalStore(proto.subscribe, proto.get)
