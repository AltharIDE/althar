// Scrappy: what the page shows, in one small store the switcher and the view read.
import { useSyncExternalStore } from 'react'

export type Which = 'althar' | 'meridian'
/** Whether a lead has recorded the setups yet. */
export type Moment = 'recorded' | 'none'

export interface Repo {
  readonly id: string
  readonly name: string
  /** What it runs, in order, and what it copies from the person's checkout; null before a lead records them. */
  readonly commands: ReadonlyArray<string> | null
  readonly copy: ReadonlyArray<string> | null
}

const ALTHAR: ReadonlyArray<Repo> = [
  {
    id: 'repo_althar',
    name: 'althar',
    commands: ['bun install --frozen-lockfile', 'node apps/desktop/node_modules/electron/install.js', 'bunx playwright install chromium'],
    copy: ['.claude/settings.local.json'],
  },
]

const MERIDIAN: ReadonlyArray<Repo> = [
  {
    id: 'repo_api',
    name: 'meridian-api',
    commands: ['pnpm install --frozen-lockfile', 'pnpm prisma generate'],
    copy: ['.env', '.env.local', 'config/local.yml'],
  },
  {
    id: 'repo_web',
    name: 'meridian-web',
    commands: ['bun install --frozen-lockfile', 'bunx playwright install chromium webkit'],
    copy: ['.env.development.local'],
  },
  { id: 'repo_infra', name: 'meridian-infra', commands: [], copy: [] },
]

export interface State {
  readonly which: Which
  readonly moment: Moment
  readonly repos: ReadonlyArray<Repo>
}

const reposOf = (which: Which, moment: Moment): ReadonlyArray<Repo> =>
  (which === 'althar' ? ALTHAR : MERIDIAN).map((one) => (moment === 'none' ? { ...one, commands: null, copy: null } : one))

let state: State = { which: 'althar', moment: 'recorded', repos: reposOf('althar', 'recorded') }
const listeners = new Set<() => void>()

export const proto = {
  get: () => state,
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  set: (next: Partial<Omit<State, 'repos'>>) => {
    const merged = { ...state, ...next }
    state = { ...merged, repos: reposOf(merged.which, merged.moment) }
    for (const listener of listeners) listener()
  },
  /** The person's change to a repository's setup. */
  change: (id: string, change: Partial<Pick<Repo, 'commands' | 'copy'>>) => {
    state = { ...state, repos: state.repos.map((one) => (one.id !== id ? one : { ...one, ...change })) }
    for (const listener of listeners) listener()
  },
}

export const useProto = () => useSyncExternalStore(proto.subscribe, proto.get)
