import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import { TerminalView } from '../src/chrome/TerminalView/TerminalView'
import { TerminalSession } from '../src/chrome/TerminalView/session'

it('finds terminal output, changes match options and returns focus to the terminal on Escape', () => {
  const session = new TerminalSession({ onData: vi.fn(), onResize: vi.fn() })
  const mount = vi.spyOn(session, 'mount').mockImplementation(() => {})
  const unmount = vi.spyOn(session, 'unmount').mockImplementation(() => {})
  const focus = vi.spyOn(session, 'focus').mockImplementation(() => {})
  const find = vi.spyOn(session, 'find').mockReturnValue(true)
  const again = vi.spyOn(session, 'findAgain').mockReturnValue(true)
  const end = vi.spyOn(session, 'endFind').mockImplementation(() => {})
  vi.spyOn(session.term, 'getSelection').mockReturnValue('first line\nsecond line')
  const view = render(<TerminalView session={session} />)
  try {
    expect(mount).toHaveBeenCalledWith(expect.any(HTMLElement))
    expect(focus).not.toHaveBeenCalled()
    act(() => session.act('find'))
    const bar = within(screen.getByRole('search', { name: 'Find in the terminal' }))
    const field = bar.getByRole('textbox')
    expect(field).toHaveFocus()
    expect(field).toHaveValue('first line')
    expect(bar.getByText('No results')).toBeInTheDocument()
    expect(bar.getByRole('button', { name: 'Next match' })).toBeDisabled()

    fireEvent.change(field, { target: { value: 'result' } })
    for (const name of ['Match case', 'Match whole word', 'Use regular expression'])
      fireEvent.click(bar.getByRole('button', { name, pressed: false }))
    const options = { caseSensitive: true, wholeWord: true, regex: true }
    expect(find).toHaveBeenLastCalledWith('result', options)

    act(() => session.onFindResults?.({ index: -1, count: 2 }))
    expect(bar.getByText('2 found')).toBeInTheDocument()
    act(() => session.onFindResults?.({ index: 0, count: 2 }))
    expect(bar.getByText('1 of 2')).toBeInTheDocument()
    fireEvent.click(bar.getByRole('button', { name: 'Next match' }))
    expect(again).toHaveBeenLastCalledWith(options, false)
    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true })
    expect(again).toHaveBeenLastCalledWith(options, true)
    fireEvent.click(bar.getByRole('button', { name: 'Previous match' }))
    expect(again).toHaveBeenCalledTimes(3)

    act(() => session.act('find'))
    expect(field).toHaveFocus()
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(screen.queryByRole('search')).toBeNull()
    expect(end).toHaveBeenCalledOnce()
    expect(focus).toHaveBeenCalledOnce()
    expect(session.onFindResults).toBeUndefined()
  } finally {
    view.unmount()
    session.dispose()
  }
  expect(unmount).toHaveBeenCalledOnce()
  expect(session.onFind).toBeUndefined()
})
