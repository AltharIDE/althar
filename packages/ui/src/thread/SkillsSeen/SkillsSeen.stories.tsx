import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { ToolKind, ToolState } from '../../foundations/vocabulary'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { Tool } from '../Tool/Tool'
import { WorkLine } from '../WorkLine/WorkLine'
import { SkillsSeen, type SeenSkillRow } from './SkillsSeen'

const skills: ReadonlyArray<SeenSkillRow> = [
  { name: 'code-review-and-quality', path: '/home/sam/.claude/skills/code-review-and-quality/SKILL.md', from: 'person' },
  { name: 'systematic-debugging', path: '/home/sam/.claude/skills/systematic-debugging/SKILL.md', from: 'person' },
  { name: 'test-driven-development', path: '/home/sam/.claude/skills/test-driven-development/SKILL.md', from: 'person' },
  { name: 'release-notes', path: '/work/refunds/.claude/skills/release-notes/SKILL.md', from: 'repository' },
]

const meta = {
  title: 'Thread/SkillsSeen',
  component: SkillsSeen,
  decorators: [threadDecorator],
  args: { title: 'Claude Code could see 4 skills', skills },
} satisfies Meta<typeof SkillsSeen>
export default meta
type Story = StoryObj<typeof meta>

/** One faint line at the start of a lead's work; nothing under it while closed. */
export const Closed: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const row = c.getByRole('button', { name: /could see 4 skills/ })
    await expect(row).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(row)
    await waitFor(() => expect(c.getByText('release-notes')).toBeVisible())
    await expect(c.getByText('code-review-and-quality')).toHaveAttribute('title', skills[0]?.path)
  },
}

/** Opened: the names, by whose they are. */
export const Open: Story = { args: { defaultOpen: true } }

/** Only the repository's: the person has none in the folders this agent reads. */
export const OnlyTheRepository: Story = {
  args: { title: 'Codex could see a skill', skills: skills.filter((skill) => skill.from === 'repository'), defaultOpen: true },
}

/** A later lead that could see none, after one that could: nothing to open. */
export const None: Story = { args: { title: 'OpenCode could see no skills', skills: [] } }

/** A very long name in a narrow window stays on its line. */
export const LongName: Story = {
  args: {
    title: 'Claude Code could see a skill',
    skills: [
      {
        name: 'a-skill-with-a-name-that-goes-on-and-on-past-the-width-of-the-column-it-is-in-and-further',
        path: '/home/sam/.claude/skills/a-long-one/SKILL.md',
        from: 'person',
      },
    ],
    defaultOpen: true,
  },
  decorators: [(Story) => <div style={{ width: 280 }}>{Story()}</div>],
}

/** A load, as its own row among the work: the agent's word, a read of its file where it has none, and a command that printed one. */
export const LoadsInTheWork: Story = {
  render: () => (
    <WorkLine took="1m 2s" summary="loaded 1 skill, read 2 skills, ran 1 command" defaultOpen>
      <Tool kind={ToolKind.Skill} verb="Loaded skill" target="systematic-debugging" state={ToolState.Done} />
      <Tool kind={ToolKind.Skill} verb="Loading skill" target="release-notes" state={ToolState.Running} />
      <Tool kind={ToolKind.Skill} verb="Read skill" target="code-review-and-quality" state={ToolState.Done} />
      <Tool
        kind={ToolKind.Run}
        verb="Ran"
        target="cat ~/.agents/skills/test-driven-development/SKILL.md && git status"
        meta="read skill test-driven-development"
        state={ToolState.Done}
      />
    </WorkLine>
  ),
}
