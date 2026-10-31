// Scrappy: what the page shows, in one small store the switcher and the directions read.
import { useSyncExternalStore } from 'react'

export type Direction = 'A' | 'B' | 'C'
export type Which = 'althar' | 'meridian'
/** Whether a lead has recorded the setups yet. */
export type Moment = 'recorded' | 'none'

export interface Setup {
  readonly copy: ReadonlyArray<string>
  readonly commands: ReadonlyArray<string>
  /** The task whose lead recorded it, or the person. */
  readonly by: { readonly title: string; readonly threadId: string } | null
  readonly at: string
}

export interface Repo {
  readonly id: string
  readonly name: string
  readonly checkout: string
  readonly setup: Setup | null
  /** How it went in the last task folder it set up. */
  readonly last: { readonly ok: boolean; readonly title: string; readonly at: string; readonly code?: number } | null
}

const ALTHAR: ReadonlyArray<Repo> = [
  {
    id: 'repo_althar',
    name: 'althar',
    checkout: '~/Projects/charrette-project/althar',
    setup: {
      copy: ['.claude/settings.local.json'],
      commands: ['bun install --frozen-lockfile', 'node apps/desktop/node_modules/electron/install.js', 'bunx playwright install chromium'],
      by: { title: 'Task folders come ready: a project setup step', threadId: 'th1' },
      at: '2 days ago',
    },
    last: { ok: true, title: 'Diffs: syntax highlighting, like the code view', at: 'today' },
  },
]

const MERIDIAN: ReadonlyArray<Repo> = [
  {
    id: 'repo_api',
    name: 'meridian-api',
    checkout: '~/code/meridian-api',
    setup: {
      copy: ['.env', '.env.local', 'config/local.yml'],
      commands: ['pnpm install --frozen-lockfile', 'pnpm prisma generate'],
      by: { title: 'Refunds over the partner budget go to review', threadId: 'th1' },
      at: 'yesterday',
    },
    last: { ok: false, title: 'Retry checkout when the card is declined', at: '1 hour ago', code: 1 },
  },
  {
    id: 'repo_web',
    name: 'meridian-web',
    checkout: '~/code/meridian-web',
    setup: {
      copy: ['.env.development.local'],
      commands: ['bun install --frozen-lockfile', 'bunx playwright install chromium webkit'],
      by: { title: 'Show the partner budget on the refunds page', threadId: 'th2' },
      at: '3 days ago',
    },
    last: { ok: true, title: 'Retry checkout when the card is declined', at: '1 hour ago' },
  },
  {
    id: 'repo_infra',
    name: 'meridian-infra',
    checkout: '~/code/meridian-infra',
    setup: null,
    last: null,
  },
]

export interface State {
  readonly direction: Direction
  readonly which: Which
  readonly moment: Moment
  readonly repos: ReadonlyArray<Repo>
}

const reposOf = (which: Which, moment: Moment) =>
  (which === 'althar' ? ALTHAR : MERIDIAN).map((one) => (moment === 'none' ? { ...one, setup: null, last: null } : one))

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
  /** The person's change to a repository's setup; null clears it. */
  change: (id: string, setup: Pick<Setup, 'copy' | 'commands'> | null) => {
    state = {
      ...state,
      repos: state.repos.map((one) =>
        one.id !== id ? one : { ...one, setup: setup === null ? null : { ...setup, by: null, at: 'just now' } },
      ),
    }
    for (const listener of listeners) listener()
  },
}

export const useProto = () => useSyncExternalStore(proto.subscribe, proto.get)
