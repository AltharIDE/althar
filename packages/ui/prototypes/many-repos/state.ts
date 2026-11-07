// Scrappy: what the page shows (which direction, which state, which view) and the repositories as pressing changes them.
import { useSyncExternalStore } from 'react'

import { type Check, type Repo, SCENARIOS, type Scenario, scenarioOf } from './data'

export type Direction = 'A' | 'B' | 'C' | 'Today'

export interface Proto {
  readonly direction: Direction
  readonly scenario: Scenario
  /** The scenario's repositories, as pressing has changed them since. */
  readonly repos: readonly Repo[]
  /** The task's screen, or every state of the direction side by side. */
  readonly view: 'screen' | 'all'
  /** The window as narrow as a laptop's half screen. */
  readonly narrow: boolean
  /** No strip under the window: for screenshots. */
  readonly bare: boolean
}

let state: Proto = {
  direction: 'A',
  scenario: SCENARIOS[1]!,
  repos: SCENARIOS[1]!.repos,
  view: 'screen',
  narrow: false,
  bare: false,
}
const listeners = new Set<() => void>()
const emit = () => {
  for (const listener of listeners) listener()
}
const timers = new Set<ReturnType<typeof setTimeout>>()
const later = (ms: number, act: () => void) => {
  const timer = setTimeout(() => {
    timers.delete(timer)
    act()
  }, ms)
  timers.add(timer)
}

const change = (slug: string, to: (repo: Repo) => Repo) => {
  state = { ...state, repos: state.repos.map((repo) => (repo.slug === slug ? to(repo) : repo)) }
  emit()
}

/** Its checks run again, and pass. */
const rerun = (slug: string, then?: () => void) => {
  change(slug, (repo) => ({ ...repo, checks: repo.checks.map((check): Check => ({ name: check.name, state: 'running' })) }))
  later(2200, () => {
    change(slug, (repo) => ({ ...repo, checks: repo.checks.map((check): Check => ({ ...check, state: 'passed' })) }))
    then?.()
  })
}

const MERGES_IN = 1400

export const proto = {
  get: () => state,
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  set: (next: Partial<Proto>) => {
    state = { ...state, ...next }
    emit()
  },
  /** Another state: the scenario's repositories as they were, nothing pressed. */
  scenario: (key: string) => {
    const scenario = scenarioOf(key) ?? SCENARIOS[1]!
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
    state = { ...state, scenario, repos: scenario.repos }
    emit()
    // Opened mid-merge, it carries on, in order.
    const going = scenario.repos.filter((repo) => repo.state === 'merging' || repo.state === 'waiting').map((repo) => repo.slug)
    if (going.length > 0) proto.merge(going)
  },
  markReady: (slugs: readonly string[]) => {
    state = {
      ...state,
      repos: state.repos.map((repo) => (slugs.includes(repo.slug) && repo.state === 'draft' ? { ...repo, state: 'open' } : repo)),
    }
    emit()
  },
  /** Merges them in their order, one after the other, stopping at one its host refuses. */
  merge: (slugs: readonly string[]) => {
    const order = state.repos.filter((repo) => slugs.includes(repo.slug) && repo.state !== 'merged').map((repo) => repo.slug)
    state = {
      ...state,
      repos: state.repos.map((repo) =>
        order.includes(repo.slug) ? { ...repo, state: repo.slug === order[0] ? 'merging' : 'waiting', refused: undefined } : repo,
      ),
    }
    emit()
    const step = (at: number) =>
      later(MERGES_IN, () => {
        const slug = order[at]
        if (slug === undefined) return
        const repo = state.repos.find((one) => one.slug === slug)
        if (repo?.refused !== undefined) {
          state = {
            ...state,
            repos: state.repos.map((one) =>
              one.slug === slug
                ? { ...one, state: 'refused' }
                : order.includes(one.slug) && one.state === 'waiting'
                  ? { ...one, state: 'open' }
                  : one,
            ),
          }
          emit()
          return
        }
        const next = order[at + 1]
        state = {
          ...state,
          repos: state.repos.map((one) =>
            one.slug === slug ? { ...one, state: 'merged' } : one.slug === next ? { ...one, state: 'merging' } : one,
          ),
        }
        emit()
        if (next !== undefined) step(at + 1)
      })
    step(0)
  },
  /** The lead brings the branch up to date: its conflict or its refusal settled, its checks run again. */
  resolve: (slug: string) => {
    change(slug, (repo) => ({ ...repo, conflict: undefined, refused: undefined, state: repo.state === 'refused' ? 'open' : repo.state }))
    rerun(slug)
  },
  /** The lead fixes what failed; its checks run again, and pass. */
  fix: (slug: string) => rerun(slug),
  /** Its host connected: Althar opens its draft pull request from the pushed branch, and its checks start. */
  connect: () => {
    state = {
      ...state,
      repos: state.repos.map((repo): Repo =>
        repo.connected
          ? repo
          : {
              ...repo,
              connected: true,
              number: 14,
              state: 'draft',
              checks: ['lint', 'test', 'build'].map((name): Check => ({ name, state: 'running' })),
            },
      ),
    }
    emit()
    for (const repo of state.repos.filter((one) => one.number === 14)) rerun(repo.slug)
  },
}

export const useProto = () => useSyncExternalStore(proto.subscribe, proto.get)
