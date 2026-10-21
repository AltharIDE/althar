import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Diverged, type DivergedProps } from '../src/outputs/Diverged/Diverged'

/* A branch its pull request won't take with a plain push, in a sentence, with what puts it right. */

const diverged = (more: Partial<DivergedProps> = {}) => {
  const props: DivergedProps = {
    kind: 'rewritten',
    local: 1,
    onPullRequest: 3,
    named: 'PR #124',
    onReplace: vi.fn(),
    onMerge: vi.fn(),
    ...more,
  }
  const { rerender } = render(<Diverged {...props} />)
  return { ...props, again: (next: Partial<DivergedProps>) => rerender(<Diverged {...props} {...next} />) }
}

describe('a branch its pull request won’t take', () => {
  it('says one new commit replaces those pushed', () => {
    diverged()
    expect(
      screen.getByText('This branch was rewritten since it was pushed: 1 new commit replaces 3 on the pull request.'),
    ).toBeInTheDocument()
  })

  it('counts the commits pushed from elsewhere', () => {
    diverged({ kind: 'moved', onPullRequest: 2, pullRequest: 'the merge request' })
    expect(
      screen.getByText('The merge request has 2 commits pushed from elsewhere that aren’t on this branch, so it won’t take a plain push.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bring in the merge request’s commits' })).toBeInTheDocument()
  })

  it('waits to be asked to replace while another action is under way', () => {
    diverged({ locked: true })
    expect(screen.getByRole('button', { name: 'Replace the pull request’s commits' })).toBeDisabled()
  })

  it('asks before replacing them with the branch, where nothing new was committed', () => {
    const { onReplace } = diverged({ local: 0 })
    fireEvent.click(screen.getByRole('button', { name: 'Replace the pull request’s commits' }))
    expect(screen.getByText(/^Replace the 3 commits on PR #124 with the branch here\?/)).toBeInTheDocument()
    expect(onReplace).not.toHaveBeenCalled()
  })

  it('holds the confirming press while locked, shows it busy while replacing, then is back to the sentence and both ways out', () => {
    const { again } = diverged()
    fireEvent.click(screen.getByRole('button', { name: 'Replace the pull request’s commits' }))
    again({ locked: true })
    expect(screen.getByRole('button', { name: 'Replace them' })).toBeDisabled()
    again({ replacing: true, locked: true })
    expect(screen.getByRole('button', { name: 'Replace them' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'Replace them' })).toHaveAttribute('aria-busy', 'true')
    again({ replacing: false, locked: false })
    expect(screen.queryByRole('button', { name: 'Replace them' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ask the lead to merge instead' })).toBeInTheDocument()
  })
})
