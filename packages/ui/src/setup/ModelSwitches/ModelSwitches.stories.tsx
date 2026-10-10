import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { CODEX_MODELS } from '../../fixtures/setup'
import { States } from '../../storybook/States'
import { ModelSwitches, type ModelSwitchesProps } from './ModelSwitches'

/* OpenCode's long list. */
const MANY = [
  'GLM-5.3',
  'GLM-5.3-Flash',
  'DeepSeek V4 Flash',
  'DeepSeek V4 Pro',
  'Kimi K3',
  'Qwen3 Coder',
  'MiniMax M3',
  'GPT-5.6 Luna',
  'Claude Haiku 5.5',
  'Grok 5 Fast',
].map((name) => ({ id: name.toLowerCase().replaceAll(' ', '-'), name }))

const meta = {
  title: 'Setup/ModelSwitches',
  component: ModelSwitches,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div style={{ maxWidth: 320 }}>{Story()}</div>],
  args: { agent: 'Codex', models: CODEX_MODELS, off: ['gpt-5-mini'], onChange: fn() },
} satisfies Meta<typeof ModelSwitches>
export default meta
type Story = StoryObj<typeof meta>

/* As a consumer keeps it. */
function Kept(args: ModelSwitchesProps) {
  const [off, setOff] = useState(args.off)
  return (
    <ModelSwitches
      {...args}
      off={off}
      onChange={(id, on) => {
        args.onChange(id, on)
        setOff((now) => (on ? now.filter((one) => one !== id) : [...now, id]))
      }}
    />
  )
}

/** Each model on or off; how many are used, at the top. */
export const Switching: Story = {
  render: (args) => <Kept {...args} />,
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('2 of 3 used')).toBeInTheDocument()
    await userEvent.click(c.getByRole('checkbox', { name: 'GPT-6.1 Sol' }))
    await expect(args.onChange).toHaveBeenCalledWith('gpt-6.1-sol', false)
    await userEvent.click(c.getByRole('checkbox', { name: 'GPT-5 mini' }))
    await expect(args.onChange).toHaveBeenLastCalledWith('gpt-5-mini', true)
    await expect(c.getByText('2 of 3 used')).toBeInTheDocument()
    await expect(c.queryByRole('searchbox')).toBeNull()
  },
}

/** A long list is found in by name. */
export const Many: Story = {
  args: { agent: 'OpenCode', models: MANY, off: [] },
  render: (args) => <Kept {...args} />,
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('all 10 used')).toBeInTheDocument()
    await userEvent.type(c.getByRole('searchbox', { name: 'Find a model' }), 'glm')
    await expect(c.getAllByRole('checkbox')).toHaveLength(2)
    await userEvent.click(c.getByRole('checkbox', { name: 'GLM-5.3-Flash' }))
    await expect(args.onChange).toHaveBeenCalledWith('glm-5.3-flash', false)
    await userEvent.clear(c.getByRole('searchbox', { name: 'Find a model' }))
    await userEvent.type(c.getByRole('searchbox', { name: 'Find a model' }), 'nothing')
    await expect(c.getByText('No model matches')).toBeInTheDocument()
  },
}

/** Before the agent says what it offers. */
export const NotKnownYet: Story = {
  args: { models: [] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('It hasn’t said what it offers yet.')).toBeInTheDocument()
  },
}

/** Every state. */
export const AllStates: Story = {
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'some off', node: <ModelSwitches {...args} /> },
        { state: 'all on', node: <ModelSwitches {...args} off={[]} /> },
        { state: 'many', node: <ModelSwitches {...args} agent="OpenCode" models={MANY} off={['grok-5-fast']} /> },
        { state: 'not known yet', node: <ModelSwitches {...args} models={[]} /> },
      ]}
    />
  ),
}
