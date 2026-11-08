import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { ThreadItem } from '@althar/contracts'
import { ToolKind, ToolState } from '@althar/ui'

import { roundsOf } from '../src/renderer/shared/rounds'
import { blocksOf, nested, type Part } from '../src/renderer/shared/thread'
import { ThreadBlocks } from '../src/renderer/shared/ThreadBlocks'
import { fakeClient, items } from './fixtures'
import { withServices } from './render'

/*
 * What an agent does beyond the repository, as the thread draws it: a web
 * search and a page it read, from outside the repository; a sub-agent, with
 * the calls it made under it and what it reported back; its context
 * compacted, with the summary behind Show summary; and the person stopping
 * its turn. Where an agent says none of these, its calls are the calls they
 * were.
 */

const at = () => 'just now'

const blocks = (thread: ReadonlyArray<ThreadItem>, turnRunning = false) =>
  blocksOf({ items: thread, turnRunning, worktree: '/w/meridian' }, new Map(), at)

const show = (thread: ReadonlyArray<ThreadItem>, turnRunning = false) => {
  const { client } = fakeClient()
  withServices(<ThreadBlocks blocks={blocks(thread, turnRunning)} threadId="th1" worktree="/w/meridian" />, client)
}

/** The same, with its turn's work opened. */
const opened = async (thread: ReadonlyArray<ThreadItem>, turnRunning = false) => {
  show(thread, turnRunning)
  await userEvent.click(screen.getByRole('button', { name: /^Work(ed|ing) for/ }))
}

const partsOf = (thread: ReadonlyArray<ThreadItem>, turnRunning = false): ReadonlyArray<Part> => {
  const turn = blocks(thread, turnRunning).find((block) => block.kind === 'turn')
  return turn?.kind === 'turn' ? turn.parts : []
}

const tools = (parts: ReadonlyArray<Part>) => parts.flatMap((part) => (part.kind === 'tool' ? [part] : []))

const search = (query: string, status = 'completed') =>
  items.tool({ title: `Search "${query}"`, toolKind: 'fetch', status, web: { action: 'search', query } })
const page = (url: string, status = 'completed') =>
  items.tool({ title: `Fetch ${url}`, toolKind: 'fetch', status, web: { action: 'fetch', url } })
const subAgent = (status = 'completed', said?: string) =>
  items.tool({
    title: 'Find the readers',
    toolKind: 'think',
    status,
    subAgent: { label: 'Find the readers', type: 'Explore', ...(said === undefined ? {} : { said }) },
  })
const compaction = (
  compaction: { status: 'in_progress' | 'completed' | 'failed' | 'cancelled'; summary?: string; error?: string },
  span?: string,
) => items.notice({ source: 'runtime', role: 'compacted', title: 'Context compacted.', description: span ?? null, compaction }, null)

describe('a web call, as its turn has it', () => {
  it('is a search by its query, or a page read by where it is, whatever kind its agent gave it', () => {
    const [searched, read] = tools(partsOf([search('acp compaction'), page('https://effect.website/docs')]))
    expect(searched).toMatchObject({ toolKind: ToolKind.Search, verb: 'Searched', web: { action: 'search', query: 'acp compaction' } })
    expect(read).toMatchObject({ toolKind: ToolKind.Fetch, verb: 'Fetched', target: 'https://effect.website/docs' })
  })

  it('says what it searches for while it runs', () => {
    const [searching] = tools(partsOf([search('acp compaction', 'in_progress')], true))
    expect(searching).toMatchObject({ verb: 'Searching', target: 'the web for “acp compaction”', state: ToolState.Running })
  })
})

describe('a sub-agent, as its turn has it', () => {
  it('has the calls it made under it, in order, out of the turn’s own steps', () => {
    const agent = subAgent('in_progress')
    const first = items.tool({ title: 'Read a.ts', parent: agent.id })
    const own = items.tool({ title: 'Read b.ts' })
    const second = items.tool({ title: 'Read c.ts', parent: agent.id })
    const parts = tools(partsOf([agent, first, own, second], true))
    expect(parts.map((part) => part.id)).toEqual([agent.id, own.id])
    expect(parts[0]?.subAgent?.calls.map((call) => call.id)).toEqual([first.id, second.id])
    expect(parts[0]).toMatchObject({ toolKind: ToolKind.Agent, verb: 'Starting', target: 'Find the readers' })
  })

  it('leaves a call whose sub-agent isn’t in the turn where it is', () => {
    const lost = items.tool({ title: 'Read a.ts', parent: 'gone' })
    expect(nested(partsOf([lost])).map((part) => part.id)).toEqual([lost.id])
  })
})

