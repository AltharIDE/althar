import { render, screen, within } from '@testing-library/react'
import { userEvent } from 'storybook/test'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { type ArtifactRow, Artifacts, filtered } from '../src/screens/Artifacts/Artifacts'
import { BoardsControls, type BoardsTool, type BoardsView } from '../src/thread/Canvas/BoardsControls'
import { CanvasPagePlace, CanvasPanel } from '../src/thread/Canvas/CanvasPanel'

/*
 * A canvas of boards' own bar (ADR-104): its pages, every board or one at a
 * time with a step through them, its tools and its zoom, each press told at
 * once. The panel's room for what an artifact offers, its bar and a way
 * back, and its comments numbered as their pins. The Artifacts view as
 * cards, narrowed by Filter, sorted, and shown as the table again.
 */

const PAGES = [
  { name: 'Directions', boards: [{ name: 'A present first' }, { name: 'The card leads' }, { name: 'Phone' }] },
  { name: 'Receipt', boards: [{ name: 'Desktop' }] },
]

function Bar({ onZoom = () => {}, onPage = () => {} }: { onZoom?: (zoom: unknown) => void; onPage?: (page: number) => void }) {
  const [view, setView] = useState<BoardsView>('every')
  const [tool, setTool] = useState<BoardsTool>('point')
  const [board, setBoard] = useState({ page: 0, board: 0 })
  const all = PAGES.flatMap((page, p) => page.boards.map((_, b) => ({ page: p, board: b })))
  return (
    <BoardsControls
      pages={PAGES}
      view={view}
      page={0}
      board={board}
      zoom={0.183}
      tool={tool}
      onView={setView}
      onPage={onPage}
      onStep={(step) => {
        const at = all.findIndex((one) => one.page === board.page && one.board === board.board)
        setBoard(all[at + step] ?? board)
      }}
      onZoom={onZoom}
      onTool={setTool}
    />
  )
}

