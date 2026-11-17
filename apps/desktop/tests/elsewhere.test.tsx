import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { Elsewhere, FolderReading } from '@althar/contracts'

import { useAccountSignIn } from '../src/renderer/features/accounts/useAccountSignIn'
import { picked, picksOf, tilesOf, words } from '../src/renderer/features/elsewhere/tiles'
import { merged } from '../src/renderer/features/elsewhere/useElsewhere'
import { StartView } from '../src/renderer/features/start/StartView'
import { useStart } from '../src/renderer/features/start/useStart'
import { fakeClient, fakeHost } from './fixtures'
import { withServices } from './render'
import { seenTheTour, toTheProject } from './welcome'

/*
 * Bringing in other tools' work (docs/decisions/workspaces-and-runs.md, "Bringing in other tools' work"): what was found,
 * as the kit's tiles show it, and the welcome's step that brings it in once the project is made, with nothing taken at
 * first and the welcome moving on at once.
 */

const NOW = new Date('2026-11-17T12:00:00.000Z')

const FOUND: Elsewhere = {
  worktrees: [
    {
      key: 'worktree:/h/conductor/workspaces/meridian/lima',
      tool: 'conductor',
      repositoryId: 'b1',
      repository: 'meridian',
      path: '/Users/ada/conductor/workspaces/meridian/lima',
      branch: 'feature/lima',
      name: 'lima',
      uncommitted: 3,
      unpushed: 2,
      ahead: 2,
      pullRequest: { number: 812, url: 'https://github.com/acme/meridian/pull/812' },
      archived: false,
      lastAt: '2026-11-17T10:00:00.000Z',
      conversations: ['claude_code:s2'],
      taskId: null,
    },
    {
      key: 'worktree:/h/orca/workspaces/meridian/fix',
      tool: 'orca',
      repositoryId: 'b1',
      repository: 'meridian',
      path: '/Users/ada/orca/workspaces/meridian/fix',
      branch: null,
      name: 'Flaky login test',
      uncommitted: 0,
      unpushed: 0,
      ahead: 0,
      pullRequest: null,
      archived: true,
      lastAt: '2026-11-10T10:00:00.000Z',
      conversations: [],
      taskId: null,
    },
    { ...FOUND_BROUGHT() },
  ],
  setups: [
    {
      key: 'setup:conductor:/m',
      tool: 'conductor',
      repositoryId: 'b1',
      repository: 'meridian',
      file: 'conductor.json',
      commands: ['bun install'],
      copy: [],
      current: false,
    },
    {
      key: 'setup:orca:/m',
      tool: 'orca',
      repositoryId: 'b1',
      repository: 'meridian',
      file: 'orca.yaml',
      commands: ['pnpm i\npnpm build'],
      copy: [],
      current: false,
    },
    {
      key: 'setup:t_three_code:/m',
      tool: 't_three_code',
      repositoryId: 'b1',
      repository: 'meridian',
      file: 't3.json',
      commands: ['bun install'],
      copy: [],
      current: true,
    },
  ],
  conversations: [
    {
      key: 'claude_code:s1',
      agent: 'claude_code',
      title: 'Gyroscope fixture',
      startedAt: '2026-11-17T11:00:00.000Z',
      lastAt: '2026-11-17T11:30:00.000Z',
      prompts: 4,
      worktree: null,
      taskId: null,
    },
    {
      key: 'claude_code:s2',
      agent: 'claude_code',
      title: 'Lima export',
      startedAt: '2026-11-17T09:00:00.000Z',
      lastAt: null,
      prompts: null,
      worktree: 'worktree:/h/conductor/workspaces/meridian/lima',
      taskId: null,
    },
    {
      key: 'codex:t1',
      agent: 'codex',
      title: 'Rename to compass',
      startedAt: '2026-11-12T10:00:00.000Z',
      lastAt: '2026-11-12T10:10:00.000Z',
      prompts: null,
      worktree: null,
      taskId: 'task_x',
    },
  ],
}

function FOUND_BROUGHT() {
  return {
    key: 'worktree:/h/.t3/worktrees/meridian/t3',
    tool: 't_three_code' as const,
    repositoryId: 'b1',
    repository: 'meridian',
    path: '/Users/ada/.t3/worktrees/meridian/t3',
    branch: 't3/1a2b',
    name: 'Dark mode',
    uncommitted: 0,
    unpushed: null,
    ahead: 1,
    pullRequest: null,
    archived: false,
    lastAt: null,
    conversations: [],
    taskId: 'task_brought',
  }
}

