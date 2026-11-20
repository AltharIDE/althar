import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'

import { ACCOUNTS, AGENT_TABS, CODEX_MODELS } from '../../fixtures/setup'
import { Accounts } from '../Accounts/Accounts'
import { AgentTabList, AgentTabPanel, AgentTabs } from '../AgentTabs/AgentTabs'
import { ModelSwitches } from '../ModelSwitches/ModelSwitches'
import { OwnSetup, type OwnSetupPartView, type OwnSetupProps } from './OwnSetup'

/** What of the person's own Claude Code setup it doesn't load, as the runtime says it: the agent's words, else Althar's. */
const CLAUDE_PARTS: readonly OwnSetupPartView[] = [
  {
    id: 'settings',
    name: 'settings.json',
    where: '~/.claude/settings.json',
    why: 'Claude Code skips the whole file: permissions.defaultMode: Invalid value. Expected one of: "acceptEdits", "auto", "bypassPermissions", "default", "dontAsk", "plan"',
  },
  {
    id: 'agent',
    name: 'review-agent.md',
    where: '~/.claude/agents/review-agent.md',
    why: 'Its frontmatter can’t be read, so Claude Code leaves it out.',
  },
  {
    id: 'hook',
    name: 'hooks.PreToolUse',
    where: '~/.claude/settings.json',
    why: 'Its matcher “Bashh” matches no tool, so it never runs. Claude Code calls it “Bash”.',
  },
  {
    id: 'plugin',
    name: 'release-tools',
    where: '~/.claude/plugins/cache/charrette/release-tools/1.2.0/.claude-plugin/plugin.json',
    why: 'Its plugin.json’s “version” isn’t text, so Claude Code ignores it.',
  },
]

/* The chosen agent's tab as Settings › Agents puts it: its accounts, then what of the person's setup didn't load. */
function InTab({ parts, width = 760 }: Pick<OwnSetupProps, 'parts'> & { width?: number }) {
  const chosen = AGENT_TABS[0]!
  return (
    <div style={{ width }}>
      <AgentTabs value={chosen.id} onValueChange={fn()}>
        <div style={{ display: 'grid', gap: 16 }}>
          <AgentTabList label="Agents" agents={AGENT_TABS} />
          <AgentTabPanel
            agent={chosen}
            headingLevel={2}
            aside={<ModelSwitches agent={chosen.name} models={CODEX_MODELS} off={['gpt-5-mini']} onChange={fn()} />}
          >
            <Accounts agent={chosen.name} accounts={ACCOUNTS.slice(0, 2)} onSignIn={fn()} onAdd={fn()} />
            <OwnSetup parts={parts} />
          </AgentTabPanel>
        </div>
      </AgentTabs>
    </div>
  )
}

const meta = {
  title: 'Setup/OwnSetup',
  component: OwnSetup,
  parameters: { layout: 'padded' },
  args: { parts: CLAUDE_PARTS },
  render: (args) => <InTab parts={args.parts} />,
} satisfies Meta<typeof OwnSetup>
export default meta
type Story = StoryObj<typeof meta>

/** Under Claude Code's accounts: each part that didn't load, a file by where it is, a part of one by itself and then its file. */
export const InAgentsTab: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const group = within(c.getByRole('region', { name: 'Didn’t load' }))
    await expect(group.getAllByRole('listitem')).toHaveLength(4)
    await expect(c.getByText('Its frontmatter can’t be read, so Claude Code leaves it out.')).toBeVisible()
    // Quiet: it is there to read, not announced.
    await expect(c.queryByRole('alert')).toBeNull()
  },
}

export const Dark: Story = { globals: { theme: 'dark' } }

/** Codex's own words, for its config.toml. */
export const Codex: Story = {
  args: {
    parts: [
      {
        id: 'config',
        name: 'config.toml',
        where: '~/.codex/config.toml',
        why: 'Invalid configuration; using defaults. ~/.codex/config.toml:2:10: unclosed table, expected `]`',
      },
    ],
  },
}

/** Where there is little room, a long path gives way by whole folders and the words wrap. */
export const Narrow: Story = { render: (args) => <InTab parts={args.parts} width={420} /> }

/** Everything loads: nothing shows. */
export const AllLoaded: Story = {
  args: { parts: [] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('heading', { name: 'Didn’t load' })).toBeNull()
  },
}
