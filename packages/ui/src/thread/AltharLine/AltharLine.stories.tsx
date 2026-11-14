import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'

import { States } from '../../storybook/States'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { AltharLine } from './AltharLine'

const meta = {
  title: 'Thread/AltharLine',
  component: AltharLine,
  decorators: [threadDecorator],
  args: { children: 'PR #157 conflicts with main, in 4 files. Althar asked the lead to resolve it, as the project’s rules say.' },
} satisfies Meta<typeof AltharLine>
export default meta
type Story = StoryObj<typeof meta>

/** Althar saying what the person should know, by name. */
export const Said: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Althar')).toBeInTheDocument()
  },
}

/** A task this task's lead started (ADR-097): its title opens it. */
export const StartedATask: Story = {
  args: {
    children: (
      <>
        Started <LinkButton onClick={() => undefined}>Built-in browser beside the conversation</LinkButton>
      </>
    ),
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Built-in browser beside the conversation' })).toBeVisible()
  },
}

const RAW = JSON.stringify(
  {
    status: 200,
    body: {
      url: 'https://api.github.com/repos/AltharIDE/althar/pulls/698',
      html_url: 'https://github.com/AltharIDE/althar/pull/698',
      title: 'Errand notes: one short line, raw response folded',
      body: 'The note an errand step leaves was the person’s whole message and the host’s whole answer. '.repeat(8),
      user: { login: 'ninemate', url: 'https://api.github.com/users/ninemate' },
    },
  },
  null,
  2,
)

/** An errand step's note: one short line, the host's raw answer folded under Details and wrapped when open. */
export const WithDetails: Story = {
  args: {
    children: (
      <>
        Asked balazsotakomaiya to review <a href="https://github.com/AltharIDE/althar/pull/698">#698</a>
      </>
    ),
    details: RAW,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByText(/"status": 200/)).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Details' }))
    await expect(canvas.getByText(/"status": 200/)).toBeVisible()
  },
}

/** A long answer, open: it wraps at the column and keeps to a height, with no sideways scroll. */
export const LongNoteOpen: Story = {
  args: { children: 'Merged #662', details: RAW.repeat(4) },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Details' }))
    const block = await within(canvasElement).findByText(/"status": 200/)
    await expect(block.scrollWidth).toBeLessThanOrEqual(block.clientWidth)
  },
}

export const AllStates: Story = {
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'said', node: <AltharLine {...args} /> },
        {
          state: 'with a link',
          node: (
            <AltharLine>
              Opened <a href="https://github.com/acme/refunds/pull/142">PR #142</a>: Say why a refund is refused
            </AltharLine>
          ),
        },
        { state: 'warning', node: <AltharLine tone="warning">The lead couldn’t resolve the conflict with main, in 4 files.</AltharLine> },
        {
          state: 'warning, with its fix',
          node: (
            <AltharLine tone="warning">
              Claude Code is signed out. <LinkButton onClick={() => undefined}>Sign in</LinkButton>
            </AltharLine>
          ),
        },
        {
          state: 'warning, wrapping',
          node: (
            <AltharLine tone="warning">
              The lead couldn’t resolve the conflict with main, in 4 files. The merge isn’t committed: it’s yours to settle, or to ask the
              lead again.
            </AltharLine>
          ),
        },
      ]}
    />
  ),
}

/** A task's folder whose link to its repository git couldn't repair: the fact, the way out, then what git said; the folder left as it was (decisions: workspaces-and-runs, A worktree whose link broke). */
export const FolderNotRepaired: Story = {
  args: {
    tone: 'warning',
    children:
      'This task’s folder lost its link to the repository, and Althar couldn’t restore it. Its commits are safe on its branch, althar/fix-login, and the folder is left as it is, uncommitted changes and all. To work in it again, move the folder aside and add it back with git worktree add ~/.local/share/althar/worktrees/orchy/fix-login/orchy althar/fix-login in ~/projects/orchy. Git said: unable to locate repository; .git file does not reference a repository: ~/.local/share/althar/worktrees/orchy/fix-login/orchy/.git.',
  },
}
/** One linked to another copy, as a profile copied rather than moved leaves it: both left as they are, and what to do. */
export const FolderLinkedElsewhere: Story = {
  args: {
    tone: 'warning',
    children:
      'This task’s folder is linked to another copy, at ~/.var/app/dev.althar.app/data/althar/worktrees/orchy/fix-login/orchy, so Althar left both as they are. If that copy is from an old profile, remove it and restart Althar.',
  },
}
export const FolderLinkedElsewhereDark: Story = { ...FolderLinkedElsewhere, globals: { theme: 'dark' } }
export const FolderNotRepairedDark: Story = { ...FolderNotRepaired, globals: { theme: 'dark' } }
