import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { type RunTarget, RunButton, shortCommand } from '../src/chrome/RunButton/RunButton'

const target = (id: string, more: Partial<RunTarget> = {}): RunTarget => ({
  id,
  name: id,
  command: `bun run ${id}`,
  where: 'main',
  from: 'agent',
  ...more,
})
const handlers = () => ({ onRun: vi.fn(), onStop: vi.fn(), onOpen: vi.fn(), onAdd: vi.fn(), onEdit: vi.fn() })

/* Each item's words in the open menu: its name, then what describes it. */
const items = () =>
  within(screen.getByRole('menu', { name: 'What it runs' }))
    .getAllByRole('menuitemcheckbox')
    .map((item) =>
      item
        .getAttribute('aria-describedby')
        ?.split(' ')
        .map((id) => document.getElementById(id)?.textContent)
        .join(' | '),
    )

describe('how a run ended, in the list', () => {
  it('says each way a run ended, and how long ago where it knows', () => {
    render(
      <RunButton
        defaultOpen
        targets={[
          target('dev', { run: { state: 'ended', code: 0, since: '2m ago' } }),
          target('test', { run: { state: 'ended', code: 1, since: '8m ago' } }),
          target('lint', { run: { state: 'ended', code: null, since: '1h ago' } }),
          target('storybook', { run: { state: 'ended', stopped: true, since: 'just now' } }),
          target('build', { run: { state: 'ended' } }),
        ]}
        {...handlers()}
      />,
    )
    expect(items()).toEqual([
      expect.stringContaining('bun run dev · main · Finished 2m ago'),
      'bun run test · main · Failed 8m ago · exit 1',
      'bun run lint · main · Failed 1h ago',
      'bun run storybook · main · Stopped just now',
      expect.stringMatching(/· Failed\s*$/),
    ])
  })

  it('says where one runs elsewhere, and at what address where it has one', () => {
    render(
      <RunButton
        defaultOpen
        targets={[
          target('dev', { elsewhere: { where: 'in althar-cov', url: 'localhost:5310' } }),
          target('docs', { elsewhere: { where: 'in main' } }),
        ]}
        {...handlers()}
      />,
    )
    expect(items()).toEqual([
      expect.stringContaining('bun run dev · main · Running in althar-cov at localhost:5310'),
      'bun run docs · main · Running in main',
    ])
  })

  it('starts one at rest and stops one running, keeping the list open', () => {
    const on = handlers()
    render(
      <RunButton
        defaultOpen
        targets={[target('dev', { run: { state: 'running', url: 'localhost:1', since: '3m' } }), target('test')]}
        {...on}
      />,
    )
    const menu = within(screen.getByRole('menu', { name: 'What it runs' }))
    expect(within(menu.getByRole('group', { name: 'Running' })).getByRole('menuitemcheckbox', { name: /dev/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    fireEvent.click(menu.getByRole('menuitemcheckbox', { name: /dev/ }))
    expect(on.onStop).toHaveBeenCalledWith('dev')
    fireEvent.click(within(menu.getByRole('group', { name: 'Not running' })).getByRole('menuitemcheckbox', { name: /test/ }))
    expect(on.onRun).toHaveBeenCalledWith('test')
    expect(screen.getByRole('menu', { name: 'What it runs' })).toBeInTheDocument()
  })

  it('opens the list from a running default with no address to open', () => {
    render(<RunButton targets={[target('dev', { run: { state: 'running' } })]} {...handlers()} />)
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'dev' }))
    expect(screen.getByRole('menu', { name: 'What it runs' })).toBeInTheDocument()
  })

  it('opens where the running default answers', () => {
    const on = handlers()
    render(<RunButton targets={[target('dev', { run: { state: 'running', url: 'localhost:5310' } })]} {...on} />)
    fireEvent.click(screen.getByRole('button', { name: 'dev · localhost:5310' }))
    expect(on.onOpen).toHaveBeenCalledWith('dev')
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
