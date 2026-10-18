import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { type RunTarget, RunButton, buttonLabelOf, labelOf, shortCommand } from '../src/chrome/RunButton/RunButton'

const LONG =
  'export PATH="$HOME/.bun/bin:$PATH"; unset ELECTRON_RUN_AS_NODE; P=$(pwd); cd apps/desktop && bun run build && cd "$P" && exec zypak-wrapper electron apps/desktop --no-sandbox'
const target = (more: Partial<RunTarget>): RunTarget => ({ id: 'one', command: 'bun run dev', where: 'main', from: 'agent', ...more })

const handlers = { onRun: vi.fn(), onStop: vi.fn(), onOpen: vi.fn(), onAdd: vi.fn(), onEdit: vi.fn() }

describe('the label of what runs', () => {
  it('is its name where it has one', () => {
    const named = target({ name: 'Storybook', command: LONG })
    expect(labelOf(named)).toBe('Storybook')
    expect(buttonLabelOf(named)).toBe('Storybook')
  })

  it('is the last meaningful command of a chain, whole, not cut to its runner', () => {
    expect(shortCommand('cd app && bun run dev')).toBe('bun run dev')
    expect(shortCommand('export A=1; A=2 npm start; cd x')).toBe('A=2 npm start')
    expect(shortCommand(LONG)).toBe('zypak-wrapper electron apps/desktop --no-sandbox')
    expect(shortCommand('bun --filter @althar/ui storybook')).toBe('bun --filter @althar/ui storybook')
    expect(shortCommand('npm run dev -- --port 5290')).toBe('npm run dev -- --port 5290')
    expect(shortCommand('docker compose up --build web')).toBe('docker compose up --build web')
    expect(shortCommand('export A=1')).toBe('export A=1')
    expect(shortCommand(`bun ${'a'.repeat(200)}`)).toHaveLength(80)
  })

  it('leaves out what runs only on failure, and does not split inside quotes', () => {
    expect(shortCommand('bun run dev || echo failed')).toBe('bun run dev')
    expect(shortCommand('make serve || exit 1')).toBe('make serve')
    expect(shortCommand("sh -c 'cd web && npm start'")).toBe("sh -c 'cd web && npm start'")
    expect(shortCommand('cd web && npm start || true; echo done')).toBe('echo done')
  })

  it('reads the same for two commands that end the same, so the list keeps the whole command', () => {
    const a = target({ id: 'a', command: 'cd apps/a && bun run dev' })
    const b = target({ id: 'b', command: 'cd apps/b && bun run dev' })
    expect(labelOf(a)).toBe(labelOf(b))
    render(<RunButton targets={[a, b]} defaultOpen {...handlers} />)
    expect(screen.getByText(/^cd apps\/a && bun run dev/)).toBeInTheDocument()
    expect(screen.getByText(/^cd apps\/b && bun run dev/)).toBeInTheDocument()
  })

  it('is just Run for a repository’s own way, and the short command otherwise', () => {
    expect(buttonLabelOf(target({ from: 'repository', command: LONG }))).toBeUndefined()
    expect(buttonLabelOf(target({ command: LONG }))).toBe('zypak-wrapper electron apps/desktop --no-sandbox')
    expect(labelOf(target({ from: 'repository', command: 'bun run dev' }))).toBe('bun run dev')
  })
})

describe('the Run button', () => {
  it('says the short form and keeps the whole command as its tooltip', () => {
    render(<RunButton targets={[target({ command: LONG })]} {...handlers} />)
    expect(screen.getByRole('button', { name: 'Run zypak-wrapper electron apps/desktop --no-sandbox' })).toHaveAttribute('title', LONG)
  })

  it('says only Run for a repository’s own way', () => {
    render(<RunButton targets={[target({ from: 'repository', command: LONG })]} {...handlers} />)
    expect(screen.getByRole('button', { name: 'Run' })).toHaveAttribute('title', LONG)
  })

  it('says the same short form while starting and running', () => {
    const { rerender } = render(<RunButton targets={[target({ command: LONG, run: { state: 'starting' } })]} {...handlers} />)
    expect(screen.getByRole('button', { name: 'Starting zypak-wrapper electron apps/desktop --no-sandbox…' })).toBeInTheDocument()
    rerender(<RunButton targets={[target({ command: LONG, run: { state: 'running', url: 'localhost:1' } })]} {...handlers} />)
    expect(screen.getByRole('button', { name: 'zypak-wrapper electron apps/desktop --no-sandbox · localhost:1' })).toBeInTheDocument()
    // The repository's own way is just Run at rest, but says what runs once it does, apart from the Running pill.
    rerender(<RunButton targets={[target({ from: 'repository', command: 'bun run dev', run: { state: 'starting' } })]} {...handlers} />)
    expect(screen.getByRole('button', { name: 'Starting bun run dev…' })).toBeInTheDocument()
    rerender(<RunButton targets={[target({ from: 'repository', command: 'bun run dev', run: { state: 'running' } })]} {...handlers} />)
    expect(screen.getByRole('button', { name: 'bun run dev' })).toBeInTheDocument()
  })
})
