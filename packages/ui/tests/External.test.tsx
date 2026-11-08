import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ToolState } from '../src/foundations/vocabulary'
import { WebFetch, WebSearch } from '../src/thread/External/External'
import { SubAgents } from '../src/thread/SubAgents/SubAgents'

/*
 * What comes from outside the repository, as far as it is known: a search
 * by what was searched for, without what it found; a page by where it is,
 * without its title or what was read of it; a sub-agent without its model.
 */

describe('a web search known only by its query', () => {
  it('says what was searched for, and doesn’t open', () => {
    render(<WebSearch query="acp compaction" />)
    expect(screen.getByText('acp compaction')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByText(/results/)).toBeNull()
  })

  it('says how many it found, and opens to them, where it is known', () => {
    render(<WebSearch query="acp" results={[{ title: 'Agent Client Protocol', host: 'agentclientprotocol.com' }]} />)
    expect(screen.getByText('1 results')).toBeTruthy()
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('Agent Client Protocol')).toBeTruthy()
  })
})

describe('a page known only by where it is', () => {
  it('is named by its path beside its host, and opens to the link out', () => {
    render(<WebFetch url="https://effect.website/docs/schema" />)
    expect(screen.getByText('/docs/schema')).toBeTruthy()
    expect(screen.getByText('effect.website')).toBeTruthy()
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('link').getAttribute('href')).toBe('https://effect.website/docs/schema')
    expect(document.querySelector('blockquote')).toBeNull()
  })

  it('is named by its host where it is the host’s front page', () => {
    render(<WebFetch url="https://effect.website" />)
    expect(screen.getAllByText('effect.website')).toHaveLength(2)
  })
})

describe('a sub-agent without its model', () => {
  it('shows what it was asked and how far it is, with no model', () => {
    render(<SubAgents list={[{ id: 'a', label: 'Find the readers', state: ToolState.Running, meta: 'Explore · 2 calls', calls: null }]} />)
    expect(screen.getByText('Explore · 2 calls')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Find the readers, running/ })).toBeTruthy()
  })
})
