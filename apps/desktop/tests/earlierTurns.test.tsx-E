import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { expect, it, vi } from 'vitest'
import { EarlierTurns } from '../src/renderer/shared/EarlierTurns'

it('loads once near the top, anchors the visible item and stops at the beginning', async () => {
  let resized!: () => void
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resized = callback
      }
      observe() {}
      disconnect() {}
    },
  )
  let done!: () => void
  const load = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        done = resolve
      }),
  )
  const view = (earlier: boolean, version: number) => (
    <div style={{ overflowY: 'auto' }} data-testid="scroll">
      <EarlierTurns earlier={earlier} load={load} loading={false} version={version} />
      <article data-item="one">Turn</article>
    </div>
  )
  const shown = render(view(true, 1))
  const box = screen.getByTestId('scroll')
  Object.defineProperty(box, 'clientHeight', { value: 600 })
  Object.defineProperty(box, 'scrollHeight', { value: 3000 })
  const item = screen.getByText('Turn')
  let top = 100
  vi.spyOn(item, 'getBoundingClientRect').mockImplementation(() => ({ top, bottom: top + 100 }) as DOMRect)
  fireEvent.scroll(box)
  fireEvent.scroll(box)
  expect(load).toHaveBeenCalledTimes(1)
  await act(async () => done())
  top = 400
  shown.rerender(view(false, 2))
  expect(box.scrollTop).toBe(300)
  fireEvent.scroll(box)
  expect(load).toHaveBeenCalledTimes(1)
  top = 450
  act(() => resized())
  expect(box.scrollTop).toBe(350)
  vi.unstubAllGlobals()
})
it('offers retry after failure', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
  render(
    <div style={{ overflowY: 'auto' }} data-testid="scroll">
      <EarlierTurns earlier load={load} loading={false} version={1} />
    </div>,
  )
  const box = screen.getByTestId('scroll')
  Object.defineProperty(box, 'clientHeight', { value: 600 })
  Object.defineProperty(box, 'scrollHeight', { value: 3000 })
  fireEvent.scroll(box)
  fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
})

it('checks a short initial page even when there is no scrollbar to move', async () => {
  const load = vi.fn(() => new Promise<void>(() => {}))
  render(
    <div style={{ overflowY: 'auto' }} data-testid="scroll">
      <EarlierTurns earlier load={load} loading={false} version={1} />
    </div>,
  )
  const box = screen.getByTestId('scroll')
  Object.defineProperty(box, 'clientHeight', { value: 600 })
  Object.defineProperty(box, 'scrollHeight', { value: 100 })
  await waitFor(() => expect(load).toHaveBeenCalledTimes(1))
})

it('loads consecutive short pages through the beginning without scroll or resize events', async () => {
  const pending: Array<() => void> = []
  const load = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        pending.push(resolve)
      }),
  )
  function ShortThread() {
    const [page, setPage] = useState(0)
    return (
      <div style={{ overflowY: 'auto' }} data-testid="scroll">
        <EarlierTurns
          earlier={page < 3}
          version={page}
          loading={false}
          load={async () => {
            await load()
            setPage((value) => value + 1)
          }}
        />
        <span>Page {page}</span>
      </div>
    )
  }
  render(<ShortThread />)
  const box = screen.getByTestId('scroll')
  Object.defineProperty(box, 'clientHeight', { value: 600 })
  Object.defineProperty(box, 'scrollHeight', { value: 100 })
  for (let page = 1; page <= 3; page++) {
    await waitFor(() => expect(load).toHaveBeenCalledTimes(page))
    await act(async () => pending.shift()!())
  }
  await screen.findByText('Page 3')
  fireEvent.scroll(box)
  expect(load).toHaveBeenCalledTimes(3)
})
