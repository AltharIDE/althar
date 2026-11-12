import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { Brand } from '../../foundations/brands/brands'
import { CODEX, model } from '../../fixtures/models'
import type { UsageLine } from '../../outputs/Usage/Usage'
import { States, statesParameters } from '../../storybook/States'
import { ContextRing } from './ContextRing'

const meta = {
  title: 'Composer/ContextRing',
  component: ContextRing,
  args: { used: 122, total: CODEX.context, model: CODEX },
  decorators: [
    (Story) => (
      <div style={{ padding: '150px 0 0 240px' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ContextRing>
export default meta
type Story = StoryObj<typeof meta>

/** The keyboard opens the detail as a press does: focus moves into it. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.tab()
    await expect(within(canvasElement).getByRole('button', { name: 'Context 31% used' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(within(document.body).getByRole('dialog', { name: 'Context' })).toBeInTheDocument())
  },
}
export const Open: Story = { args: { defaultOpen: true } }
export const Empty: Story = { args: { used: 0 } }
export const NearlyFull: Story = {
  args: { used: 372, defaultOpen: true, note: 'Near the limit, the lead writes what it knows to the task and starts a fresh context.' },
}
/** Without a model, the numbers stand alone. */
export const NoModel: Story = { args: { model: undefined, used: 40, defaultOpen: true } }

/** The foot also holds Clear chat…, before Compact: it asks what to clear, so pressing it clears nothing by itself. */
export const WithClear: Story = {
  args: { used: 122, defaultOpen: true, onCompact: fn(), onClear: fn() },
  play: async ({ args }) => {
    const panel = await within(document.body).findByRole('dialog', { name: 'Context' })
    await userEvent.click(within(panel).getByRole('button', { name: 'Clear chat…' }))
    await expect(args.onClear).toHaveBeenCalledOnce()
    await expect(args.onCompact).not.toHaveBeenCalled()
  },
}

/** Pointed at, the detail opens with Compact under the numbers, which has the agent sum up what it holds; focus stays where it was. */
export const WithCompact: Story = {
  args: { used: 372, onCompact: fn() },
  play: async ({ args, canvasElement }) => {
    const ring = within(canvasElement).getByRole('button', { name: 'Context 93% used' })
    await userEvent.hover(ring)
    const panel = await within(document.body).findByRole('dialog', { name: 'Context' })
    await expect(ring).not.toHaveFocus()
    await userEvent.click(within(panel).getByRole('button', { name: 'Compact' }))
    await expect(args.onCompact).toHaveBeenCalledOnce()
  },
}
const OPUS = model('claude-opus-5')
const claude = (took: number, tokens: number): UsageLine => ({
  id: 'cc',
  name: 'Claude Code',
  mark: Brand.ClaudeCode,
  took,
  estimated: true,
  models: [OPUS.name],
  tokens,
})

/** Under the context, a quiet line for each account the task so far used: the share of a plan's week, the dollars of a credit. */
export const WithUsage: Story = {
  args: {
    defaultOpen: true,
    onClear: fn(),
    onCompact: fn(),
    usage: {
      heading: 'This task',
      lines: [
        { ...claude(8.2, 13_400_000), id: 'max', name: 'Claude Code Max' },
        { id: 'zen', name: 'OpenCode', mark: Brand.OpenCode, spent: 1.24, models: ['DeepSeek V3.2'], tokens: 2_100_000 },
      ],
    },
  },
  play: async () => {
    const panel = within(document.body).getByRole('dialog', { name: 'Context' })
    await expect(within(panel).getByText('This task')).toBeInTheDocument()
    await expect(within(panel).getByText('~8% of week')).toBeInTheDocument()
    await expect(within(panel).getByText('$1.24')).toBeInTheDocument()
  },
}
/** The coordinator's day, with little used: under a tenth of a point is a bound, with no "~" before it. */
export const Today: Story = {
  args: {
    used: 97.4,
    total: 1000,
    model: OPUS,
    defaultOpen: true,
    onClear: fn(),
    onCompact: fn(),
    usage: { heading: 'Today', lines: [claude(0.04, 2_600_000)] },
  },
  play: async () => {
    const panel = within(document.body).getByRole('dialog', { name: 'Context' })
    await expect(within(panel).getByText('< 0.1% of week')).toBeInTheDocument()
    await expect(within(panel).queryByText(/Opus/)).toBeNull()
  },
}
/** Several accounts, each a line: models and tokens as the pointer rests on one. */
export const SeveralAccounts: Story = {
  args: {
    used: 214,
    total: 1000,
    model: OPUS,
    defaultOpen: true,
    onClear: fn(),
    onCompact: fn(),
    usage: {
      heading: 'Today',
      lines: [
        {
          ...claude(14, 11_400_000),
          id: 'max',
          name: 'Claude Code Max',
          byModel: [
            { name: OPUS.name, tokens: 9_100_000 },
            { name: 'Claude Sonnet 5', tokens: 2_300_000 },
          ],
        },
        { id: 'codex', name: 'Codex Pro', mark: Brand.Codex, took: 6, models: ['GPT-5.2'], tokens: 4_200_000 },
        { id: 'or', name: 'OpenRouter', mark: Brand.OpenRouter, spent: 0.86, estimated: true, models: ['Kimi K2'], tokens: 1_300_000 },
      ],
    },
  },
}
/** A long account name is cut with "…" and said whole on hover; the figure never is. */
export const LongNames: Story = {
  args: {
    used: 141,
    total: 256,
    model: model('qwen3-coder'),
    defaultOpen: true,
    onClear: fn(),
    onCompact: fn(),
    usage: {
      heading: 'Today',
      lines: [
        {
          id: 'or',
          name: 'OpenRouter, the shared team key for the whole studio',
          mark: Brand.OpenRouter,
          spent: 3.17,
          models: ['Qwen3 Coder 480B A35B Instruct Turbo'],
          tokens: 5_800_000,
        },
      ],
    },
  },
}
/** Asked for and not yet done: Compact is off, and says so. */
export const Compacting: Story = {
  args: {
    used: 372,
    onClear: fn(),
    onCompact: fn(),
    compacting: true,
    defaultOpen: true,
    usage: { heading: 'Today', lines: [claude(4.1, 9_300_000)] },
  },
  play: async () => {
    await expect(within(document.body).getByRole('button', { name: 'Compacting…' })).toBeDisabled()
  },
}

export const AllStates: Story = {
  parameters: statesParameters,
  render: () => (
    <States
      cells={[
        { state: 'rest', node: <ContextRing used={122} total={400} model={CODEX} /> },
        { state: 'hover', node: <ContextRing used={122} total={400} model={CODEX} /> },
        { state: 'focus', node: <ContextRing used={122} total={400} model={CODEX} /> },
        { state: 'empty', node: <ContextRing used={0} total={400} model={CODEX} /> },
        { state: 'full', node: <ContextRing used={400} total={400} model={CODEX} /> },
      ]}
    />
  ),
  decorators: [
    (Story) => (
      <div style={{ margin: '-150px 0 0 -240px' }}>
        <Story />
      </div>
    ),
  ],
}
