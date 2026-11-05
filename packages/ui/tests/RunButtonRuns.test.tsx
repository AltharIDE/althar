import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { type RunTarget, RunButton, shortCommand, statusOf } from '../src/chrome/RunButton/RunButton'

const target = (id: string, more: Partial<RunTarget> = {}): RunTarget => ({
  id,
  name: id,
  command: `bun run ${id}`,
  from: 'agent',
  ...more,
})
const handlers = () => ({ onRun: vi.fn(), onStop: vi.fn(), onOpen: vi.fn(), onClear: vi.fn(), onAdd: vi.fn(), onEdit: vi.fn() })

/* The open list's lines, by their names, in order. */
const names = () =>
  within(screen.getByRole('dialog', { name: 'What it runs' }))
    .getAllByTitle(/^bun run /)
    .map((one) => one.textContent)

describe('the Run button', () => {
  it('only opens the list on a press: nothing runs until it is picked', () => {
    const on = handlers()
    render(<RunButton targets={[target('dev'), target('test')]} {...on} />)
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    expect(on.onRun).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Run dev' }))
    expect(on.onRun).toHaveBeenCalledWith('dev')
  })

  it('always says Run, with how many run or failed after it', () => {
    const { rerender } = render(
      <RunButton targets={[target('dev', { run: { state: 'running' } }), target('test', { run: { state: 'running' } })]} {...handlers()} />,
    )
    expect(screen.getByRole('button', { name: /^Run\s*2 running$/ })).toBeInTheDocument()
    rerender(
      <RunButton
        targets={[target('dev', { run: { state: 'running' } }), target('test', { run: { state: 'ended', code: 1 } })]}
        {...handlers()}
      />,
    )
    expect(screen.getByRole('button', { name: /^Run\s*1 failed$/ })).toBeInTheDocument()
    rerender(<RunButton targets={[target('dev', { run: { state: 'fetching' } })]} {...handlers()} />)
    expect(screen.getByRole('button', { name: /^Run\s*Starting$/ })).toBeInTheDocument()
  })

  it('counts a failure as one that couldn’t be fetched or ended by itself, not well; not one stopped or finished', () => {
    expect(
      statusOf([
        target('a', { run: { state: 'ended', code: 1 } }),
        target('b', { run: { state: 'ended', code: null } }),
        target('c', { run: { state: 'unfetched', why: 'offline' } }),
        target('d', { run: { state: 'ended', code: 0 } }),
        target('e', { run: { state: 'ended', code: 143, stopped: true } }),
        target('f', { run: { state: 'running' } }),
        target('g', { run: { state: 'starting' } }),
      ]),
    ).toEqual({ failed: 3, live: 1, coming: true })
  })
})

describe('its list', () => {
  it('lists what runs first, in an order fixed while it is open', () => {
    const on = handlers()
    const idle = [target('dev'), target('test'), target('docs', { run: { state: 'running', url: 'localhost:4321' } })]
    const { rerender } = render(<RunButton targets={idle} defaultOpen {...on} />)
    expect(names()).toEqual(['docs', 'dev', 'test'])
    rerender(<RunButton targets={[idle[0]!, target('test', { run: { state: 'starting' } }), idle[2]!]} defaultOpen {...on} />)
    expect(names()).toEqual(['docs', 'dev', 'test'])
  })

  it('says each state in place, with its way out', () => {
    const on = handlers()
    render(
      <RunButton
        defaultOpen
        targets={[
          target('dev', { run: { state: 'running', url: 'localhost:5310', since: '3m' } }),
          target('test', { run: { state: 'ended', code: 1, since: '8m ago' } }),
          target('pr', { run: { state: 'unfetched', why: 'Althar couldn’t reach origin.' } }),
          target('lint', { run: { state: 'ended', stopped: true, since: 'just now' } }),
          target('docs', { run: { state: 'fetching' } }),
        ]}
        {...on}
      />,
    )
    fireEvent.click(screen.getByText('localhost:5310'))
    expect(on.onOpen).toHaveBeenCalledWith('dev')
    fireEvent.click(screen.getByRole('button', { name: 'Stop dev' }))
    expect(on.onStop).toHaveBeenCalledWith('dev')
    expect(screen.getByText('Exited 1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Run again' }))
    expect(on.onRun).toHaveBeenCalledWith('test')
    expect(screen.getByText('Althar couldn’t reach origin.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(on.onRun).toHaveBeenCalledWith('pr')
    fireEvent.click(screen.getByRole('button', { name: 'Clear test' }))
    expect(on.onClear).toHaveBeenCalledWith('test')
    expect(screen.getByText('Stopped just now')).toBeInTheDocument()
    expect(screen.getByText('Fetching…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Stop docs' })).toBeNull()
  })

  it('opens a long list on a field: it finds, and Enter runs the one pointed at', async () => {
    const on = handlers()
    const many = Array.from({ length: 12 }, (_, n) => target(`app${n}`))
    render(<RunButton targets={many} defaultOpen {...on} />)
    const field = screen.getByRole('textbox', { name: 'Find something to run' })
    await waitFor(() => expect(field).toHaveFocus())
    fireEvent.change(field, { target: { value: 'app1' } })
    expect(names()).toEqual(['app1', 'app10', 'app11'])
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(on.onRun).toHaveBeenCalledWith('app10')
    fireEvent.change(field, { target: { value: 'nothing' } })
    expect(screen.getByText('Nothing to run matches “nothing”')).toBeInTheDocument()
  })

  it('has no field for a short list', () => {
    render(<RunButton targets={[target('dev')]} defaultOpen {...handlers()} />)
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('adds and edits from its foot, closing as it does', () => {
    const on = handlers()
    render(<RunButton targets={[target('dev')]} defaultOpen {...on} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add something to run' }))
    expect(on.onAdd).toHaveBeenCalledWith('type')
    expect(screen.queryByRole('dialog', { name: 'What it runs' })).toBeNull()
  })
})

describe('the short form of a command', () => {
  it('is the last setup step where the command is nothing else', () => {
    expect(shortCommand('export A=1; cd app')).toBe('cd app')
  })

  it('is the command as it was where it has no parts', () => {
    expect(shortCommand(' ; ')).toBe(';')
  })
})
