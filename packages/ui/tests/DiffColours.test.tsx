import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { COMMENT_DIFF, diffOf } from '../src/fixtures/diffs'
import { Diff, sidesOf } from '../src/thread/Diff/Diff'

const comment = 'var(--code-comment, var(--syn-comment))'
const keyword = 'var(--code-keyword, var(--syn-keyword))'
const string = 'var(--code-string, var(--syn-string))'

describe('a diff’s two sides', () => {
  it('holds the old side’s unchanged and removed lines, the new side’s unchanged and added ones, and where each line is in them', () => {
    const sides = sidesOf(
      diffOf(`
 one
-two
+deux
+zwei
 three
`),
    )
    expect(sides.old).toBe('one\ntwo\nthree')
    expect(sides.new).toBe('one\ndeux\nzwei\nthree')
    expect(sides.oldAt).toEqual([0, 1, -1, -1, 2])
    expect(sides.newAt).toEqual([0, -1, 1, 2, 3])
  })

  it('runs a diff’s hunks together on each side, leaving their headers out', () => {
    const sides = sidesOf(
      diffOf(`
@@ -1,2 +1,2 @@
 a
-b
+B
@@ -40,2 +40,2 @@ function far() {
 y
+z
`),
    )
    expect(sides.old).toBe('a\nb\ny')
    expect(sides.new).toBe('a\nB\ny\nz')
    expect(sides.oldAt).toEqual([-1, 0, 1, -1, -1, 2, -1])
    expect(sides.newAt).toEqual([-1, 0, -1, 1, -1, 2, 3])
  })

  it('leaves a side that has no lines empty', () => {
    expect(sidesOf(diffOf('+only\n+added'))).toMatchObject({ old: '', new: 'only\nadded', oldAt: [-1, -1] })
  })
})

describe('a diff in its file’s colours', () => {
  it('colours a line inside a comment that opened before the change as comment, removed and added alike', async () => {
    render(<Diff lines={COMMENT_DIFF} path="src/charges/limit.ts" />)
    await waitFor(() => expect(screen.getByText(/Twenty a day/)).toHaveStyle({ color: comment }))
    expect(screen.getByText(/A partner's own limit/)).toHaveStyle({ color: comment })
    // and the lines of a template string as string, though the change cuts it
    expect(screen.getByText(/refunds every/)).toHaveStyle({ color: string })
  })

  it('marks the changed words over their colours, a mark holding whole pieces of tokens', async () => {
    const { container } = render(<Diff lines={diffOf('-const a = ⟦1⟧\n+const a = ⟦"one"⟧')} path="a.ts" />)
    await waitFor(() => expect(screen.getAllByText('const')[0]).toHaveStyle({ color: keyword }))
    const marks = Array.from(container.querySelectorAll('mark'))
    expect(marks.map((m) => m.textContent)).toEqual(['1', '"one"'])
    expect(screen.getByText('one').closest('mark')).toBe(marks[1])
    expect(screen.getByText('one')).toHaveStyle({ color: string })
    // what a screen reader hears and the text itself stay as they were
    expect(container.querySelector('[data-diff]')?.textContent).toBe('1- removedconst a = 11+ addedconst a = "one"')
  })

  it('shows plain text first, and plain for a file whose name says no language', () => {
    const { container, rerender } = render(<Diff lines={diffOf(' let fresh = 1')} path="first.ts" />)
    expect(container.querySelector('[data-diff] span[style]')).toBeNull()
    expect(screen.getByText('let fresh = 1')).toBeInTheDocument()
    rerender(<Diff lines={diffOf(' let fresh = 1')} path="NOTES" />)
    expect(container.querySelector('[data-diff] span[style]')).toBeNull()
  })

  it('colours a folded stretch once it is opened', async () => {
    const lines = diffOf([...Array.from({ length: 8 }, (_, i) => ` // line ${i + 1}`), '+const added = true', ' // last'].join('\n'))
    render(<Diff lines={lines} path="folded.ts" fold={2} />)
    await waitFor(() => expect(screen.getByText('const')).toHaveStyle({ color: keyword }))
    expect(screen.queryByText('// line 1')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /unchanged lines/ }))
    expect(screen.getByText('// line 1')).toHaveStyle({ color: comment })
  })
})
