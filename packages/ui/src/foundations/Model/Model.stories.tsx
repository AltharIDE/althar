import type { Meta, StoryObj } from '@storybook/react-vite'

import { MODEL_LIST, OPUS, UNKNOWN_MODEL } from '../../fixtures/models'
import { Model, WithModels } from './Model'
import { States } from '../../storybook/States'

const meta = {
  title: 'Foundations/Model',
  component: Model,
  args: { model: OPUS, short: false, strong: false },
  argTypes: {
    model: { control: 'select', options: MODEL_LIST.map((x) => x.id), mapping: Object.fromEntries(MODEL_LIST.map((x) => [x.id, x])) },
  },
} satisfies Meta<typeof Model>
export default meta
type Story = StoryObj<typeof meta>

export const Full: Story = {}
export const Short: Story = { args: { short: true } }
/** Who is speaking, at the head of a turn. */
export const Strong: Story = { args: { strong: true } }
/** A model with no mark prints its name alone. */
export const NoMark: Story = { args: { model: UNKNOWN_MODEL } }

export const Every: Story = {
  render: () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, max-content)', gap: '10px 32px' }}>
      {MODEL_LIST.map((x) => (
        <span key={x.id} style={{ display: 'contents' }}>
          <Model model={x} />
          <Model model={x} short />
        </span>
      ))}
    </div>
  ),
}

export const InText: Story = {
  render: () => (
    <p style={{ margin: 0, fontSize: 14, color: 'var(--t-1)' }}>
      <WithModels models={MODEL_LIST}>{'Review ran on claude-sonnet-5 and gemini-3-pro, then gpt-5.2-codex took the lead.'}</WithModels>
    </p>
  ),
}

export const AllStates: Story = {
  render: () => (
    <States
      cells={[
        { state: 'full', node: <Model model={OPUS} /> },
        { state: 'short', node: <Model model={OPUS} short /> },
        { state: 'strong', node: <Model model={OPUS} strong /> },
        { state: 'no mark', node: <Model model={UNKNOWN_MODEL} /> },
        { state: 'long name', node: <Model model={MODEL_LIST.find((x) => x.id === 'llama-4-maverick') ?? OPUS} /> },
      ]}
    />
  ),
}
