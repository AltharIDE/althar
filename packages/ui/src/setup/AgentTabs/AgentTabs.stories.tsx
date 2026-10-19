import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { ACCOUNTS, AGENT_TABS, CODEX_MODELS } from '../../fixtures/setup'
import { Brand } from '../../foundations/brands/brands'
import { States, statesOn } from '../../storybook/States'
import { Accounts } from '../Accounts/Accounts'
import { ControlDetail } from '../ControlCenter/ControlCenter'
import { ModelSwitches } from '../ModelSwitches/ModelSwitches'
import { type AgentTab, AgentTabList, AgentTabPanel, AgentTabs, type AgentTabsProps } from './AgentTabs'

const onValueChange = fn()

/* The tabs and the chosen agent as a consumer puts them: the tabs in the head of the module they opened from. */
function Agents({
  value: start = 'codex',
  models = true,
  width = 696,
  agents = AGENT_TABS,
}: {
  value?: string
  models?: boolean
  width?: number
  agents?: ReadonlyArray<AgentTab>
}) {
  const [value, setValue] = useState(start)
  const chosen = agents.find((agent) => agent.id === value)
  return (
    <div style={{ width, padding: 12, borderRadius: 20, background: 'var(--frost)' }}>
      <AgentTabs
        value={value}
        onValueChange={(id) => {
          onValueChange(id)
          setValue(id)
        }}
      >
        <ControlDetail
          title="Agents"
          aside={`${agents.length} agents · 6 accounts`}
          beside={<AgentTabList label="Agents" agents={agents} />}
          onBack={fn()}
        >
          {chosen && (
            <AgentTabPanel
              agent={chosen}
              {...(models
                ? { aside: <ModelSwitches agent={chosen.name} models={CODEX_MODELS} off={['gpt-5-mini']} onChange={fn()} /> }
                : {})}
            >
              <Accounts agent={chosen.name} accounts={ACCOUNTS} onSignIn={fn()} onAdd={fn()} />
            </AgentTabPanel>
          )}
        </ControlDetail>
      </AgentTabs>
    </div>
  )
}

const meta = {
  title: 'Setup/AgentTabs',
  component: AgentTabs,
  parameters: { layout: 'padded' },
  args: { value: 'codex', onValueChange, children: null },
  render: () => <Agents />,
} satisfies Meta<typeof AgentTabs>
export default meta
type Story = StoryObj<typeof meta>

/** One agent at a time, its tabs in the head, its name and who makes it on one line; a dot on one only the person can put right. Arrows move between them. */
export const OneAtATime: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('tablist', { name: 'Agents' })).toBeInTheDocument()
    await expect(c.getByRole('tab', { name: 'Codex, needs you' })).toHaveAttribute('aria-selected', 'true')
    await expect(c.getByRole('heading', { name: 'Codex', level: 3 })).toBeInTheDocument()
    await expect(c.getByText('OpenAI · 0.159.3')).toBeInTheDocument()
    await expect(c.getByRole('group', { name: 'Codex models' })).toBeInTheDocument()
    await userEvent.click(c.getByRole('tab', { name: 'Claude Code' }))
    await expect(onValueChange).toHaveBeenCalledWith('claude-code')
    await expect(c.getByRole('tab', { name: 'Claude Code' })).toHaveFocus()
    await expect(c.getByRole('heading', { name: 'Claude Code', level: 3 })).toBeInTheDocument()
    await userEvent.keyboard('{ArrowRight}')
    await expect(c.getByRole('tab', { name: 'Codex, needs you' })).toHaveFocus()
    await expect(onValueChange).toHaveBeenLastCalledWith('codex')
  },
}

/** Without its models: the accounts alone, across the sheet. */
export const AccountsAlone: Story = {
  render: () => <Agents value="opencode" models={false} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('heading', { name: 'OpenCode' })).toBeInTheDocument()
    await expect(c.queryByRole('group', { name: /models/ })).toBeNull()
  },
}

/** Every agent Althar runs, those on this computer first: each tab its mark, and its name once chosen. */
export const ManyAgents: Story = {
  render: () => (
    <Agents
      value="antigravity"
      models={false}
      agents={[
        ...AGENT_TABS,
        { id: 'copilot', name: 'GitHub Copilot', brand: Brand.GitHubCopilot, line: '1.0.98' },
        { id: 'antigravity', name: 'Google Antigravity', brand: Brand.Antigravity, line: 'Google' },
        { id: 'junie', name: 'Junie', brand: Brand.Junie },
        { id: 'grok', name: 'Grok Build', brand: Brand.XAI, line: 'xAI' },
        { id: 'kimi', name: 'Kimi Code', brand: Brand.Moonshot, line: 'Moonshot AI' },
        { id: 'mistral-vibe', name: 'Mistral Vibe', brand: Brand.Mistral, line: 'Mistral AI' },
        { id: 'qwen-code', name: 'Qwen Code', brand: Brand.Alibaba },
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getAllByRole('tab')).toHaveLength(10)
    await expect(c.getByRole('heading', { name: 'Google Antigravity', level: 3 })).toBeInTheDocument()
    await expect(c.getByText('Google')).toBeInTheDocument()
  },
}

/** A value that names no agent shows the tabs alone. */
export const NoneChosen: Story = {
  render: () => <Agents value="gone" />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('tabpanel')).toBeNull()
  },
}

/* A tab list on its own, for the states grid: the state lands on its first tab. */
const tabs = (args: Pick<AgentTabsProps, 'value'>) => (
  <AgentTabs value={args.value} onValueChange={fn()}>
    <AgentTabList label="Agents" agents={AGENT_TABS} />
  </AgentTabs>
)

/** Every state: a tab hovered, focused and pressed, and the sheet where there is little room, its models under its accounts. */
export const AllStates: Story = {
  parameters: statesOn({ hover: '[role=tab]:first-child', focus: '[role=tab]:first-child', pressed: '[role=tab]:first-child' }),
  render: () => (
    <States
      size="wide"
      cells={[
        { state: 'chosen', node: tabs({ value: 'codex' }) },
        { state: 'hover', node: tabs({ value: 'codex' }) },
        { state: 'focus', node: tabs({ value: 'codex' }) },
        { state: 'pressed', node: tabs({ value: 'codex' }) },
        { state: 'in the head', node: <Agents /> },
        { state: 'narrow', node: <Agents width={480} /> },
      ]}
    />
  ),
}