describe('a canvas of boards’ bar', () => {
  it('shows every board or one at a time, steps through every page’s boards, and says its zoom', async () => {
    render(<Bar />)
    expect(screen.getByRole('button', { name: 'Zoom: 18%' })).toBeInTheDocument()
    expect(screen.queryByText('1 of 4')).toBeNull()
    await userEvent.click(screen.getByRole('radio', { name: 'One board at a time' }))
    expect(screen.getByText('1 of 4')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Board before' })).toBeDisabled()
    for (const name of ['The card leads', 'Phone', 'Desktop']) {
      await userEvent.click(screen.getByRole('button', { name: 'Next board' }))
      expect(screen.getByText(name)).toBeInTheDocument()
    }
    expect(screen.getByText('4 of 4')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next board' })).toBeDisabled()
  })

  it('picks a tool, a page or every page, and a zoom', async () => {
    const onZoom = vi.fn()
    const onPage = vi.fn()
    render(<Bar onZoom={onZoom} onPage={onPage} />)
    const tools = screen.getByRole('toolbar', { name: 'Tools' })
    await userEvent.click(within(tools).getByRole('button', { name: 'Move around' }))
    expect(within(tools).getByRole('button', { name: 'Move around' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(tools).getByRole('button', { name: 'Point at a part' })).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(screen.getByRole('button', { name: 'Pages: Directions' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: /Every page/ }))
    expect(onPage).toHaveBeenLastCalledWith(-1)

    for (const [item, zoom] of [
      ['Zoom in', 'in'],
      ['Zoom out', 'out'],
      ['Fit every board', 'fit'],
      ['50%', 0.5],
      ['100%', 1],
      ['200%', 2],
    ] as const) {
      await userEvent.click(screen.getByRole('button', { name: 'Zoom: 18%' }))
      await userEvent.click(await screen.findByRole('menuitem', { name: new RegExp(`^${item}`) }))
      expect(onZoom).toHaveBeenLastCalledWith(zoom)
    }
  })

  it('names no pages where a canvas has only one', () => {
    render(
      <BoardsControls
        pages={[PAGES[0]!]}
        view="one"
        page={0}
        board={{ page: 0, board: 1 }}
        zoom={1}
        tool="use"
        onView={() => {}}
        onPage={() => {}}
        onStep={() => {}}
        onZoom={() => {}}
        onTool={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: /^Pages/ })).toBeNull()
    expect(screen.getByText('2 of 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use the boards' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('a canvas’s panel', () => {
  it('holds what the artifact offers, its own bar, a way back, and its comments numbered as their pins', async () => {
    const onBack = vi.fn()
    const onPick = vi.fn()
    render(
      <CanvasPanel
        name="gift-a-class"
        title="Gift a class"
        version={2}
        latest={2}
        onClose={() => {}}
        onBack={onBack}
        onCommentPick={onPick}
        extra={<button type="button">Save to repo</button>}
        bar={<div role="toolbar" aria-label="The boards’ own" />}
        fill
        comments={[
          { id: 'c1', version: 2, body: 'Bigger', place: 'h1 on Desktop', answered: false, n: 1 },
          { id: 'c2', version: 1, body: 'Calmer', place: 'Whole canvas', answered: true, answer: 'Done' },
        ]}
      >
        <CanvasPagePlace canvas="cnv_1">
          <p>Over the canvas</p>
        </CanvasPagePlace>
      </CanvasPanel>,
    )
    expect(screen.getByRole('button', { name: 'Save to repo' })).toBeInTheDocument()
    expect(screen.getByRole('toolbar', { name: 'The boards’ own' })).toBeInTheDocument()
    expect(screen.getByText('Over the canvas')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Pin 1' }))
    expect(onPick).toHaveBeenCalledWith('c1')
    expect(screen.queryByRole('button', { name: 'Pin 2' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(onBack).toHaveBeenCalled()
  })

  it('beside a conversation, has no head of its own: what it is floats on it, its name opening the artifact', async () => {
    const onOpen = vi.fn()
    const onClose = vi.fn()
    const { rerender } = render(
      <CanvasPanel name="flow" title="Sign-in flow" version={1} latest={1} onClose={onClose} onComment={() => {}} chip={{ onOpen }}>
        <p>The words</p>
      </CanvasPanel>,
    )
    const panel = screen.getByRole('complementary', { name: 'Sign-in flow' })
    expect(within(panel).queryByRole('heading')).toBeNull()
    await userEvent.click(within(panel).getByRole('button', { name: 'Open Sign-in flow' }))
    expect(onOpen).toHaveBeenCalled()
    expect(within(panel).getByRole('button', { name: 'Comment' })).toBeInTheDocument()
    await userEvent.click(within(panel).getByRole('button', { name: 'Close the panel' }))
    expect(onClose).toHaveBeenCalled()
    // A canvas whose own view draws it (a page, a canvas of boards) has none drawn over it here.
    rerender(
      <CanvasPanel name="flow" title="Sign-in flow" version={1} latest={1} onClose={onClose} chip={{ onOpen, drawnByView: true }} fill>
        <CanvasPagePlace canvas="cnv_1" />
      </CanvasPanel>,
    )
    expect(screen.queryByRole('button', { name: 'Open Sign-in flow' })).toBeNull()
  })

  it('in an artifact’s room, has no head of its own: its versions and actions are in the row it is given', async () => {
    const row = document.createElement('div')
    document.body.append(row)
    const onVersion = vi.fn()
    render(
      <CanvasPanel
        name="gift-a-class"
        title="Gift a class"
        version={2}
        latest={3}
        newer={3}
        onVersion={onVersion}
        onClose={() => {}}
        actionsIn={row}
        extra={<button type="button">Save to repo</button>}
        fill
      >
        <CanvasPagePlace canvas="cnv_1" />
      </CanvasPanel>,
    )
    const panel = screen.getByRole('complementary', { name: 'Gift a class' })
    // No head, no close: the room's row is the artifact's.
    expect(within(panel).queryByRole('button', { name: 'Close the panel' })).toBeNull()
    expect(within(panel).queryByText('gift-a-class')).toBeNull()
    expect(within(row).getByRole('button', { name: 'Save to repo' })).toBeInTheDocument()
    expect(within(row).getByText('v2 of 3')).toBeInTheDocument()
    // A newer version than the one shown is still said, over the canvas, with Show.
    expect(within(panel).getByText('v3 is out')).toBeInTheDocument()
    await userEvent.click(within(row).getByRole('button', { name: /Newer version/ }))
    expect(onVersion).toHaveBeenCalledWith(3)
    row.remove()
  })

  it('shows a pin’s number without pressing where nothing listens', () => {
    render(
      <CanvasPanel
        name="n"
        title="T"
        version={1}
        latest={1}
        onClose={() => {}}
        comments={[{ id: 'c1', version: 1, body: 'B', place: 'p', answered: false, n: 3 }]}
      />,
    )
    expect(screen.getByLabelText('Pin 3').tagName).toBe('SPAN')
  })
})

const row = (over: Partial<ArtifactRow> & Pick<ArtifactRow, 'id' | 'title'>): ArtifactRow => ({
  name: over.id,
  kind: 'boards',
  version: 1,
  by: 'Lead of Gift a class',
  when: '2h ago',
  at: '2026-11-21T10:00:00.000Z',
  openComments: 0,
  ...over,
})

const ROWS = [
  row({ id: 'gift', title: 'Gift a class', version: 4, openComments: 2, at: '2026-11-21T12:00:00.000Z' }),
  row({
    id: 'flow',
    title: 'Booking flow',
    kind: 'mermaid',
    saved: { repository: 'kiln', path: 'docs/flows/booking/', state: 'saved' },
    at: '2026-11-21T11:00:00.000Z',
  }),
  row({
    id: 'shot',
    title: 'A calmer checkout',
    kind: 'picture',
    picture: 'data:image/png;base64,AAAA',
    saved: { repository: 'kiln', path: 'design/calmer/', state: 'failed' },
  }),
  row({ id: 'new', title: 'Receipt', kind: 'html', saved: { repository: 'kiln', path: 'design/receipt/', state: 'saving' } }),
]

describe('the Artifacts view as cards', () => {
  it('shows a card each, with a picture or a drawing of its kind and its facts, and opens one pressed', async () => {
    const onOpen = vi.fn()
    render(<Artifacts canvases={ROWS} onOpen={onOpen} />)
    await userEvent.click(screen.getByRole('radio', { name: 'Cards' }))
    const cards = screen.getByRole('list', { name: 'The project’s artifacts' })
    expect(within(cards).getAllByRole('listitem')).toHaveLength(4)
    expect(within(cards).getByText('In git at kiln/docs/flows/booking/')).toBeInTheDocument()
    expect(within(cards).getByText('Saving failed')).toBeInTheDocument()
    expect(within(cards).getByText('Saving to kiln/design/receipt/')).toBeInTheDocument()
    expect(within(cards).getByLabelText('2 open comments')).toBeInTheDocument()
    expect(cards.querySelector('img[src="data:image/png;base64,AAAA"]')).not.toBeNull()
    await userEvent.click(within(cards).getByRole('button', { name: /^Booking flow/ }))
    expect(onOpen).toHaveBeenCalledWith(ROWS[1])
  })

  it('narrows by Filter, sorts, says when nothing matches, and shows as the table again', async () => {
    render(<Artifacts canvases={ROWS} onOpen={() => {}} />)
    await userEvent.click(screen.getByRole('radio', { name: 'Cards' }))
    const titles = () =>
      within(screen.getByRole('list', { name: 'The project’s artifacts' }))
        .getAllByRole('button')
        .map((one) => one.textContent ?? '')

    await userEvent.click(screen.getByRole('button', { name: 'Updated' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Name' }))
    expect(titles().map((one) => one.split(/(?=Boards|Diagram|Picture|Page)/)[0])).toEqual([
      'A calmer checkout',
      'Booking flow',
      'Gift a class',
      'Receipt',
    ])

    await userEvent.click(screen.getByRole('button', { name: 'Filter' }))
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'With open comments' }))
    await userEvent.keyboard('{Escape}')
    expect(titles()).toHaveLength(1)
    expect(screen.getByText('1 of 4')).toBeInTheDocument()

    await userEvent.type(screen.getByRole('searchbox', { name: 'Find an artifact' }), 'nothing like it')
    expect(screen.getByText('Nothing matches “nothing like it”.')).toBeInTheDocument()
    await userEvent.clear(screen.getByRole('searchbox', { name: 'Find an artifact' }))
    await userEvent.click(screen.getByRole('button', { name: 'Filter · 1' }))
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'With open comments' }))
    await userEvent.keyboard('{Escape}')

    await userEvent.click(screen.getByRole('radio', { name: 'List' }))
    expect(screen.getByRole('table', { name: 'The project’s artifacts' })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'The project’s artifacts' })).toBeNull()
  })

  it('keeps those saved, those commented on, or both', () => {
    expect(filtered(ROWS, { saved: true, commented: false }).map((one) => one.id)).toEqual(['flow', 'shot', 'new'])
    expect(filtered(ROWS, { saved: false, commented: true }).map((one) => one.id)).toEqual(['gift'])
    expect(filtered(ROWS, { saved: true, commented: true })).toEqual([])
  })
})
