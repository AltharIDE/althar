import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { CODEX } from '../../fixtures/models'
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

export const Default: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.tab()
    await expect(within(canvasElement).getByRole('button', { name: 'Context 31% used' })).toHaveFocus()
    await waitFor(() => expect(within(document.body).getByRole('tooltip')).toBeInTheDocument())
  },
}
export const Open: Story = { args: { defaultOpen: true } }
export const Empty: Story = { args: { used: 0 } }
export const NearlyFull: Story = {
  args: { used: 372, defaultOpen: true, note: 'Near the limit, the lead writes what it knows to the task and starts a fresh context.' },
}
/** Without a model, the numbers stand alone. */
export const NoModel: Story = { args: { model: undefined, used: 40, defaultOpen: true } }

/** Full enough to be worth it: a quiet Compact beside the ring has the agent sum up what it holds. */
export const WithCompact: Story = {
  args: { used: 372, onCompact: fn() },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Compact' }))
    await expect(args.onCompact).toHaveBeenCalledOnce()
  },
}
/** Asked for and not yet done: Compact is off, and says so. */
export const Compacting: Story = {
  args: { used: 372, onCompact: fn(), compacting: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Compacting…' })).toBeDisabled()
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
        { state: 'compact', node: <ContextRing used={372} total={400} model={CODEX} onCompact={() => {}} /> },
        { state: 'compacting', node: <ContextRing used={372} total={400} model={CODEX} onCompact={() => {}} compacting /> },
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
