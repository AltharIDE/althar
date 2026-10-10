import { describe, expect, it } from 'vitest'

import type { BoardTask, ConnectionList } from '@althar/contracts'
import { Brand } from '@althar/ui'

import { lanesOf } from '../src/renderer/features/board/lanes'
import {
  hostMarksOf,
  lastSettledOf,
  partsOf,
  productOfRemote,
  remoteHostOf,
  rulesLineOf,
  trackerOf,
} from '../src/renderer/features/project/front'
import { card, change, connectionList, githubConnection, projectRules } from './fixtures'

/*
 * What a project's front page says, from what the window read: what settled
 * last, what it is made of, the hosts its repositories are on, the tracker
 * its tasks name, and its rules in a line.
 */

const NOW = new Date('2026-10-01T12:00:00.000Z')

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

const settled = (...tasks: BoardTask[]) => lanesOf({ cursor: 1, tasks, calls: [] })

const github = { product: 'github', name: 'GitHub', webUrl: 'https://github.com', connected: true } as const

describe('a project’s front page', () => {
  it('says what settled last: its pull request merged or closed, or the task done or abandoned, and when', () => {
    expect(lastSettledOf(settled(), NOW)).toBeUndefined()
    expect(lastSettledOf(settled(task({ change: change({ state: 'merged', number: 1184 }) })), NOW)).toBe('PR 1184 merged 3h ago')
    expect(lastSettledOf(settled(task({ change: change({ state: 'closed', number: 9 }) })), NOW)).toBe('PR 9 closed 3h ago')
    expect(lastSettledOf(settled(task({ title: 'Log the partner id' })), NOW)).toBe('Log the partner id, done 3h ago')
    expect(lastSettledOf(settled(task({ title: 'Cold start', state: 'abandoned', settledAt: null })), NOW)).toBe('Cold start, abandoned')
    // The most recent of them.
    expect(
      lastSettledOf(
        settled(
          task({ title: 'Older', settledAt: '2026-10-01T08:00:00.000Z' }),
          task({ title: 'Newer', settledAt: '2026-10-01T11:30:00.000Z' }),
        ),
        NOW,
      ),
    ).toBe('Newer, done 30m ago')
  })

  it('reads the host off a repository’s remote, however git wrote it', () => {
    expect(remoteHostOf('git@github.com:meridian/api.git')).toBe('github.com')
    expect(remoteHostOf('https://GitLab.com/meridian/ops')).toBe('gitlab.com')
    expect(remoteHostOf('ssh://git@git.example.com:22/meridian/web')).toBe('git.example.com')
    expect(remoteHostOf('/Users/me/code/meridian')).toBeNull()
    expect(remoteHostOf('https://')).toBeNull()
    expect(remoteHostOf(null)).toBeNull()
  })

  it('knows a remote’s host as the project’s own, one connected, or one Althar knows; not one it doesn’t', () => {
    const own = { product: 'gitlab', name: 'GitLab', webUrl: 'https://git.example.com', connected: false } as const
    expect(productOfRemote('git@git.example.com:a/b.git', own, connectionList)).toBe('gitlab')
    expect(productOfRemote('git@github.com:a/b.git', null, connectionList)).toBe('github')
    const company: ConnectionList = {
      ...connectionList,
      connections: [{ ...githubConnection, id: 'c2', webUrl: 'https://github.acme.dev' }],
    }
    expect(productOfRemote('https://github.acme.dev/a/b', null, company)).toBe('github')
    // Linear is a tracker, never where code is.
    expect(productOfRemote('https://linear.app/a/b', null, connectionList)).toBeNull()
    expect(productOfRemote('git@codeberg.org:a/b.git', null, connectionList)).toBeNull()
    expect(productOfRemote('git@github.com:a/b.git', null, null)).toBeNull()
  })

  it('says what it is made of: each repository with its host’s mark, then the tracker its tasks name', () => {
    expect(
      partsOf({
        repositories: [
          { id: 'api', name: 'meridian-api', remote: 'git@github.com:meridian/api.git' },
          { id: 'ops', name: 'meridian-ops', remote: null },
        ],
        host: github,
        list: connectionList,
        tracker: { product: 'linear', key: 'MER' },
      }),
    ).toEqual([
      { id: 'api', name: 'meridian-api', brand: Brand.GitHub },
      { id: 'ops', name: 'meridian-ops' },
      { id: 'tracker:MER', name: 'MER issues', brand: Brand.Linear },
    ])
  })

  it('names the tracker by the key most of its tasks’ issues share, and none for a host’s own issues', () => {
    const issue = (key: string, product: 'linear' | 'github' = 'linear') => ({ product, key, title: key, url: `https://x/${key}` })
    expect(trackerOf([], connectionList)).toBeNull()
    expect(trackerOf([task({ issue: issue('#12', 'github') }), task({ issue: issue('MER-1', 'github') })], connectionList)).toBeNull()
    expect(
      trackerOf(
        [task({ issue: issue('OPS-1') }), task({ issue: issue('MER-231') }), task({ issue: issue('MER-240') }), task()],
        connectionList,
      ),
    ).toEqual({ product: 'linear', key: 'MER' })
    expect(trackerOf([task({ issue: issue('MER-1') })], null)).toBeNull()
  })

  it('marks each host its repositories are on once, faint where Althar isn’t connected to it', () => {
    const repositories = [{ remote: 'git@github.com:a/api.git' }, { remote: 'git@github.com:a/web.git' }, { remote: null }]
    expect(hostMarksOf(repositories, github, connectionList)).toEqual([
      { id: Brand.GitHub, name: 'GitHub', brand: Brand.GitHub, faint: true },
    ])
    expect(hostMarksOf(repositories, github, { ...connectionList, connections: [githubConnection] })).toEqual([
      { id: Brand.GitHub, name: 'GitHub', brand: Brand.GitHub },
    ])
    // Without the list, the project's own host says whether it is connected.
    expect(hostMarksOf(repositories, github, null)).toEqual([{ id: Brand.GitHub, name: 'GitHub', brand: Brand.GitHub }])
  })

  it('says its rules in a line: who answers, and what always asks you', () => {
    expect(rulesLineOf({ ...projectRules, permissions: 'coordinator', alwaysAsk: ['deploy', 'default-branch'] })).toEqual({
      policy: 'The coordinator decides',
      asks: 'Always asks you: Deploying and publishing, pushing to the default branch.',
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
  })
})
