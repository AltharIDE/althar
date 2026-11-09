import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { CROWDED_PROJECTS, SKILLS, TOOL_AGENTS, TOOL_PROJECTS } from '../../fixtures/tools'
import { SkillSheet } from './SkillSheet'
import type { SkillTileModel } from './tools'

const of = (id: string): SkillTileModel => SKILLS.find((one) => one.id === id) ?? SKILLS[0]!
const width = (px: number) => (Story: () => ReactNode) => <div style={{ maxWidth: px }}>{Story()}</div>

const meta = {
  title: 'Setup/ToolTiles/SkillSheet',
  component: SkillSheet,
  parameters: { layout: 'padded' },
  decorators: [width(880)],
  args: {
    skill: of('release-checklist'),
    agents: TOOL_AGENTS,
    projects: TOOL_PROJECTS,
    onBack: fn(),
    onRoles: fn(),
    onProject: fn(),
    onUpdate: fn(),
    onRemove: fn(),
  },
} satisfies Meta<typeof SkillSheet>
export default meta
type Story = StoryObj<typeof meta>

/** One added from GitHub: its SKILL.md, where it came from with Update, who gets it, its projects, its agents, and Remove…. */
export const FromGitHub: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('~/.agents/skills/release-checklist/SKILL.md')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Update' }))
    await expect(args.onUpdate).toHaveBeenCalled()
    await userEvent.click(canvas.getByRole('switch', { name: 'The coordinator gets release-checklist' }))
    await expect(args.onRoles).toHaveBeenCalledWith(['lead', 'reviewer'])
    await userEvent.click(canvas.getByRole('button', { name: 'Remove…' }))
    const dialog = within(await within(document.body).findByRole('dialog', { name: 'Remove release-checklist?' }))
    await userEvent.click(dialog.getByRole('button', { name: 'Remove' }))
    await expect(args.onRemove).toHaveBeenCalled()
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }))
  },
}

/** One of the person's own, in some agents: faint where it isn't, said in words too; nothing to remove here. */
export const Yours: Story = {
  args: { skill: of('dataviz') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/Codex/).closest('li')).toHaveTextContent('hasn’t it')
    await expect(canvas.queryByRole('button', { name: 'Remove…' })).toBeNull()
    await expect(canvas.queryByText('From')).toBeNull()
  },
}

/** A repository's own: no projects. */
export const Repository: Story = { args: { skill: of('p1:run') } }

export const ManyProjects: Story = { args: { projects: CROWDED_PROJECTS } }

export const Updating: Story = { args: { updating: true } }

export const LongDescription: Story = {
  args: {
    skill: {
      ...of('improve'),
      name: 'survey-the-codebase-and-write-prioritised-plans',
      home: '~/.claude/plugins/marketplaces/charrette/skills/survey-the-codebase-and-write-prioritised-plans',
      about:
        'Survey any codebase as a senior advisor and produce prioritised, self-contained implementation plans for other agents to carry out, without changing the code itself.',
    },
  },
}

export const Narrow: Story = { decorators: [width(500)] }

export const Dark: Story = { globals: { theme: 'dark' } }