describe('what other tools left, as tiles', () => {
  it('has a tile for each tool with anything new, in order, and leaves out what came in already', () => {
    const tiles = tilesOf(FOUND, NOW)
    expect(tiles.map((tile) => tile.id)).toEqual(['conductor', 'orca', 'claude_code'])
    const conductor = tiles[0]
    expect(conductor?.size).toBe('1 worktree')
    expect(conductor?.groups.map((group) => [group.title, group.items.map((item) => item.key)])).toEqual([
      ['Worktrees', ['worktree:/h/conductor/workspaces/meridian/lima']],
      ['Setup', ['setup:conductor:/m']],
      ['Conversations', []],
    ])
    expect(conductor?.groups[0]?.items[0]?.at).toBe('2h ago')
    // Orca's is detached, archived there, and its setup comes with its tile; T3 Code's setup is the repository's already.
    expect(tiles[1]?.groups[1]?.items[0]?.title).toBe('Orca’s setup')
    // An agent's tile counts its conversations, the newest first, one that ran in a worktree saying which.
    const claude = tiles[2]
    expect(claude?.size).toBe('2 conversations')
    expect(claude?.groups[2]?.items.map((item) => [item.title, item.where])).toEqual([
      ['Gyroscope fixture', '4 messages'],
      ['Lima export', 'in lima'],
    ])
  })

  it('takes one setup for a repository, and counts what the picks bring in', () => {
    const one = picked(FOUND, new Set(), ['setup:conductor:/m'], true)
    const other = picked(FOUND, one, ['setup:orca:/m', 'worktree:/h/conductor/workspaces/meridian/lima'], true)
    expect([...other].toSorted()).toEqual(['setup:orca:/m', 'worktree:/h/conductor/workspaces/meridian/lima'])
    expect(picksOf(FOUND, other)).toEqual({
      worktrees: ['worktree:/h/conductor/workspaces/meridian/lima'],
      setups: ['setup:orca:/m'],
      conversations: [],
    })
    expect([...picked(FOUND, other, ['setup:orca:/m'], false)]).toEqual(['worktree:/h/conductor/workspaces/meridian/lima'])
    expect(words.bring(1, 1, 2)).toBe('Bring in 1 worktree, 1 setup and 2 conversations')
    expect(words.bring(0, 0, 1)).toBe('Bring in 1 conversation')
    expect(words.bring(0, 0, 0)).toBeNull()
    expect(words.andThen('Bring in 1 worktree')).toBe('Then bring in 1 worktree.')
  })

  it('reads several folders as one, each thing once', () => {
    const both = merged([FOUND, { worktrees: FOUND.worktrees.slice(0, 1), setups: [], conversations: FOUND.conversations }])
    expect(both.worktrees).toHaveLength(3)
    expect(both.conversations).toHaveLength(3)
  })
})

function Start({ onProject = vi.fn() }: { onProject?: (id: string) => void }) {
  const start = useStart()
  return <StartView model={start} accounts={useAccountSignIn(start)} onProject={onProject} home={() => null} />
}

const reading: FolderReading = {
  kind: 'repository',
  name: 'meridian',
  repositories: [{ path: '/w/meridian', folder: null, name: 'meridian', branch: 'main', remote: null }],
  project: null,
}

describe('the welcome’s step for what other tools left', () => {
  it('comes after the project with nothing taken, and brings in what a press took as the welcome goes on', async () => {
    const { client } = fakeClient({
      listProjects: vi.fn(async () => ({ cursor: 0, projects: [] })),
      readFolder: vi.fn(async () => reading),
      lookElsewhere: vi.fn(async () => FOUND),
    })
    seenTheTour()
    withServices(<Start />, client, fakeHost())
    await toTheProject()
    await userEvent.click(await screen.findByRole('button', { name: /Choose a folder/ }))
    await screen.findByRole('list', { name: 'Repositories for the project' })
    await userEvent.click(screen.getByRole('button', { name: /Make the project/ }))
    expect(await screen.findByRole('heading', { name: 'Already under way' })).toBeTruthy()
    expect(client.lookElsewhere).toHaveBeenCalledWith({ projectId: expect.any(String) })
    // Nothing taken: its button lets it be.
    expect(screen.getByRole('button', { name: 'Not now' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /^Conductor/ }))
    const go = screen.getByRole('button', { name: 'Bring in 1 worktree and 1 setup' })
    await userEvent.click(go)
    await waitFor(() =>
      expect(client.bringIn).toHaveBeenCalledWith({
        projectId: expect.any(String),
        worktrees: ['worktree:/h/conductor/workspaces/meridian/lima'],
        setups: ['setup:conductor:/m'],
        conversations: [],
        steps: [],
      }),
    )
    // On to the next step at once.
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Already under way' })).toBeNull())
  })

  it('isn’t a step where other tools left nothing', async () => {
    const { client } = fakeClient({
      listProjects: vi.fn(async () => ({ cursor: 0, projects: [] })),
      readFolder: vi.fn(async () => reading),
    })
    seenTheTour()
    withServices(<Start />, client, fakeHost())
    await toTheProject()
    await userEvent.click(await screen.findByRole('button', { name: /Choose a folder/ }))
    await screen.findByRole('list', { name: 'Repositories for the project' })
    await userEvent.click(screen.getByRole('button', { name: /Make the project/ }))
    await waitFor(() => expect(client.lookElsewhere).toHaveBeenCalled())
    // Straight on to where its code is.
    expect(await screen.findByRole('heading', { name: 'Pull requests' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Already under way' })).toBeNull()
  })
})
