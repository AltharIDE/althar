import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { type RunTarget, RunButton, buttonLabelOf, labelOf, shortCommand } from '../src/chrome/RunButton/RunButton'

const LONG =
  'export PATH="$HOME/.bun/bin:$PATH"; unset ELECTRON_RUN_AS_NODE; P=$(pwd); cd apps/desktop && bun run build && cd "$P" && exec zypak-wrapper electron apps/desktop --no-sandbox'
const target = (more: Partial<RunTarget>): RunTarget => ({ id: 'one', command: 'bun run dev', where: 'main', from: 'agent', ...more })

describe('the label of what runs', () => {
  it('is its name where it has one', () => {
    const named = target({ name: 'Storybook', command: LONG })
    expect(labelOf(named)).toBe('Storybook')
    expect(buttonLabelOf(named)).toBe('Storybook')
  })

  it('is the last meaningful command of a long chain, else its first word, cut', () => {
    expect(shortCommand('cd app && bun run dev')).toBe('bun run dev')
    expect(shortCommand('export A=1; A=2 npm start; cd x')).toBe('A=2 npm start')
    expect(shortCommand(LONG)).toBe('zypak-wrapper')
    expect(shortCommand('/usr/local/bin/some-very-long-tool --with --many --flags')).toBe('some-very-long-tool')
    expect(shortCommand(`${'a'.repeat(40)} run`)).toBe(`${'a'.repeat(23)}…`)
    expect(shortCommand('export A=1')).toBe('export A=1')
  })

  it('is just Run for a repository’s own way, and the short command otherwise', () => {
    expect(buttonLabelOf(target({ from: 'repository', command: LONG }))).toBeUndefined()
    expect(buttonLabelOf(target({ command: LONG }))).toBe('zypak-wrapper')
    expect(labelOf(target({ from: 'repository', command: 'bun run dev' }))).toBe('bun run dev')
  })
})

describe('the Run button', () => {
  const handlers = { onRun: vi.fn(), onStop: vi.fn(), onOpen: vi.fn(), onAdd: vi.fn(), onEdit: vi.fn() }

  it('says the short form and keeps the whole command as its tooltip', () => {
    render(<RunButton targets={[target({ command: LONG })]} {...handlers} />)
    expect(screen.getByRole('button', { name: 'Run zypak-wrapper' })).toHaveAttribute('title', LONG)
  })

  it('says only Run for a repository’s own way', () => {
    render(<RunButton targets={[target({ from: 'repository', command: LONG })]} {...handlers} />)
    expect(screen.getByRole('button', { name: 'Run' })).toHaveAttribute('title', LONG)
  })

  it('says the same short form while starting and running', () => {
    const { rerender } = render(<RunButton targets={[target({ command: LONG, run: { state: 'starting' } })]} {...handlers} />)
    expect(screen.getByRole('button', { name: 'Starting zypak-wrapper…' })).toBeInTheDocument()
    rerender(<RunButton targets={[target({ command: LONG, run: { state: 'running', url: 'localhost:1' } })]} {...handlers} />)
    expect(screen.getByRole('button', { name: 'zypak-wrapper · localhost:1' })).toBeInTheDocument()
    rerender(<RunButton targets={[target({ from: 'repository', command: LONG, run: { state: 'starting' } })]} {...handlers} />)
    expect(screen.getByRole('button', { name: 'Starting…' })).toBeInTheDocument()
    rerender(<RunButton targets={[target({ from: 'repository', command: LONG, run: { state: 'running' } })]} {...handlers} />)
    expect(screen.getByRole('button', { name: 'Running' })).toBeInTheDocument()
  })
})
