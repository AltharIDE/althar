import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { PushBlocked, PushState } from '../../foundations/vocabulary'
import { States } from '../../storybook/States'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { PushRequest } from './PushRequest'

const COMMITS = [
  { sha: '4e1c0a2', subject: 'Read Retry-After as seconds or a date' },
  { sha: '9b37f1d', subject: 'Name the retry option as the review asked' },
]

const meta = {
  title: 'Thread/PushRequest',
  component: PushRequest,
  decorators: [threadDecorator],
  args: {
    where: 'PR #106',
    by: 'Opus 5',
    commits: COMMITS,
    at: 'just now',
    onPush: fn(),
    onOpen: fn(),
  },
} satisfies Meta<typeof PushRequest>
export default meta
type Story = StoryObj<typeof meta>

/** The lead asked: what would go up, and Push. */
export const Asked: Story = {}
/** The person pressed Push; it is on its way. */
export const Pushing: Story = { args: { pushing: true } }
/** The branch changed since the lead asked: what is on it now, to look at again. */
export const Moved: Story = {
  args: { moved: true, commits: [COMMITS[0] ?? { sha: '', subject: '' }, { sha: 'c51e8a0', subject: 'Name the retry option, again' }] },
}
/** Moved so far that nothing on the branch is new to the pull request: nothing to push. */
export const NothingNew: Story = { args: { moved: true, commits: [], count: 0 } }
/** The branch changed under what the pull request has: why nothing can go up, and what would let it. No Push. */
export const Rewritten: Story = { args: { moved: true, blocked: PushBlocked.Rewritten, commits: [], count: 0 } }
/** The pull request has commits from elsewhere that the branch doesn't. */
export const Behind: Story = { args: { moved: true, blocked: PushBlocked.Behind, commits: [], count: 0 } }
/** Althar can't tell what the pull request has. */
export const Unknown: Story = { args: { moved: true, blocked: PushBlocked.Unknown, commits: [], count: 0 } }
/** Many commits: the first few, and how many more. */
export const Many: Story = { args: { commits: COMMITS, count: 14 } }
/** In a task of several repositories, the pull request by its repository. */
export const OneOfSeveral: Story = { args: { where: 'web#3' } }
/** Pushed: kept as a record, quiet. */
export const Pushed: Story = { args: { state: PushState.Pushed, at: '2m ago' } }
/** The lead asked again, with more, further down. */
export const Replaced: Story = { args: { state: PushState.Replaced, at: '5m ago' } }
/** The pull request merged or closed before anyone pushed. */
export const Closed: Story = { args: { state: PushState.Closed, at: '1h ago' } }
/** A long subject keeps to its line. */
export const LongWords: Story = {
  args: {
    commits: [
      {
        sha: '4e1c0a2',
        subject: 'Rate-limit refunds the way charges are, per partner, and say so in the docs, with the header in seconds or as a date',
      },
    ],
  },
}

export const PushingIt: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Push 2 commits to PR #106' }))
    await expect(args.onPush).toHaveBeenCalledOnce()
    await userEvent.click(c.getByRole('button', { name: 'Open PR #106' }))
    await expect(args.onOpen).toHaveBeenCalledOnce()
  },
}

export const SettledHasNoPush: Story = {
  args: { state: PushState.Pushed },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.queryByRole('button', { name: /^Push/ })).toBeNull()
    await expect(c.getByRole('article', { name: 'Push to PR #106' })).toHaveTextContent('Pushed')
  },
}

export const BlockedHasNoPush: Story = {
  args: { moved: true, blocked: PushBlocked.Rewritten, commits: [], count: 0 },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.queryByRole('button', { name: /^Push/ })).toBeNull()
    await expect(c.getByRole('article', { name: 'Push to PR #106' })).toHaveTextContent('can’t go up without a force push')
  },
}

export const AllStates: Story = {
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'asked', node: <PushRequest {...args} /> },
        { state: 'pushing', node: <PushRequest {...args} pushing /> },
        { state: 'moved', node: <PushRequest {...args} moved /> },
        { state: 'rewritten', node: <PushRequest {...args} moved blocked={PushBlocked.Rewritten} commits={[]} count={0} /> },
        { state: 'pushed', node: <PushRequest {...args} state={PushState.Pushed} at="2m ago" /> },
        { state: 'replaced', node: <PushRequest {...args} state={PushState.Replaced} at="5m ago" /> },
        { state: 'closed', node: <PushRequest {...args} state={PushState.Closed} at="1h ago" /> },
      ]}
    />
  ),
}
