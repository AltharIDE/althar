import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { ChangeSummary, Evidence, ScreenshotsOnChange, ThreadSnapshot } from '@althar/contracts'

import { Outputs } from '../src/renderer/features/task/Outputs'
import { change, fakeClient, items, snapshot } from './fixtures'
import { withServices } from './render'

/*
 * A task's screenshots on its pull request, from its Outputs (ADR-076): a
 * quiet line beside What it looks like, where its host takes pictures,
 * which opens what Outputs shows, each to keep or leave out, and posts it.
 */

const URL = 'https://github.com/meridian/api/pull/1'
const PICTURE = { mediaType: 'image/png', bytes: 2048, width: 1440, height: 900, name: null, unkept: null }
const shot = (caption: string, digest: string): Evidence => ({
  kind: 'screenshot',
  caption,
  picture: { ...PICTURE, digest: digest.repeat(64) },
  command: null,
  exit: null,
  text: null,
  dropped: 0,
})

const standing = (over: Partial<ScreenshotsOnChange> = {}): ScreenshotsOnChange => ({
  standing: 'unposted',
  changed: 2,
  synced: false,
  leftOut: [],
  commentUrl: null,
  failed: null,
  ...over,
})

const task = (pr: Partial<ChangeSummary>): ThreadSnapshot =>
  snapshot({
    session: null,
    items: [items.step({ evidence: [shot('A1 · The retry button', 'a'), shot('A2 · The error line', 'b')] })],
    task: {
      ...snapshot().task,
      phase: 'ready',
      kind: 'change',
      madeChangeAt: null,
      changes: [change({ url: URL, number: 1, repository: 'meridian/api', draft: false, ...pr })],
    },
  })

const show = (snap: ThreadSnapshot, onPostScreenshots?: (url: string, leftOut: ReadonlyArray<string>) => Promise<string | null>) => {
  withServices(
    <Outputs
      snapshot={snap}
      pending={false}
      error={null}
      onAccept={vi.fn()}
      onMergeHere={vi.fn()}
      onOpenChange={vi.fn()}
      onPush={vi.fn()}
      onMarkReady={vi.fn()}
      onOpenFile={vi.fn()}
      onPushBranch={vi.fn()}
      onConnect={vi.fn()}
      onReplace={vi.fn()}
      onBringIn={vi.fn()}
      {...(onPostScreenshots === undefined ? {} : { onPostScreenshots })}
    />,
    fakeClient().client,
  )
}

describe('a task’s screenshots on its pull request, from its Outputs', () => {
  it('posts what Outputs shows, leaving out what the person unticks, and closes once they’re up', async () => {
    const post = vi.fn(async () => null)
    show(task({ screenshots: standing() }), post)
    await userEvent.click(screen.getByRole('button', { name: /^Post to PR #1/ }))
    const boxes = await screen.findAllByRole('checkbox')
    expect(boxes).toHaveLength(2)
    await userEvent.click(boxes[1] as HTMLElement)
    await userEvent.click(screen.getByRole('button', { name: 'Post 1 to PR #1' }))
    expect(post).toHaveBeenCalledWith(URL, ['A2'])
    await waitFor(() => expect(screen.queryAllByRole('checkbox')).toHaveLength(0))
  })

  it('keeps the sheet open, saying what went wrong, where posting failed', async () => {
    show(task({ screenshots: standing() }), vi.fn(async () => 'GitHub refused (403): Resource not accessible by integration.'))
    await userEvent.click(screen.getByRole('button', { name: /^Post to PR #1/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Post 2 to PR #1' }))
    expect(await screen.findByText('GitHub refused (403): Resource not accessible by integration.')).toBeTruthy()
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  })

  it('says where they stand: changed since, synced, and what is left out', () => {
    show(task({ screenshots: standing({ standing: 'changed', changed: 1, leftOut: ['A2'], commentUrl: `${URL}#issuecomment-9` }) }), vi.fn())
    expect(screen.getByRole('button', { name: /Update PR #1 · 1 changed/ }).textContent).toContain('1 left out')
  })

  it('says it is synced where the rules post them on their own', () => {
    show(task({ screenshots: standing({ standing: 'posted', synced: true, changed: 0 }) }), vi.fn())
    expect(screen.getByRole('button', { name: /^Synced to PR #1/ })).toBeTruthy()
  })

  it('offers nothing where the host takes no pictures, or nothing posts them', () => {
    show(task({}), vi.fn())
    expect(screen.queryByRole('button', { name: /PR #1/ })).toBeNull()
    show(task({ screenshots: standing() }))
    expect(within(document.body).queryByRole('button', { name: /^Post to PR #1/ })).toBeNull()
  })
})
