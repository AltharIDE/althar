import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { DiffLineKind } from '../src/foundations/vocabulary'
import { diffOf, GONE_README_DIFF, NEW_README_DIFF, README_DIFF } from '../src/fixtures/diffs'
import { DocPanel } from '../src/thread/DocPanel/DocPanel'
import { markChanges, newTextOf, resolvePath } from '../src/thread/Markdown/changes'
import { Markdown } from '../src/thread/Markdown/Markdown'

/*
 * A markdown file's change, read from its whole-file diff: the file as it is
 * now, its added blocks, and what was taken out where it stood.
 */

describe('what a whole-file diff says of a markdown file', () => {
  it('is the file as it is now, with the blocks that gained a line marked, and each run taken out before the block it stood at', () => {
    const marked = markChanges(diffOf('\n # Title\n\n-Old words.\n+New words.\n\n Same.\n\n-Gone.\n\n Last.\n'))
    expect(marked?.source).toBe('# Title\n\nNew words.\n\nSame.\n\n\nLast.')
    // Blocks, as Markdown counts them: 0 the title, 1 the new words, 2 Same, 3 Last.
    expect([...(marked?.marks.added ?? [])]).toEqual([1])
    expect([...(marked?.marks.removed ?? [])]).toEqual([
      [1, ['Old words.']],
      [3, ['Gone.']],
    ])
  })

  it('puts text taken out from the end of the file at its end, and all of a deleted file before nothing', () => {
    const ending = markChanges(diffOf('\n # Title\n\n Body.\n-\n-Tail.\n'))
    expect([...(ending?.marks.removed ?? [])]).toEqual([[2, ['\nTail.']]])
    const gone = markChanges(GONE_README_DIFF)
    expect(gone?.source).toBe('')
    expect([...(gone?.marks.removed ?? [])]).toEqual([[0, ['# Hosting\n\nRefunds ran on one box.\n\nIt is gone now.']]])
  })

  it('marks nothing in a file that is new, which is all added and reads as a page', () => {
    const marked = markChanges(NEW_README_DIFF)
    expect(marked?.source.startsWith('# Retries')).toBe(true)
    expect(marked?.marks.added.size).toBe(0)
    expect(marked?.marks.removed.size).toBe(0)
  })

  it('reads the README of the stories: a section added, a heading rewritten, a paragraph and a section taken out', () => {
    const marked = markChanges(README_DIFF)
    expect(marked?.source.startsWith('# Refunds\n\nGives back')).toBe(true)
    expect(marked?.marks.added.size).toBeGreaterThan(5)
    const removed = [...(marked?.marks.removed.values() ?? [])].flat()
    expect(removed).toContain('Gives back what a merchant charged, in part or whole.')
    expect(removed).toContain('## Limits')
    expect(removed.some((text) => text.includes('Hosting notes'))).toBe(true)
  })

  it('marks nothing in a file that did not change', () => {
    const marked = markChanges(diffOf('\n # Title\n\n Body.\n'))
    expect(marked?.marks.added.size).toBe(0)
    expect(marked?.marks.removed.size).toBe(0)
  })

  it('gives nothing for a diff in hunks, whose lines say nothing of where a block stands', () => {
    expect(
      markChanges([
        { kind: DiffLineKind.Hunk, text: '@@ -40,2 +40,2 @@' },
        { kind: DiffLineKind.Context, old: 40, new: 40, text: 'x' },
        { kind: DiffLineKind.Added, new: 41, text: 'y' },
      ]),
    ).toBeNull()
  })

  it('drops the carriage return a Windows file ends its lines with', () => {
    expect(newTextOf(diffOf('\n # Title\r\n+More.\r\n'))).toBe('# Title\nMore.')
  })
})

describe('the paths a file names beside it', () => {
  it('goes from the file’s folder, along ./ and ../, without a query or an anchor', () => {
    expect(resolvePath('docs/decisions', '012.md')).toBe('docs/decisions/012.md')
    expect(resolvePath('docs/decisions', './img/a%20b.png?raw=1#top')).toBe('docs/decisions/img/a b.png')
    expect(resolvePath('docs/decisions', '../flow.svg')).toBe('docs/flow.svg')
    expect(resolvePath('', 'docs/flow.svg')).toBe('docs/flow.svg')
  })

  it('names none for an address, an anchor, a root path, or one that climbs out of the repository', () => {
    for (const href of ['https://example.com/a.png', 'mailto:a@b.c', '#section', '/abs/a.png', '../../out.png', '']) {
      expect(resolvePath('docs', href)).toBeNull()
    }
    expect(resolvePath('docs', '%E0%A4.png')).toBe('docs/%E0%A4.png')
  })
})

