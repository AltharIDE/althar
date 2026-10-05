import type { Meta, StoryObj } from '@storybook/react-vite'

import { AGENTS_READY, AGENTS_TROUBLED } from '../../fixtures/home'
import { Brand } from '../../foundations/brands/brands'
import { RuntimeState } from '../../foundations/vocabulary'
import { States } from '../../storybook/States'
import { AgentMarks } from './AgentMarks'

const meta = {
  title: 'Chrome/AgentMarks',
  component: AgentMarks,
  args: { agents: AGENTS_READY },
} satisfies Meta<typeof AgentMarks>
export default meta
type Story = StoryObj<typeof meta>

/** Every agent ready: marks, and nothing more. One without a mark shows its name. */
export const AllReady: Story = {}

/** One out until its reset, one signed out: only those say anything, and signed out is violet, since only a person can sign it in. */
export const SomethingWrong: Story = { args: { agents: AGENTS_TROUBLED } }

/** An agent out of usage with no known reset. */
export const OutWithNoReset: Story = {
  args: { agents: [{ id: 'claude-code', name: 'Claude Code', brand: Brand.ClaudeCode, state: RuntimeState.OutOfUsage }] },
}

/** Each state an agent can be in, on its own. */
export const AllStates: Story = {
  render: () => (
    <States
      cells={Object.values(RuntimeState).map((state) => ({
        state,
        node: <AgentMarks agents={[{ id: 'codex', name: 'Codex', brand: Brand.Codex, state, back: '14:20' }]} />,
      }))}
    />
  ),
}