describe('a compaction and a stop, as the thread has them', () => {
  it('are lines of their own, between turns, the compaction with its summary and how far it took the context', () => {
    const thread = [
      items.says('Working.'),
      compaction({ status: 'completed', summary: 'We were fixing the retry.' }, '412k → 38k tokens'),
      items.says('Carrying on.'),
      items.notice({ source: 'runtime', role: 'interrupted', title: 'Interrupted by you.' }, null),
    ]
    const drawn = blocks(thread)
    expect(drawn.map((block) => block.kind)).toEqual(['turn', 'compacted', 'turn', 'interrupted'])
    expect(drawn[1]).toMatchObject({ status: 'completed', summary: 'We were fixing the retry.', span: '412k → 38k tokens' })
  })

  it('stand between a task’s rounds too', () => {
    const rounds = roundsOf(
      {
        items: [
          items.says('Working.'),
          compaction({ status: 'completed' }),
          items.notice({ source: 'runtime', role: 'interrupted', title: 'Interrupted by you.' }, null),
        ],
        turnRunning: false,
        worktree: '/w/meridian',
      },
      new Map(),
      at,
    )
    expect(rounds.map((block) => block.kind)).toEqual(['round', 'compacted', 'interrupted'])
  })
})

describe('drawn in the thread', () => {
  it('shows a search and a page read from outside the repository, and one still running as the call it is', async () => {
    await opened([search('acp compaction'), page('https://effect.website/docs/schema'), search('effect layers', 'in_progress')], true)
    expect(screen.getByText('Searched')).toBeTruthy()
    expect(screen.getByText('acp compaction')).toBeTruthy()
    expect(screen.getByText('/docs/schema')).toBeTruthy()
    expect(screen.getByText('effect.website')).toBeTruthy()
    expect(screen.getAllByText(/the web for “effect layers”/).length).toBeGreaterThan(0)
  })

  it('shows a call to an MCP server by the server and what its tool did', async () => {
    await opened([
      items.tool({
        title: 'mcp__linear__get_issue',
        toolKind: 'other',
        mcp: { server: 'linear', tool: 'get_issue', acts: false, did: 'Read DEV-25' },
      }),
    ])
    expect(screen.getByText('linear')).toBeTruthy()
    expect(screen.getByText('DEV-25')).toBeTruthy()
  })

  it('opens a page read to where it is, as a link out', async () => {
    await opened([page('https://effect.website/docs/schema')])
    await userEvent.click(screen.getByRole('button', { name: /docs\/schema/ }))
    expect(screen.getByRole('link', { name: /effect\.website\/docs\/schema/ }).getAttribute('href')).toBe(
      'https://effect.website/docs/schema',
    )
  })

  it('shows a sub-agent by what it was asked, its kind and calls, opening to them and what it reported back', async () => {
    const agent = subAgent('completed', 'Two readers: **Queries** and threads.')
    await opened([agent, items.tool({ title: 'Read src/agentServers.ts', parent: agent.id })])
    const list = screen.getByRole('list', { name: 'Sub-agents' })
    expect(within(list).getByText('Explore · 1 call')).toBeTruthy()
    await userEvent.click(within(list).getByRole('button', { name: /Find the readers/ }))
    expect(within(list).getByText('Queries')).toBeTruthy()
    expect(within(list).getByText('src/agentServers.ts')).toBeTruthy()
  })

  it('shows a compaction as a line, with its summary behind Show summary', async () => {
    show([items.says('Working.'), compaction({ status: 'completed', summary: 'We were fixing the retry.' }, '412k → 38k tokens')])
    expect(screen.getByText('Context compacted · 412k → 38k tokens')).toBeTruthy()
    expect(screen.queryByText('We were fixing the retry.')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Show summary' }))
    expect(screen.getByText('We were fixing the retry.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Hide summary' }))
    expect(screen.queryByText('We were fixing the retry.')).toBeNull()
  })

  it('says a compaction under way, one that failed with why, and one with no summary has nothing to show', () => {
    show([
      compaction({ status: 'in_progress' }),
      compaction({ status: 'failed', error: 'Prompt too long' }),
      compaction({ status: 'completed' }),
    ])
    expect(screen.getByText('Compacting context…')).toBeTruthy()
    expect(screen.getByText('Couldn’t compact the context · Prompt too long')).toBeTruthy()
    expect(screen.getByText('Context compacted')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Show summary' })).toBeNull()
  })

  it('says where the person interrupted the turn', () => {
    show([items.says('Working.'), items.notice({ source: 'runtime', role: 'interrupted', title: 'Interrupted by you.' }, null)])
    expect(screen.getByText('Interrupted by you')).toBeTruthy()
  })

  it('shows a call its agent said none of this of as the call it is', async () => {
    await opened([items.tool({ title: 'websearch', toolKind: 'other' })])
    expect(screen.getByText('websearch')).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Sub-agents' })).toBeNull()
  })
})
