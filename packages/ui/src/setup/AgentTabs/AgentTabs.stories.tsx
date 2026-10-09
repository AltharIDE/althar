import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { ACCOUNTS, AGENT_TABS, CODEX_MODELS } from '../../fixtures/setup'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { States, statesOn } from '../../storybook/States'
import { Accounts } from '../Accounts/Accounts'
import { ModelSwitches } from '../ModelSwitches/ModelSwitches'
import { AgentTabs, type AgentTabsProps } from './AgentTabs'

const meta = {
  title: 'Setup/AgentTabs',
  component: AgentTabs,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div style={{ maxWidth: 720, padding: 12, borderRadius: 20, background: 'var(--frost)' }}>{Story()}</div>],
  args: {
    label: 'Agents',
    agents: AGENT_TABS,
    value: 'codex',
    onValueChange: fn(),
    children: <Accounts agent="Codex" accounts={ACCOUNTS} onSignIn={fn()} onAdd={fn()} />,
  },
} satisfies Meta<typeof AgentTabs>
export default meta
type Story = StoryObj<typeof meta>

/* The tabs as a consumer drives them. */
function Choosing(args: AgentTabsProps) {
  const [value, setValue] = useState(args.value)
  return (
    <AgentTabs
      {...args}
      value={value}
      onValueChange={(id) => {
        args.onValueChange(id)
        setValue(id)
      }}
    />
  )
}

/** One agent at a time, its settings under the tabs; a dot on one only the person can put right. Arrows move between them. */
export const OneAtATime: Story = {
  render: (args) => <Choosing {...args} />,
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('tablist', { name: 'Agents' })).toBeInTheDocument()
    await expect(c.getByRole('tab', { name: 'Codex, needs you' })).toHaveAttribute('aria-selected', 'true')
    await expect(c.getByRole('heading', { name: 'Codex', level: 3 })).toBeInTheDocument()
    await expect(c.getByText('OpenAI · 0.159.3')).toBeInTheDocument()
    await userEvent.click(c.getByRole('tab', { name: 'Claude Code' }))
    await expect(args.onValueChange).toHaveBeenCalledWith('claude-code')
    await expect(c.getByRole('tab', { name: 'Claude Code' })).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    await expect(c.getByRole('tab', { name: 'Codex, needs you' })).toHaveFocus()
    await expect(args.onValueChange).toHaveBeenLastCalledWith('codex')
  },
}

/** With a way to add an agent at the row's end, and an agent with no mark of its own. */
export const WithAnEnd: Story = {
  args: { value: 'opencode', end: <IconButton icon="plus" label="Add an agent" /> },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('button', { name: 'Add an agent' })).toBeInTheDocument()
    await expect(c.getByRole('heading', { name: 'OpenCode' })).toBeInTheDocument()
  },
}

/** With its models, each on or off, beside its accounts, as Settings shows it. */
export const WithModels: Story = {
  args: {
    aside: <ModelSwitches agent="Codex" models={CODEX_MODELS} off={['gpt-5-mini']} onChange={fn()} />,
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('group', { name: 'Codex models' })).toBeInTheDocument()
  },
}

/** A value that names no agent shows the tabs alone. */
export const NoneChosen: Story = {
  args: { value: 'gone' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('tabpanel')).toBeNull()
  },
}

/** Every state, a tab hovered, focused and pressed, and the tabs where there is little room. */
export const AllStates: Story = {
  parameters: statesOn({ hover: '[role=tab]:first-child', focus: '[role=tab]:first-child', pressed: '[role=tab]:first-child' }),
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'chosen', node: <AgentTabs {...args} /> },
        { state: 'hover', node: <AgentTabs {...args} /> },
        { state: 'focus', node: <AgentTabs {...args} /> },
        { state: 'pressed', node: <AgentTabs {...args} /> },
        {
          state: 'narrow',
          node: (
            <div style={{ width: 360 }}>
              <AgentTabs {...args} end={<IconButton icon="plus" label="Add an agent" />} />
            </div>
          ),
        },
      ]}
    />
  ),
}
