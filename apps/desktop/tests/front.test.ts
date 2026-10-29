import { describe, expect, it, vi } from 'vitest'

import type { BoardTask, ConnectionList, ProductOption, ProjectRepository } from '@althar/contracts'
import { Brand } from '@althar/ui'

import { connectedAs, hostMarksOf, partsOf, rulesLineOf, trackersOf, trackerUrlOf } from '../src/renderer/features/project/front'
import { card, connectionList, githubConnection, projectRules } from './fixtures'

/*
 * What a project's header says, from what the window read: what it is made of, the hosts its repositories are on, the tracker
 * its tasks name, and its rules in a line.
 */

const task = (overrides: Partial<BoardTask> = {}): BoardTask => ({
  ...card(),
  state: 'done',
  phase: 'settled',
  createdAt: '2026-10-01T09:00:00.000Z',
  settledAt: '2026-10-01T09:00:00.000Z',
  changed: null,
  here: [],
  ...overrides,
})

const github = { product: 'github', name: 'GitHub', webUrl: 'https://github.com', connected: true } as const

/** Where a repository's work goes, as the runtime read it: on a host, and connected there or not. */
const on = (
  product: 'github' | 'gitlab',
  path: string,
  state: 'ready' | 'reauth_required' | null,
): NonNullable<ProjectRepository['host']> => ({
  product,
  name: product === 'github' ? 'GitHub' : 'GitLab',
  instance: null,
  path,
  url: `https://${product}.com/${path}`,
  account: state === null ? null : { login: 'me', state },
})

const GITLAB: ProductOption = {
  product: 'gitlab',
  service: 'gitlab',
  name: 'GitLab',
  host: true,
  tracker: true,
  hostedUrl: 'https://gitlab.com',
  selfHosted: true,
  browserSignIn: true,
  tokenNeeds: null,
  tokenPrefixes: ['glpat-'],
  tokenHelpForKey: null,
  keyChecks: [],
}

