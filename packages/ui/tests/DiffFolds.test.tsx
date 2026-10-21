import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DiffLineKind } from '../src/foundations/vocabulary'
import { Diff, type DiffLine, diffText } from '../src/thread/Diff/Diff'

const context = (n: number): DiffLine => ({ kind: DiffLineKind.Context, old: n, new: n, text: `line ${n}` })
const rows = (container: HTMLElement) =>
  Array.from(container.querySelector('[data-diff]')!.children).map((row) =>
    row.tagName === 'BUTTON' ? `[${row.textContent}]` : row.textContent,
  )

describe('a diff read in hunks', () => {
  it('marks where lines are skipped, with the function git names there, and drops a header that opens the file', () => {
    const lines: DiffLine[] = [
      { kind: DiffLineKind.Hunk, text: '@@ -1,2 +1,2 @@' },
      context(1),
      { kind: DiffLineKind.Removed, old: 2, text: 'old two' },
      { kind: DiffLineKind.Added, new: 2, text: 'new two' },
      { kind: DiffLineKind.Hunk, text: '@@ -40,3 +40,3 @@ function checkout() {' },
      context(40),
    ]
    const { container } = render(<Diff lines={lines} fold={3} oldNumbers />)
    expect(rows(container)).toEqual(['11line 1', '2- removedold two', '2+ addednew two', '⋯function checkout() {', '4040line 40'])
  })

  it('marks a gap before the first hunk where it starts past the file’s top, and reads a header it can’t parse as from the top', () => {
    const { container, rerender } = render(<Diff lines={[{ kind: DiffLineKind.Hunk, text: '@@ -12,3 +12,4 @@' }, context(12)]} fold={3} />)
    expect(rows(container)).toEqual(['⋯', '12line 12'])
    rerender(<Diff lines={[{ kind: DiffLineKind.Hunk, text: 'Binary files differ' }, context(1)]} fold={3} />)
    expect(rows(container)).toEqual(['1line 1'])
  })
})

describe('a whole file’s diff, folded', () => {
  const file: DiffLine[] = [
    ...Array.from({ length: 6 }, (_, i) => context(i + 1)),
    { kind: DiffLineKind.Added, new: 7, text: 'const retries = 3', changed: ['', 'retries', '3'] },
    ...Array.from({ length: 6 }, (_, i) => context(i + 8)),
  ]

  it('folds the unchanged lines but those beside a change, and opens a fold in place', () => {
    const { container } = render(<Diff lines={file} fold={2} label="checkout.ts" />)
    expect(screen.getByRole('group', { name: 'checkout.ts' })).toBeInTheDocument()
    expect(rows(container)).toEqual([
      '[Show 4 unchanged lines]',
      '5line 5',
      '6line 6',
      '7+ addedconst retries = 3',
      '8line 8',
      '9line 9',
      '[Show 4 unchanged lines]',
    ])
    fireEvent.click(screen.getAllByRole('button', { name: 'Show 4 unchanged lines' })[1]!)
    expect(rows(container).slice(-4)).toEqual(['10line 10', '11line 11', '12line 12', '13line 13'])
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('marks every changed stretch in a line, passing over an empty one', () => {
    const { container } = render(<Diff lines={file} fold={2} />)
    expect(Array.from(container.querySelectorAll('mark')).map((mark) => mark.textContent)).toEqual(['retries', '3'])
  })

  it('says a single unchanged line in the singular', () => {
    expect(diffText.unchanged(1)).toBe('Show 1 unchanged line')
    expect(diffText.unchanged(2)).toBe('Show 2 unchanged lines')
  })
})
