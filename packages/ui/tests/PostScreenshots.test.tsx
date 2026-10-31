import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SHOT_AFTER, SHOT_BEFORE, SHOT_RUN } from '../src/fixtures/shots'
import { PostScreenshots, type PostScreenshotsProps, type PostScreenshotsShot } from '../src/outputs/PostScreenshots/PostScreenshots'

/* A task's screenshots, posted to its pull request as one comment, from the end of What it looks like's heading. */

const SHOTS: PostScreenshotsShot[] = [
  { ...SHOT_BEFORE, key: 'form', caption: 'The refund form' },
  { ...SHOT_AFTER, key: 'again', caption: 'The refund, sent again' },
  { ...(SHOT_RUN[0] ?? SHOT_AFTER), key: 'list', caption: 'The refunds list' },
]

const base: PostScreenshotsProps = {
  standing: 'unposted',
  pullRequest: 'PR #142',
  shots: SHOTS,
  leftOut: [],
  destination: 'a comment on acme/web #142',
}

/* the trigger's words for the standing it shows; the others stay hidden, keeping its width */
const line = () => screen.getByRole('button', { name: /PR #142/ })

describe('PostScreenshots', () => {
  it('says where the screenshots stand on the pull request', () => {
    const { rerender } = render(<PostScreenshots {...base} />)
    expect(line()).toHaveAccessibleName('Post to PR #142')
    rerender(<PostScreenshots {...base} standing="posted" />)
    expect(line()).toHaveAccessibleName('Posted to PR #142')
    rerender(<PostScreenshots {...base} standing="changed" changed={2} />)
    expect(line()).toHaveAccessibleName('Update PR #142 · 2 changed')
    rerender(<PostScreenshots {...base} standing="synced" />)
    expect(line()).toHaveAccessibleName('Synced to PR #142')
  })

  it('counts on the line only those left out that are among the screenshots', () => {
    render(<PostScreenshots {...base} standing="posted" leftOut={['list', 'gone-view']} />)
    expect(line()).toHaveAccessibleName('Posted to PR #142 · 1 left out')
  })

  it('posts with the ones the person unticked left out, in their order', () => {
    const onPost = vi.fn()
    render(<PostScreenshots {...base} leftOut={['list']} defaultOpen onPost={onPost} />)
    expect(screen.getByRole('checkbox', { name: 'Include The refunds list' })).not.toBeChecked()
    expect(screen.getByText(/→ a comment on acme\/web #142/)).toHaveTextContent('2 screenshots → a comment on acme/web #142')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include The refund form' }))
    expect(screen.getByText(/→ a comment/)).toHaveTextContent('1 screenshot → a comment on acme/web #142')
    fireEvent.click(screen.getByRole('button', { name: 'Post 1 to PR #142' }))
    expect(onPost).toHaveBeenCalledWith(['form', 'list'])
  })

  it('says to choose one when every screenshot is left out, and posts nothing', () => {
    const onPost = vi.fn()
    render(<PostScreenshots {...base} standing="posted" defaultOpen onPost={onPost} />)
    for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box)
    fireEvent.click(screen.getByRole('button', { name: 'Update PR #142' }))
    expect(onPost).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Choose at least one screenshot.')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include The refund form' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('has no press without onPost, and a link to the comment only where there is one', () => {
    const { rerender } = render(<PostScreenshots {...base} standing="posted" defaultOpen />)
    expect(screen.queryByRole('button', { name: /Update|Post \d/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    rerender(
      <PostScreenshots
        {...base}
        standing="posted"
        defaultOpen
        host="GitHub"
        commentUrl="https://github.com/acme/web/pull/142#issuecomment-1"
      />,
    )
    const link = screen.getByRole('link', { name: /^Open on GitHub ?\(opens in a new tab\)$/ })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
    rerender(<PostScreenshots {...base} standing="posted" defaultOpen host="GitHub" commentUrl="javascript:alert(1)" />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('shows why it didn’t post, and ignores presses while posting', () => {
    const onPost = vi.fn()
    render(<PostScreenshots {...base} defaultOpen posting error="GitHub didn’t answer." onPost={onPost} />)
    expect(screen.getByText('GitHub didn’t answer.')).toBeInTheDocument()
    const press = screen.getByRole('button', { name: 'Post 3 to PR #142' })
    expect(press).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(press)
    expect(onPost).not.toHaveBeenCalled()
  })
})