describe('a markdown file drawn with its change', () => {
  it('groups added blocks and what was taken out, each named for a screen reader, and draws the removed text as markdown', () => {
    const marked = markChanges(README_DIFF)
    if (marked === null) throw new Error('whole')
    render(<Markdown source={marked.source} marks={marked.marks} />)
    const added = screen.getAllByRole('group', { name: 'Added' })
    const removed = screen.getAllByRole('group', { name: 'Removed' })
    expect(added.length).toBeGreaterThan(0)
    expect(within(removed[0] as HTMLElement).getByText(/Gives back what a merchant charged/)).toBeInTheDocument()
    // What stays is no group: the code block under "Trying it".
    expect(screen.getByText("await refund(charge, { reason: 'duplicate' })").closest('[role=group]')).toBeNull()
    // A run of added blocks is one group, not a box each.
    expect(added.length).toBeLessThan(marked.marks.added.size)
  })

  it('draws a deleted file as what was taken out, and no marks at all as plain markdown', () => {
    const gone = markChanges(GONE_README_DIFF)
    if (gone === null) throw new Error('whole')
    const { unmount } = render(<Markdown source={gone.source} marks={gone.marks} />)
    expect(within(screen.getByRole('group', { name: 'Removed' })).getByRole('heading', { name: 'Hosting' })).toBeInTheDocument()
    unmount()
    render(<Markdown source="# Plain" />)
    expect(screen.queryByRole('group')).toBeNull()
  })

  it('shows only what falls in the blocks asked for', () => {
    render(
      <Markdown
        source={'one\n\ntwo\n\nthree'}
        to={2}
        marks={{
          added: new Set([1, 2]),
          removed: new Map([
            [0, ['before']],
            [3, ['after']],
          ]),
        }}
      />,
    )
    expect(screen.getByText('before')).toBeInTheDocument()
    expect(screen.getByText('two')).toBeInTheDocument()
    expect(screen.queryByText('three')).toBeNull()
    expect(screen.queryByText('after')).toBeNull()
  })
})

describe('what a file names beside it', () => {
  it('has the host draw its relative images, from the file’s folder, and leaves the rest as their words', () => {
    const image = vi.fn(({ path, alt }: { path: string; alt: string }) => <img src={`x://${path}`} alt={alt} />)
    render(
      <Markdown
        source={'![flow](../img/flow.png "A title") ![remote](https://example.com/a.png) ![out](../../../out.png)'}
        file={{ folder: 'docs/a', image }}
      />,
    )
    expect(screen.getByRole('img', { name: 'flow' })).toHaveAttribute('src', 'x://docs/img/flow.png')
    expect(image).toHaveBeenCalledWith({ path: 'docs/img/flow.png', alt: 'flow', title: 'A title' })
    expect(screen.getByText(/remote/)).toBeInTheDocument()
    expect(screen.getByText(/out/)).toBeInTheDocument()
    expect(screen.getAllByRole('img')).toHaveLength(1)
  })

  it('draws no image where the file has no host', () => {
    render(<Markdown source="![flow](flow.png)" />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('flow')).toBeInTheDocument()
  })

  it('opens the file a relative link names, and leaves addresses links and anchors alone', () => {
    const open = vi.fn()
    render(<Markdown source={'[next](./two.md#part) [web](https://example.com) [here](#part)'} file={{ folder: 'docs', open }} />)
    fireEvent.click(screen.getByRole('button', { name: 'next' }))
    expect(open).toHaveBeenCalledWith('docs/two.md')
    expect(screen.getByRole('link', { name: /web/ })).toHaveAttribute('href', 'https://example.com/')
    expect(screen.queryByRole('button', { name: 'here' })).toBeNull()
    expect(screen.getByText('here')).toBeInTheDocument()
  })

  it('shows a relative link as its words where the host opens nothing', () => {
    render(<Markdown source="[next](two.md)" file={{ folder: '' }} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('next')).toBeInTheDocument()
  })
})

describe('a document in the side panel', () => {
  it('has its pictures drawn from its folder where the host says where it is', () => {
    render(
      <DocPanel
        doc={{ path: 'docs/plan.md', body: '![flow](img/flow.png)' }}
        onClose={() => {}}
        file={{ folder: 'docs', image: ({ path, alt }) => <img src={`x://${path}`} alt={alt} /> }}
      />,
    )
    expect(screen.getByRole('img', { name: 'flow' })).toHaveAttribute('src', 'x://docs/img/flow.png')
  })
})
