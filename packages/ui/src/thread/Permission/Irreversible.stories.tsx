import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { OPUS } from '../../fixtures/models'
import { Brand } from '../../foundations/brands/brands'
import { Decision } from '../../foundations/vocabulary'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { Permission, type PermissionRequest, Permissions } from './Permission'

/*
 * What still asks, once agents work as the person's own (ADR-097): only
 * what can't be undone. The card says so, the action on its button, what
 * can't be taken back in one line, the words it would post, and where the
 * call goes, an MCP server's tool or a command.
 */

const MERGE: PermissionRequest = {
  id: 'att-merge',
  what: 'Merge #635 into main',
  cmd: 'mcp__github__merge_pull_request',
  agent: OPUS,
  irreversible: {
    verb: 'Merge #635',
    done: 'Merged #635.',
    stays: 'Its commits stay in main’s history; only a revert takes them out.',
    through: { server: 'github', brand: Brand.GitHub, tool: 'merge_pull_request' },
  },
}

const POST: PermissionRequest = {
  id: 'att-post',
  what: 'Comment on dana’s #640',
  cmd: 'mcp__github__add_issue_comment',
  agent: OPUS,
  irreversible: {
    verb: 'Post on #640',
    done: 'Posted on #640.',
    stays: 'Everyone watching it is told at once; it can’t be called back.',
    words: '#635 brings the runs pill back over the composer too, with where each run answers. This one may not be needed once it merges.',
    through: { server: 'github', brand: Brand.GitHub, tool: 'add_issue_comment' },
  },
}

const FORCE: PermissionRequest = {
  id: 'att-force',
  what: 'Force push althar/runs-pill over the remote',
  cmd: 'git push --force origin althar/runs-pill',
  agent: OPUS,
  irreversible: {
    verb: 'Force push',
    done: 'Force pushed.',
    stays: 'What was on the remote branch is gone for everyone who shares it.',
    through: { command: 'git push --force origin althar/runs-pill' },
  },
}

const meta = {
  title: 'Thread/Permission/Can’t be undone',
  component: Permission,
  decorators: [threadDecorator],
  args: { ...MERGE, project: 'althar', onAnswer: fn() },
} satisfies Meta<typeof Permission>
export default meta
type Story = StoryObj<typeof meta>

/** A merge through the person's GitHub server: Not now, or Merge #635. */
export const Merge: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Can’t be undone')).toBeVisible()
    await userEvent.click(c.getByRole('button', { name: /Merge #635/ }))
    await waitFor(() => expect(args.onAnswer).toHaveBeenCalledWith({ decision: Decision.AllowOnce, cmd: MERGE.cmd }))
    await waitFor(() => expect(c.getByText('Merged #635.')).toBeVisible())
  },
}

/** Speaking for the person: the words it would post, whole. */
export const Post: Story = { args: { ...POST } }

/** A command that can't be undone: the command itself, quietly, where the server would be. */
export const Command: Story = { args: { ...FORCE } }

/** Not now refuses it, with no note; the lead hears it was refused. */
export const NotNow: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(args.onAnswer).toHaveBeenCalledWith({ decision: Decision.Deny, cmd: MERGE.cmd, note: '' }))
    await waitFor(() => expect(c.getByText('Not now.')).toBeVisible())
  },
}

/** Two at once, in the task's stack. */
export const Stacked: Story = { render: () => <Permissions items={[MERGE, POST]} project="althar" onAnswer={fn()} /> }
