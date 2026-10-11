import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PushState } from '../src/foundations/vocabulary'
import { PushRequest, pushRequestText } from '../src/thread/PushRequest/PushRequest'

const COMMITS = [
  { sha: '4e1c0a2', subject: 'Read Retry-After as seconds or a date' },
  { sha: '9b37f1d', subject: 'Name the retry option' },
]

describe('PushRequest', () => {
  it('lists what would go up, oldest first, and pushes it once pressed', () => {
    const onPush = vi.fn()
    render(<PushRequest where="PR #106" by="Opus 5" commits={COMMITS} onPush={onPush} />)
    const card = screen.getByRole('article', { name: 'Push to PR #106' })
    expect(card).toHaveTextContent('Opus 5 asks you to push')
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '4e1c0a2Read Retry-After as seconds or a date',
      '9b37f1dName the retry option',
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Push 2 commits to PR #106' }))
    expect(onPush).toHaveBeenCalledOnce()
  })

  it('counts every commit that would go up, where it lists only the first few', () => {
    render(<PushRequest where="PR #106" commits={COMMITS} count={14} onPush={() => {}} />)
    expect(screen.getByText('and 12 more')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Push 14 commits to PR #106' })).toHaveTextContent('Push 14 commits')
  })

  it('says the branch moved, and offers what is on it now', () => {
    render(<PushRequest where="PR #106" commits={COMMITS.slice(1)} moved onPush={() => {}} />)
    expect(screen.getByText(pushRequestText.moved)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Push 1 commit to PR #106' })).toBeVisible()
  })

  it('offers nothing to push where the branch has nothing new', () => {
    render(<PushRequest where="PR #106" commits={[]} count={0} moved onPush={() => {}} />)
    expect(screen.getByText('Nothing on the branch is new to PR #106 now.')).toBeVisible()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('is busy while it pushes, and has no Push without one to call', () => {
    const { rerender } = render(<PushRequest where="PR #106" commits={COMMITS} pushing onPush={() => {}} />)
    expect(screen.getByRole('button', { name: 'Push 2 commits to PR #106' })).toHaveAttribute('aria-busy', 'true')
    rerender(<PushRequest where="PR #106" commits={COMMITS} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('stays as a record once settled, with no Push', () => {
    const { rerender } = render(<PushRequest where="PR #106" commits={COMMITS} state={PushState.Pushed} onPush={() => {}} />)
    expect(screen.getByRole('article')).toHaveTextContent('Pushed · PR #106')
    expect(screen.queryByRole('button')).toBeNull()
    rerender(<PushRequest where="PR #106" commits={COMMITS} state={PushState.Replaced} onPush={() => {}} />)
    expect(screen.getByText(pushRequestText.replacedNote)).toBeVisible()
    rerender(<PushRequest where="PR #106" commits={COMMITS} state={PushState.Closed} onPush={() => {}} />)
    expect(screen.getByText('PR #106 isn’t open any more.')).toBeVisible()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
