import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { DiffLineKind } from '../src/foundations/vocabulary'
import { README_DIFF } from '../src/fixtures/diffs'
import { ChangeView, type ChangeViewProps, type ViewedFile } from '../src/outputs/ChangeView/ChangeView'

/*
 * A task's change over the whole window: the files down the side, the one
 * you're on beside them, and j and k to go through them.
 */

const FILES: ViewedFile[] = [
  { path: 'src/charges/limit.ts', status: 'modified', add: 14, del: 3 },
  { path: 'src/refunds/router.ts', status: 'modified', add: 12, del: 1 },
]

const open = (more: Partial<ChangeViewProps> = {}) => {
  const onSelect = vi.fn()
  render(
    <ChangeView
      branch="althar/mer-231-rate-limit-refunds"
      files={FILES}
      selected="src/refunds/router.ts"
      onSelect={onSelect}
      view={{ state: 'ready', lines: [] }}
      onClose={() => {}}
      {...more}
    />,
  )
  return { onSelect, view: screen.getByRole('dialog', { name: 'Changes' }) }
}

describe('the change over the whole window', () => {
  it('names the branch alone where it has nowhere to go yet, and counts a single file', () => {
    open({ files: FILES.slice(0, 1), selected: null })
    expect(screen.getByText('althar/mer-231-rate-limit-refunds')).toBeInTheDocument()
    expect(screen.getByText('1 file')).toBeInTheDocument()
  })

  it('says nothing has changed in a file whose diff is empty', () => {
    open()
    expect(screen.getByText('Nothing has changed yet.')).toBeInTheDocument()
  })

  it('says why a diff could not be read, with no way to try again where none is given', () => {
    open({ view: { state: 'failed', message: 'The worktree is gone.' } })
    expect(screen.getByRole('alert')).toHaveTextContent('The worktree is gone.')
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })
})