describe('a project’s header', () => {
  it('says what it is made of: each repository with its host’s mark, then the trackers its tasks name, each opening where it lives', () => {
    const open = vi.fn()
    const parts = partsOf({
      repositories: [
        { id: 'api', name: 'meridian-api', host: on('github', 'meridian/api', 'ready') },
        { id: 'web', name: 'meridian-web', host: on('github', 'meridian/web', null) },
        { id: 'ops', name: 'meridian-ops', host: null },
      ],
      names: [],
      host: github,
      trackers: [{ product: 'linear', at: 'linear.app', key: 'MER', url: 'https://linear.app/acme/team/MER', connections: [] }],
      open,
    })
    expect(parts.map(({ id, name, brand, openLabel }) => ({ id, name, brand, openLabel }))).toEqual([
      { id: 'api', name: 'meridian-api', brand: Brand.GitHub, openLabel: 'Open on GitHub' },
      // Not connected there: it opens all the same, from its remote.
      { id: 'web', name: 'meridian-web', brand: Brand.GitHub, openLabel: 'Open on GitHub' },
      { id: 'ops', name: 'meridian-ops' },
      { id: 'tracker:linear:linear.app:MER', name: 'MER issues', brand: Brand.Linear, openLabel: 'Open on Linear' },
    ])
    parts[1]?.onOpen?.()
    parts[3]?.onOpen?.()
    expect(open.mock.calls).toEqual([['https://github.com/meridian/web'], ['https://linear.app/acme/team/MER']])
    expect(parts[2]?.onOpen).toBeUndefined()
  })

  it('shows three trackers by name and counts the rest', () => {
    const tracker = (key: string) => ({ product: 'linear' as const, at: 'linear.app', key, url: null, connections: [] })
    const parts = partsOf({
      repositories: [],
      names: [],
      host: null,
      trackers: ['A', 'B', 'C', 'D', 'E'].map(tracker),
      open: vi.fn(),
    })
    expect(parts.map((part) => part.name)).toEqual(['A issues', 'B issues', 'C issues', '+2 more'])
    // Without an address to build on, they are words.
    expect(parts.some((part) => part.onOpen !== undefined)).toBe(false)
  })

  it('says its repositories by name, on the project’s host, until they are read', () => {
    const open = vi.fn()
    expect(partsOf({ repositories: null, names: ['api', 'web'], host: github, trackers: [], open })).toEqual([
      { id: 'api', name: 'api', brand: Brand.GitHub },
      { id: 'web', name: 'web', brand: Brand.GitHub },
    ])
    expect(partsOf({ repositories: null, names: ['api'], host: null, trackers: [], open })).toEqual([{ id: 'api', name: 'api' }])
  })

  it('names each tracker key its tasks’ issues share, the most used first, and none for a host’s own issues', () => {
    const issue = (key: string, product: 'linear' | 'github' = 'linear') => ({
      product,
      key,
      title: key,
      url: `https://x/acme/issue/${key}`,
    })
    expect(trackersOf([], connectionList)).toEqual([])
    expect(trackersOf([task({ issue: issue('#12', 'github') }), task({ issue: issue('MER-1', 'github') })], connectionList)).toEqual([])
    expect(
      trackersOf(
        [task({ issue: issue('OPS-1') }), task({ issue: issue('MER-231') }), task({ issue: issue('MER-240') }), task()],
        connectionList,
      ),
    ).toEqual([
      { product: 'linear', at: 'x', key: 'MER', url: 'https://x/acme/team/MER', connections: [] },
      { product: 'linear', at: 'x', key: 'OPS', url: 'https://x/acme/team/OPS', connections: [] },
    ])
    expect(trackersOf([task({ issue: issue('MER-1') })], null)).toEqual([])
  })

  it('keeps the connections a tracker’s issues are read through, the most used first', () => {
    const through = (key: string, connectionId: string) => ({
      product: 'linear' as const,
      key,
      title: key,
      url: `https://linear.app/acme/issue/${key}`,
      connectionId,
    })
    expect(
      trackersOf(
        [
          task({ issue: through('MER-1', 'conn_a') }),
          task({ issue: through('MER-2', 'conn_b') }),
          task({ issue: through('MER-3', 'conn_b') }),
        ],
        connectionList,
      ).map((tracker) => tracker.connections),
    ).toEqual([['conn_b', 'conn_a']])
  })

  it('names a tracker whose issues share no key once, by its name: Trello’s cards', () => {
    const trello = { ...connectionList.products[1]!, product: 'trello', service: 'trello', name: 'Trello' } as const
    const list = { ...connectionList, products: [...connectionList.products, trello] }
    const card = (key: string) => ({ product: 'trello' as const, key, title: key, url: `https://trello.com/c/${key}/1-refunds` })
    const trackers = trackersOf([task({ issue: card('aBcD1234') }), task({ issue: card('xYz98765') })], list)
    expect(trackers).toEqual([{ product: 'trello', at: 'trello.com', key: null, url: 'https://trello.com', connections: [] }])
    expect(partsOf({ repositories: [], names: [], host: null, trackers, open: vi.fn() }).map((part) => part.name)).toEqual(['Trello cards'])
  })

  it('works out a key’s space from the link of one of its issues', () => {
    expect(trackerUrlOf('linear', 'MER', 'https://linear.app/acme/issue/MER-231/refund-keys')).toBe('https://linear.app/acme/team/MER')
    expect(trackerUrlOf('jira_cloud', 'PAY', 'https://acme.atlassian.net/browse/PAY-9')).toBe('https://acme.atlassian.net/browse/PAY')
    expect(trackerUrlOf('linear', 'MER', 'not an address')).toBeNull()
    expect(trackerUrlOf('linear', 'MER', 'javascript:alert(1)')).toBeNull()
  })

  it('marks each host its repositories are on once, faint while Althar isn’t connected there', () => {
    const repositories = [{ host: on('github', 'a/api', null) }, { host: on('github', 'a/web', null) }, { host: null }]
    expect(hostMarksOf(repositories)).toEqual([{ id: Brand.GitHub, name: 'GitHub', brand: Brand.GitHub, faint: true }])
    // Connected on one of them, the mark is whole; a sign-in that stopped working doesn't count.
    expect(hostMarksOf([...repositories, { host: on('github', 'a/ops', 'ready') }])).toEqual([
      { id: Brand.GitHub, name: 'GitHub', brand: Brand.GitHub },
    ])
    expect(hostMarksOf([{ host: on('gitlab', 'a/b', 'reauth_required') }])).toEqual([
      { id: Brand.GitLab, name: 'GitLab', brand: Brand.GitLab, faint: true },
    ])
    // A host Althar doesn't know has no mark.
    expect(hostMarksOf([{ host: { ...on('github', 'a/b', null), product: null, name: 'git.example.com' } }])).toEqual([])
  })

  it('says who Althar is connected as on that very server', () => {
    const list: ConnectionList = {
      ...connectionList,
      products: [...connectionList.products, GITLAB],
      connections: [
        {
          ...githubConnection,
          id: 'c3',
          product: 'gitlab',
          name: 'GitLab',
          webUrl: 'https://gitlab.com',
          account: { login: 'me', name: null },
        },
      ],
    }
    expect(connectedAs(list, 'gitlab', 'gitlab.com')).toBe('me')
    // GitLab.com is connected; the company's own GitLab isn't.
    expect(connectedAs(list, 'gitlab', 'git.acme.dev')).toBeNull()
    // A signed-out connection doesn't count.
    expect(
      connectedAs(
        { ...list, connections: list.connections.map((each) => ({ ...each, state: 'reauth_required' as const })) },
        'gitlab',
        null,
      ),
    ).toBeNull()
  })

  it('says its rules in a line: who answers, and what always asks you', () => {
    expect(rulesLineOf({ ...projectRules, permissions: 'coordinator', alwaysAsk: ['deploy', 'default-branch'] })).toEqual({
      policy: 'The coordinator decides',
      asks: 'Always asks you: Pushing to the default branch, deploying and publishing.',
    })
    expect(
      rulesLineOf({
        ...projectRules,
        alwaysAsk: [],
        commands: [
          { pattern: 'npm publish', decision: 'ask' },
          { pattern: 'rm', decision: 'never' },
        ],
      }),
    ).toEqual({ policy: 'Allow, except what you keep', asks: 'Always asks you: “npm publish”.' })
    expect(rulesLineOf({ ...projectRules, permissions: 'ask', alwaysAsk: [] }).asks).toBe('Nothing always asks you.')
    // With everything allowed, what always asks is kept but asks nothing.
    expect(
      rulesLineOf({
        ...projectRules,
        allowEverything: true,
        alwaysAsk: ['deploy'],
        commands: [{ pattern: 'npm publish', decision: 'ask' }],
      }),
    ).toEqual({ policy: 'Allow everything', asks: 'Nothing waits for you.' })
  })
})
