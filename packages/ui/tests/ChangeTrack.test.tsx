import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SONNET } from '../src/fixtures/models'
import {
  TRACK_FOUR,
  TRACK_MERGING,
  TRACK_ONE_READY,
  TRACK_READY,
  TRACK_REFUSED,
  TRACK_FAILING,
  TRACK_CONFLICT,
  TRACK_QUEUED,
} from '../src/fixtures/outputs'
import { CheckState } from '../src/foundations/vocabulary'
import { ChangeTrack, type TrackStop } from '../src/outputs/ChangeSet/ChangeTrack'

/*
 * A change across several repositories, as one track in the order they
 * merge: each repository's pull request and its one line, the review once,
 * and the files under each repository by their paths in it.
 */

const stops = () => within(screen.getByRole('list', { name: 'In the order they merge' })).getAllByRole('listitem')

describe('the order they merge in', () => {
  it('numbers each repository’s pull request in turn, each a link to its own host', () => {
    render(<ChangeTrack stops={TRACK_READY} />)
    const [engine, frontend] = stops()
    expect(engine?.textContent).toMatch(/^1engine !52/)
    expect(frontend?.textContent).toMatch(/^2frontend !27/)
    expect(screen.getByRole('link', { name: 'Open engine !52 on GitLab' }).getAttribute('href')).toBe(
      'https://gitlab.com/fnt/engine/-/merge_requests/52',
    )
    expect(screen.getByRole('link', { name: 'Open frontend !27 on GitLab' })).toBeInTheDocument()
  })

  it('names a pull request without a link where its address isn’t one', () => {
    render(<ChangeTrack stops={TRACK_READY.map((stop) => ({ ...stop, url: 'javascript:alert(1)' }))} />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('engine !52')).toBeInTheDocument()
  })

  it('says Draft beside each draft alone', () => {
    render(<ChangeTrack stops={TRACK_ONE_READY} />)
    const [engine, frontend] = stops()
    expect(engine?.textContent).not.toMatch(/Draft/)
    expect(frontend?.textContent).toMatch(/Draft/)
  })

  it('gives each repository its own checks, naming what failed where it failed', () => {
    render(<ChangeTrack stops={TRACK_FAILING} />)
    expect(screen.getByRole('button', { name: 'engine’s checks: 8 checks passed' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'frontend’s checks: e2e:chat failed' }))
    expect(screen.getByText('bundle-size')).toBeInTheDocument()
  })

  it('counts checks on their way, and says where none have run yet', () => {
    render(<ChangeTrack stops={TRACK_FOUR} />)
    expect(screen.getByRole('button', { name: 'meridian-web’s checks: 2 of 4 checks passed' })).toBeInTheDocument()
    expect(screen.getByText('No checks have run yet')).toBeInTheDocument()
  })

  it('counts skipped checks as settled, not as still running', () => {
    const [first] = TRACK_FOUR
    const stop: TrackStop = {
      ...first!,
      standing: 'open',
      checks: [
        { id: '1', name: 'build', state: CheckState.Passed },
        { id: '2', name: 'ui', state: CheckState.Skipped },
      ],
    }
    render(<ChangeTrack stops={[stop]} />)
    expect(screen.getByRole('button', { name: /checks: 1 check passed, 1 skipped$/ })).toBeInTheDocument()
    expect(screen.queryByText(/the rest running/)).not.toBeInTheDocument()
  })

  it('says which repository conflicts, and with what', () => {
    render(<ChangeTrack stops={TRACK_CONFLICT} />)
    expect(stops()[1]?.textContent).toMatch(/Conflicts with main/)
    expect(stops()[0]?.textContent).not.toMatch(/Conflicts/)
  })

  it('says which merges now and which merges after it', () => {
    render(<ChangeTrack stops={TRACK_MERGING} />)
    expect(stops()[0]?.textContent).toMatch(/Merging into main/)
    expect(stops()[1]?.textContent).toMatch(/Merges after engine/)
  })

  it('says one in its merge queue is there', () => {
    render(<ChangeTrack stops={TRACK_QUEUED} />)
    expect(stops()[0]?.textContent).toMatch(/In the merge queue/)
  })

  it('says one merged is in its target, and why its host refused the next', () => {
    render(<ChangeTrack stops={TRACK_REFUSED} />)
    expect(stops()[0]?.textContent).toMatch(/Merged into main/)
    expect(stops()[1]?.textContent).toMatch(/Not merged: main moved on/)
    expect(stops()[1]?.querySelector('svg')).not.toBeNull()
  })

  it('says a refusal with no reason given plainly', () => {
    const [engine, frontend] = TRACK_REFUSED
    render(<ChangeTrack stops={[engine as TrackStop, { ...(frontend as TrackStop), refused: undefined }]} />)
    expect(screen.getByText('Not merged')).toBeInTheDocument()
  })

  it('says its review once, for all of them', () => {
    render(<ChangeTrack stops={TRACK_READY} review={{ state: CheckState.Passed, by: [SONNET] }} />)
    expect(screen.getAllByText('Reviewed by')).toHaveLength(1)
  })

  it('puts what can be done under it, and why the last try failed', () => {
    render(<ChangeTrack stops={TRACK_READY} actions={<button type="button">Accept and merge both</button>} error="GitLab is down." />)
    expect(screen.getByRole('button', { name: 'Accept and merge both' })).toBeInTheDocument()
    expect(screen.getByRole('alert').textContent).toBe('GitLab is down.')
  })
})

describe('its files, by repository', () => {
  it('lists each repository’s files under its name, by their paths in it, and opens one by its path in the worktree', () => {
    const onOpenFile = vi.fn()
    render(<ChangeTrack stops={TRACK_READY} onOpenFile={onOpenFile} />)
    expect(screen.getByText('11 files')).toBeInTheDocument()
    const frontend = screen.getByRole('region', { name: 'frontend' })
    fireEvent.click(within(frontend).getByRole('button', { name: 'Open the diff of frontend/app/chat/page.tsx' }))
    expect(onOpenFile).toHaveBeenCalledWith('frontend/app/chat/page.tsx')
  })

  it('opens the whole diff from all of them, and one repository’s from its own', () => {
    const onReviewDiff = vi.fn()
    const onOpenFile = vi.fn()
    render(<ChangeTrack stops={TRACK_READY} onReviewDiff={onReviewDiff} onOpenFile={onOpenFile} diffKey="⌘D" />)
    fireEvent.click(screen.getByRole('button', { name: /Review the diff/ }))
    expect(onReviewDiff).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('radio', { name: 'engine' }))
    expect(screen.getByText('5 files')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'frontend' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Review the diff/ }))
    expect(onOpenFile).toHaveBeenCalledWith('engine/schema.graphql')
  })

  it('offers no choice of repository where only one changed files', () => {
    const [engine, frontend] = TRACK_READY
    render(<ChangeTrack stops={[engine as TrackStop, { ...(frontend as TrackStop), files: [] }]} />)
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
    expect(screen.getByText('5 files')).toBeInTheDocument()
  })

  it('keeps a file’s path as it is where its repository has no folder of its own', () => {
    const onOpenFile = vi.fn()
    const [engine, frontend] = TRACK_READY
    render(<ChangeTrack stops={[{ ...(engine as TrackStop), folder: undefined }, frontend as TrackStop]} onOpenFile={onOpenFile} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open the diff of engine/schema.graphql' }))
    expect(onOpenFile).toHaveBeenCalledWith('schema.graphql')
  })
})
