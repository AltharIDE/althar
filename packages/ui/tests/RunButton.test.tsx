import { cleanup, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { type RunTarget, RunButton, labelOf, shortCommand } from '../src/chrome/RunButton/RunButton'

const LONG =
  'export PATH="$HOME/.bun/bin:$PATH"; unset ELECTRON_RUN_AS_NODE; P=$(pwd); cd apps/desktop && bun run build && cd "$P" && exec zypak-wrapper electron apps/desktop --no-sandbox'
const target = (more: Partial<RunTarget>): RunTarget => ({ id: 'one', command: 'bun run dev', from: 'agent', ...more })

const handlers = { onRun: vi.fn(), onStop: vi.fn(), onOpen: vi.fn(), onAdd: vi.fn(), onEdit: vi.fn() }

describe('the label of what runs', () => {
  it('is its name where it has one', () => {
    const named = target({ name: 'Storybook', command: LONG })
    expect(labelOf(named)).toBe('Storybook')
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
    expect(shortCommand('sh -c "echo \\"a && b\\""')).toBe('sh -c "echo \\"a && b\\""')
    expect(shortCommand('cd web && npm start || true; echo done')).toBe('echo done')
  })

  it('reads apart for two commands that end the same: the list says each whole', () => {
    const a = target({ id: 'a', command: 'cd apps/a && bun run dev' })
    const b = target({ id: 'b', command: 'cd apps/b && bun run dev' })
    expect(labelOf(a)).toBe(labelOf(b))
    render(<RunButton targets={[a, b]} defaultOpen {...handlers} />)
    expect(screen.getByText('cd apps/a && bun run dev', { selector: 'code' })).toBeInTheDocument()
    expect(screen.getByText('cd apps/b && bun run dev', { selector: 'code' })).toBeInTheDocument()
    cleanup()
    render(<RunButton targets={[target({ command: 'bun run dev' })]} defaultOpen {...handlers} />)
    expect(screen.queryByText('bun run dev', { selector: 'code' })).toBeNull()
  })

  it('is the short command where it has no name, the whole command its tooltip', () => {
    expect(labelOf(target({ command: LONG }))).toBe('zypak-wrapper electron apps/desktop --no-sandbox')
    render(<RunButton targets={[target({ command: LONG })]} defaultOpen {...handlers} />)
    expect(screen.getByText('zypak-wrapper electron apps/desktop --no-sandbox', { selector: '[title]' })).toHaveAttribute('title', LONG)
  })
})
