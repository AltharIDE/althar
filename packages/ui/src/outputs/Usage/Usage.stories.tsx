import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { Brand } from '../../foundations/brands/brands'
import { type UsageLine, UsageCard, UsageLines } from './Usage'

/** The lead on OpenCode's credit, the reviewer on ChatGPT Pro. */
const CREDIT_AND_PLAN: ReadonlyArray<UsageLine> = [
  { id: 'zen', name: 'OpenCode', mark: Brand.OpenCode, spent: 21.59, models: ['Claude Opus 5'], tokens: 13_400_000 },
  { id: 'pro', name: 'Codex Pro', mark: Brand.Codex, took: 1.9, estimated: true, models: ['GPT-5.2 Codex'], tokens: 2_400_000 },
]
/** Two plans. */
const TWO_PLANS: ReadonlyArray<UsageLine> = [
  {
    id: 'max',
    name: 'Claude Code Max',
    mark: Brand.ClaudeCode,
    took: 8.2,
    estimated: true,
    models: ['Claude Opus 5', 'Claude Sonnet 5'],
    tokens: 13_400_000,
  },
  { id: 'pro', name: 'Codex Pro', mark: Brand.Codex, took: 0.4, estimated: true, models: ['GPT-5.2 Codex'], tokens: 900_000 },
]
/** Paid per use only: one priced at list prices, one with no price anyone said. */
const PER_USE: ReadonlyArray<UsageLine> = [
  { id: 'key', name: 'Claude Code', mark: Brand.ClaudeCode, spent: 21.59, estimated: true, models: ['Claude Opus 5'], tokens: 13_400_000 },
  { id: 'router', name: 'OpenCode', mark: Brand.OpenCode, spent: null, models: ['Qwen3 Coder'], tokens: 2_400_000 },
]
/** A task's lines: Claude Code on its plan, GPT-6 Astra on OpenCode Zen in dollars, and Go with no figure, and why. */
const BY_PROVIDER: ReadonlyArray<UsageLine> = [
  { id: 'cc', name: 'Claude Code', mark: Brand.ClaudeCode, took: 0, estimated: true, models: ['Claude Opus 5.5'], tokens: 74_107_422 },
  { id: 'zen', name: 'OpenCode Zen', mark: Brand.OpenCode, spent: 1.485206, estimated: true, models: ['GPT-6 Astra'], tokens: 965_656 },
  {
    id: 'go',
    name: 'OpenCode Go',
    mark: Brand.OpenCode,
    took: null,
    estimated: true,
    models: ['GLM-5.3'],
    tokens: 412_000,
    why: 'OpenCode Go doesn’t report its usage to Althar.',
  },
]

const meta = {
  title: 'Outputs/Usage',
  component: UsageLines,
  args: { lines: CREDIT_AND_PLAN },
  decorators: [
    (Story) => (
      <div style={{ width: 240, padding: 16 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof UsageLines>
export default meta
type Story = StoryObj<typeof meta>

/** A plan says the share of its week the task took, credit the dollars it spent; the models and tokens under each. */
export const Lines: Story = {
  args: { heading: 'This task so far' },
  play: async ({ canvasElement }) => {
    const lines = within(canvasElement).getAllByRole('listitem')
    await expect(lines[0]).toHaveTextContent('OpenCodeClaude Opus 5 · 13M tokens$21.59')
    await expect(lines[1]).toHaveTextContent('Codex ProGPT-5.2 Codex · 2.4M tokens~2% of week')
  },
}
/** A small share says its tenth, and a model that shared a plan with another is on its line. */
export const TwoPlans: Story = {
  args: { lines: TWO_PLANS, heading: 'Today' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('~0.4% of week')).toBeInTheDocument()
    await expect(within(canvasElement).getByText('Claude Opus 5 · Claude Sonnet 5 · 13M tokens')).toBeInTheDocument()
  },
}
/** Paid per use: dollars at list prices said as an estimate, and with no price anyone said, a dash, never a guess. */
export const PerUse: Story = {
  args: { lines: PER_USE },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('~$21.59')).toHaveAttribute('title', 'An estimate')
    await expect(within(canvasElement).getAllByRole('listitem')[1]).toHaveTextContent('—')
  },
}
/** An OpenCode account, a line for each provider: Zen's dollars, and where Go's share can't be known, its "—" says why on focus. */
export const ByProvider: Story = {
  args: { lines: BY_PROVIDER },
  decorators: [
    (Story) => (
      <div style={{ width: 340, paddingTop: 48 }}>
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const lines = within(canvasElement).getAllByRole('listitem')
    await expect(lines[1]).toHaveTextContent('OpenCode ZenGPT-6 Astra · 966k tokens~$1.49')
    await userEvent.tab()
    await expect(within(lines[2]!).getByText('—')).toHaveFocus()
    await expect(await within(document.body).findByRole('tooltip')).toHaveTextContent('OpenCode Go doesn’t report its usage to Althar.')
  },
}

/** In Outputs: one row with each figure by its mark, closed until the person opens it. */
export const Card: StoryObj<typeof UsageCard> = {
  render: function Render(args) {
    const [open, setOpen] = useState(args.open)
    return (
      <div style={{ width: 340 }}>
        <UsageCard
          {...args}
          open={open}
          onOpenChange={(next) => {
            setOpen(next)
            args.onOpenChange(next)
          }}
        />
      </div>
    )
  },
  args: { lines: CREDIT_AND_PLAN, open: false, onOpenChange: fn() },
  play: async ({ args, canvasElement }) => {
    const toggle = within(canvasElement).getByRole('button', { name: /Usage/ })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(toggle).toHaveTextContent('$21.59~2%')
    await userEvent.click(toggle)
    await expect(args.onOpenChange).toHaveBeenLastCalledWith(true)
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(within(canvasElement).getByText('~2% of week')).toBeVisible()
    await userEvent.click(toggle)
    await expect(args.onOpenChange).toHaveBeenLastCalledWith(false)
  },
}
/** Kept open by the person, it opens so. */
export const CardOpen: StoryObj<typeof UsageCard> = {
  render: (args) => (
    <div style={{ width: 340 }}>
      <UsageCard {...args} />
    </div>
  ),
  args: { lines: TWO_PLANS, open: true, onOpenChange: fn() },
}
/** The task the person asked about: GPT-6 Astra ran on OpenCode Zen, so its line says dollars, beside Claude Code's share. */
export const CardByProvider: StoryObj<typeof UsageCard> = {
  render: (args) => (
    <div style={{ width: 380 }}>
      <UsageCard {...args} />
    </div>
  ),
  args: { lines: BY_PROVIDER.slice(0, 2), open: true, onOpenChange: fn() },
}