describe('going through the files from the keyboard', () => {
  it('stops at the last file, and takes no keys held with a modifier or meant for something else', () => {
    const { onSelect, view } = open()
    fireEvent.keyDown(view, { key: 'j' })
    fireEvent.keyDown(view, { key: 'k', metaKey: true })
    fireEvent.keyDown(view, { key: 'x' })
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.keyDown(view, { key: 'ArrowUp' })
    expect(onSelect).toHaveBeenCalledWith('src/charges/limit.ts')
  })

  it('has nothing to go through when nothing changed', () => {
    const { onSelect, view } = open({ files: [], selected: null })
    fireEvent.keyDown(view, { key: 'j' })
    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('a markdown file in the change', () => {
  const MARKDOWN: ViewedFile[] = [
    { path: 'README.md', status: 'modified', add: 36, del: 7 },
    { path: 'docs/two.md', status: 'modified', add: 1, del: 0 },
    { path: 'src/refunds/router.ts', status: 'modified', add: 12, del: 1 },
  ]
  const page = (more: Partial<ChangeViewProps> = {}) =>
    open({ files: MARKDOWN, selected: 'README.md', view: { state: 'ready', lines: README_DIFF, whole: true }, ...more })

  it('opens as a page, with what changed marked, and Source a click away', () => {
    page()
    expect(screen.getByRole('radio', { name: /Rendered/ })).toBeChecked()
    expect(screen.getByRole('heading', { name: 'Limits and reasons' })).toBeInTheDocument()
    expect(screen.getAllByRole('group', { name: 'Added' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('group', { name: 'Removed' }).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('radio', { name: /Source/ }))
    expect(screen.queryByRole('heading', { name: 'Limits and reasons' })).toBeNull()
    expect(screen.getByRole('group', { name: 'README.md' })).toBeInTheDocument()
  })

  it('goes between the two on M, and keeps the choice for that file only', () => {
    const { view } = page()
    fireEvent.keyDown(view, { key: 'm' })
    expect(screen.getByRole('radio', { name: /Source/ })).toBeChecked()
    fireEvent.keyDown(view, { key: 'm', metaKey: true })
    expect(screen.getByRole('radio', { name: /Source/ })).toBeChecked()
    fireEvent.keyDown(view, { key: 'm' })
    expect(screen.getByRole('radio', { name: /Rendered/ })).toBeChecked()
  })

  it('has no two ways for a file that is not markdown, one in hunks, or one with nothing to show', () => {
    const { view } = open({ view: { state: 'ready', lines: README_DIFF } })
    expect(screen.queryByRole('radio', { name: /Rendered/ })).toBeNull()
    fireEvent.keyDown(view, { key: 'm' })
    expect(screen.queryByRole('radio')).toBeNull()
  })

  it('stays a diff for a markdown file read in hunks, cut short, or with no lines', () => {
    page({ view: { state: 'ready', lines: README_DIFF, truncated: true } })
    expect(screen.queryByRole('radio', { name: /Rendered/ })).toBeNull()
    expect(screen.getByRole('group', { name: 'README.md' })).toBeInTheDocument()
  })

  it('stays a diff where the host does not say its lines are the whole file, though they start at its first line', () => {
    page({ view: { state: 'ready', lines: README_DIFF } })
    expect(screen.queryByRole('radio', { name: /Rendered/ })).toBeNull()
    expect(screen.getByRole('group', { name: 'README.md' })).toBeInTheDocument()
  })

  it('goes to the source for a finding, after the page was chosen', () => {
    const finding = (id: string, line: number) => ({
      id,
      path: 'README.md',
      line,
      weight: 'major' as const,
      state: 'open' as const,
      title: `Finding ${id}`,
      claim: 'It says limits.',
      reason: null,
      commit: null,
    })
    const props = {
      files: MARKDOWN,
      selected: 'README.md',
      onSelect: () => {},
      view: { state: 'ready' as const, lines: README_DIFF, whole: true },
      onClose: () => {},
      findings: [finding('f1', 3), finding('f2', 9)],
    }
    const { rerender } = render(<ChangeView branch="b" {...props} finding={null} />)
    // The page, as it opens with no finding being looked at; the person keeps it as the page.
    fireEvent.click(screen.getByRole('radio', { name: /Source/ }))
    fireEvent.click(screen.getByRole('radio', { name: /Rendered/ }))
    expect(screen.getByRole('radio', { name: /Rendered/ })).toBeChecked()
    // Going to a finding, as [ and ] do, shows the source, where its note sits under its line.
    rerender(<ChangeView branch="b" {...props} finding="f2" />)
    expect(screen.getByRole('radio', { name: /Source/ })).toBeChecked()
  })

  it('goes to a file the markdown links to: a file of the change is picked, another is the host’s to open', () => {
    const hostOpen = vi.fn()
    const { onSelect } = page({
      view: {
        state: 'ready',
        whole: true,
        lines: [{ kind: DiffLineKind.Context, old: 1, new: 1, text: '[two](docs/two.md) and [code](src/other.ts)' }],
      },
      markdown: { open: hostOpen },
    })
    fireEvent.click(screen.getByRole('button', { name: 'two' }))
    expect(onSelect).toHaveBeenCalledWith('docs/two.md')
    fireEvent.click(screen.getByRole('button', { name: 'code' }))
    expect(hostOpen).toHaveBeenCalledWith('src/other.ts')
  })

  it('draws a picture the host gives it, from the file’s folder', () => {
    page({
      files: [{ path: 'docs/guide.md', status: 'added', add: 1, del: 0 }],
      selected: 'docs/guide.md',
      view: { state: 'ready', whole: true, lines: [{ kind: DiffLineKind.Added, new: 1, text: '![flow](img/flow.png)' }] },
      markdown: { image: ({ path, alt }) => <img src={`x://${path}`} alt={alt} /> },
    })
    expect(within(screen.getByRole('region', { name: 'docs/guide.md' })).getByRole('img', { name: 'flow' })).toHaveAttribute(
      'src',
      'x://docs/img/flow.png',
    )
  })

  it('opens at the source where a finding’s note is in the file, which sits under a line', () => {
    page({
      findings: [
        {
          id: 'f1',
          path: 'README.md',
          line: 3,
          weight: 'major',
          state: 'open',
          title: 'The heading is wrong',
          claim: 'It says limits.',
          reason: null,
          commit: null,
        },
      ],
      finding: 'f1',
    })
    expect(screen.getByRole('radio', { name: /Source/ })).toBeChecked()
  })
})
