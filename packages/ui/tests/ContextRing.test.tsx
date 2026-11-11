import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ContextRing } from '../src/composer/ContextRing/ContextRing'
import { Brand } from '../src/foundations/brands/brands'
import { type UsageLine, usageFigure, usageWhat } from '../src/outputs/Usage/Usage'
import type { ModelInfo } from '../src/primitives/Model/Model'

/*
 * The context ring's detail: one large figure with its actions beside it, the
 * tokens under the bar without the model (the picker beside the ring names
 * it), and a quiet line per account under whose usage it is.
 */

const OPUS: ModelInfo = { id: 'opus', name: 'Claude Opus 5.5', short: 'Opus 5.5', runtime: 'claude-code', efforts: [] }
const claude = (took: number): UsageLine => ({
  id: 'cc',
  name: 'Claude Code',
  mark: Brand.ClaudeCode,
  took,
  estimated: true,
  models: [OPUS.name],
  tokens: 2_600_000,
})

const panel = () => within(screen.getByRole('dialog', { name: 'Context' }))

describe('the context ring’s detail', () => {
  it('leads with the share, and says the tokens without the model', () => {
    render(<ContextRing used={97.4} total={1000} model={OPUS} defaultOpen />)
    expect(panel().getByText('10%')).toBeTruthy()
    expect(panel().getByText('97.4k of 1M tokens')).toBeTruthy()
    expect(panel().queryByText(/Opus/)).toBeNull()
  })

  it('puts Clear chat… and Compact beside the figure, Compact last, and off while it compacts', () => {
    render(<ContextRing used={372} total={400} defaultOpen onClear={() => {}} onCompact={() => {}} compacting />)
    const buttons = panel()
      .getAllByRole('button')
      .map((one) => one.textContent)
    expect(buttons).toEqual(['Clear chat…', 'Compacting…'])
    expect(panel().getByRole('button', { name: 'Compacting…' })).toBeDisabled()
  })

  it('says each account’s usage on a line under whose it is, with what ran on it for a screen reader', () => {
    render(
      <ContextRing
        used={97.4}
        total={1000}
        model={OPUS}
        defaultOpen
        usage={{
          heading: 'Today',
          lines: [
            claude(0.04),
            { id: 'zen', name: 'OpenCode', mark: Brand.OpenCode, spent: 1.24, models: ['Kimi K2.5'], tokens: 2_100_000 },
          ],
        }}
      />,
    )
    expect(panel().getByText('Today')).toBeTruthy()
    const lines = within(panel().getByRole('list')).getAllByRole('listitem')
    expect(lines.map((one) => one.textContent)).toEqual(['Claude Code< 0.1% of week2.6M tokens', 'OpenCode$1.24Kimi K2.5 · 2.1M tokens'])
    expect(lines[0]!.getAttribute('title')).toBe('Claude Code: 2.6M tokens')
  })

  it('says why a figure can’t be known, where the line says', () => {
    render(
      <ContextRing
        used={10}
        total={200}
        defaultOpen
        usage={{
          heading: 'Today',
          lines: [{ id: 'go', name: 'OpenCode Go', took: null, models: [], tokens: 0, why: 'It doesn’t report its usage.' }],
        }}
      />,
    )
    const line = within(panel().getByRole('list')).getByRole('listitem')
    expect(line.getAttribute('title')).toBe('It doesn’t report its usage.')
    expect(within(line).getByText('—')).toBeTruthy()
  })

  it('shows no usage part where no account was used', () => {
    render(<ContextRing used={10} total={200} defaultOpen usage={{ heading: 'Today', lines: [] }} />)
    expect(panel().queryByText('Today')).toBeNull()
  })
})

describe('a usage figure', () => {
  it('takes one qualifier at most', () => {
    expect(usageFigure(claude(0.04))).toBe('< 0.1% of week')
    expect(usageFigure(claude(0.4))).toBe('~0.4% of week')
    expect(usageFigure(claude(8.2))).toBe('~8% of week')
    expect(usageFigure({ ...claude(0.04), estimated: false })).toBe('< 0.1% of week')
  })

  it('leaves out of what ran the models already said nearby', () => {
    expect(usageWhat(claude(1), [OPUS.name])).toBe('2.6M tokens')
    expect(usageWhat(claude(1))).toBe('Claude Opus 5.5 · 2.6M tokens')
  })
})
