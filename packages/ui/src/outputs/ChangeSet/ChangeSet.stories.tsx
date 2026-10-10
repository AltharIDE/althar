import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { CHANGE_BRANCH, CHANGE_DRAFT, CHANGE_HELD, CHANGE_MERGED, CHANGE_ONE_REPO, CHANGE_READY, PR_416 } from '../../fixtures/outputs'
import { States, statesParameters } from '../../storybook/States'
import { DiffStat } from '../../primitives/FileChanges/FileChanges'
import { ChangeState } from '../../foundations/vocabulary'
import { ChangeSet } from './ChangeSet'

const meta = {
  title: 'Outputs/ChangeSet',
  component: ChangeSet,
  decorators: [(Story) => <div style={{ maxWidth: 860 }}>{Story()}</div>],
  args: { ...CHANGE_READY, onAccept: fn(), onSendBack: fn(), onReviewDiff: fn(), onOpenFile: fn(), diffKey: 'D' },
} satisfies Meta<typeof ChangeSet>
export default meta
type Story = StoryObj<typeof meta>

/** Every check passed: accepting is yours. Two repositories merge in order. */
export const Ready: Story = {}
/** Still being checked: a draft, with the review a rule added still running. */
export const Draft: Story = { args: CHANGE_DRAFT }
/** Just opened: its checks haven't started, and it says so rather than counting none. */
export const NoChecksYet: Story = {
  args: { ...CHANGE_DRAFT, checks: [] },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('None have run yet')).toBeInTheDocument()
    await expect(c.queryByText(/0 of 0/)).not.toBeInTheDocument()
  },
}
/** A check waits on your call; the change waits with it. */
export const Held: Story = { args: CHANGE_HELD }
export const Merged: Story = { args: CHANGE_MERGED }
/** Ended on its branch, with no pull request: accepting it merges it into main on this Mac. */
export const OnItsBranch: Story = { args: { ...CHANGE_BRANCH, host: undefined } }
/** One repository, and the lead reviewed its own work: the card says so. */
export const OneRepositorySameReviewer: Story = { args: CHANGE_ONE_REPO }
/** Without handlers there are no actions, and files are not links. */
export const ReadOnly: Story = { args: { onAccept: undefined, onSendBack: undefined, onReviewDiff: undefined, onOpenFile: undefined } }

export const Accepting: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Accept and merge both' }))
    await expect(args.onAccept).toHaveBeenCalledOnce()
    await userEvent.click(c.getByRole('button', { name: 'Open the diff of src/auth/session.ts' }))
    await expect(args.onOpenFile).toHaveBeenCalledWith('src/auth/session.ts')
  },
}

/** Sending it back asks for a note; the lead picks it up. */
export const SendingBack: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Ask for changes' }))
    const field = c.getByRole('textbox')
    await expect(field).toHaveFocus()
    /* sent empty, it says what is missing */
    await userEvent.click(c.getByRole('button', { name: 'Send to the lead' }))
    await expect(args.onSendBack).not.toHaveBeenCalled()
    await expect(field).toHaveAttribute('aria-invalid', 'true')
    await userEvent.type(field, 'Keep the old cache for one release')
    await userEvent.click(c.getByRole('button', { name: 'Send to the lead' }))
    await expect(args.onSendBack).toHaveBeenCalledWith('Keep the old cache for one release')
    await expect(c.getByRole('button', { name: 'Accept and merge both' })).toBeInTheDocument()
  },
}

export const Cancelling: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Ask for changes' }))
    await userEvent.keyboard('{Escape}')
    await expect(c.queryByRole('textbox')).toBeNull()
    await userEvent.click(c.getByRole('button', { name: 'Ask for changes' }))
    await userEvent.click(c.getByRole('button', { name: 'Cancel' }))
    await expect(args.onSendBack).not.toHaveBeenCalled()
  },
}

/** On its branch, its remote not having it yet: Push sends it there with the person's own git, no connection needed. */
export const BranchNotPushed: Story = {
  args: {
    ...CHANGE_BRANCH,
    host: undefined,
    note: 'Its repository is on GitHub, which Althar isn’t connected to',
    remote: { name: 'origin', pushed: false, ahead: 2, onPush: fn() },
  },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Not on origin yet')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Push the branch to origin' }))
    await expect(args.remote?.onPush).toHaveBeenCalled()
    await expect(c.queryByRole('link', { name: /Open a pull request/ })).toBeNull()
  },
}

/** Pushed: the host's page for a pull request from it is a press away. */
export const BranchPushed: Story = {
  args: {
    ...CHANGE_BRANCH,
    host: undefined,
    note: 'Its repository is on GitHub, which Althar isn’t connected to',
    prs: [
      {
        repo: 'meridian-api',
        files: PR_416[0]?.files ?? [],
        newPullRequest: { url: 'https://github.com/meridian/api/compare/main...althar/return-409-on-reuse?expand=1', host: 'GitHub' },
      },
    ],
    remote: { name: 'origin', pushed: true, ahead: 0, onPush: fn() },
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('On origin')).toBeInTheDocument()
    await expect(c.getByRole('link', { name: /Open a pull request on GitHub/ })).toHaveAttribute(
      'href',
      'https://github.com/meridian/api/compare/main...althar/return-409-on-reuse?expand=1',
    )
    await expect(c.queryByRole('button', { name: 'Push the branch to origin' })).toBeNull()
  },
}

/** Pushed, and the lead committed more since: the remote is behind, and Push sends the rest. */
export const BranchBehind: Story = {
  args: { ...BranchPushed.args, remote: { name: 'origin', pushed: true, ahead: 1, onPush: fn(), pushing: true } },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('1 commit not on origin yet')).toBeInTheDocument()
    await expect(c.getByRole('button', { name: 'Push the branch to origin' })).toHaveAttribute('aria-busy', 'true')
  },
}

/** Several repositories, pushed: each says where its own pull request can be. */
export const BranchPushedSeveral: Story = {
  args: {
    ...CHANGE_BRANCH,
    host: undefined,
    prs: [
      {
        repo: 'meridian-api',
        files: PR_416[0]?.files ?? [],
        newPullRequest: { url: 'https://github.com/meridian/api/compare/main...x', host: 'GitHub' },
      },
      { repo: 'meridian-web', files: PR_416[0]?.files ?? [], newPullRequest: { url: 'https://github.com/meridian/web/compare/main...x' } },
    ],
    remote: { name: 'origin', pushed: true, ahead: 0 },
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('link', { name: 'Open a pull request on GitHub' })).toBeInTheDocument()
    await expect(c.getByRole('link', { name: 'Open a pull request' })).toBeInTheDocument()
  },
}

/** Merged on this Mac, not on its remote yet: one press pushes it, with the person's own git. */
export const MergedHere: Story = {
  args: {
    ...CHANGE_BRANCH,
    host: undefined,
    state: ChangeState.Merged,
    note: 'Merged into main on this Mac. origin doesn’t have it yet.',
    onPush: fn(),
    text: { push: () => 'Push main to origin' },
  },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Push main to origin' }))
    await expect(args.onPush).toHaveBeenCalled()
    await expect(c.getByText('With your own git sign-in, as from a terminal')).toBeInTheDocument()
    await expect(c.queryByRole('button', { name: /^Merge into/ })).toBeNull()
  },
}

export const AllStates: Story = {
  parameters: statesParameters,
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'ready', node: <ChangeSet {...args} /> },
        { state: 'draft', node: <ChangeSet {...args} {...CHANGE_DRAFT} /> },
        { state: 'held', node: <ChangeSet {...args} {...CHANGE_HELD} /> },
        { state: 'merged', node: <ChangeSet {...args} {...CHANGE_MERGED} /> },
        { state: 'on its branch', node: <ChangeSet {...args} {...CHANGE_BRANCH} host={undefined} /> },
        { state: 'on its branch, not pushed', node: <ChangeSet {...args} {...BranchNotPushed.args} /> },
        { state: 'on its branch, pushed', node: <ChangeSet {...args} {...BranchPushed.args} /> },
        { state: 'on its branch, behind', node: <ChangeSet {...args} {...BranchBehind.args} /> },
        { state: 'merged here, not pushed', node: <ChangeSet {...args} {...MergedHere.args} /> },
        { state: 'pushing', node: <ChangeSet {...args} {...MergedHere.args} pushing /> },
        { state: 'one repository, same reviewer', node: <ChangeSet {...args} {...CHANGE_ONE_REPO} /> },
        { state: 'read only', node: <ChangeSet {...args} {...ReadOnly.args} /> },
        { state: 'accepting', node: <ChangeSet {...args} accepting /> },
        { state: 'accept failed', node: <ChangeSet {...args} error="GitHub refused the merge: meridian-web is behind main." /> },
        { state: 'a host without a mark', node: <ChangeSet {...args} host={{ name: 'Gitea' }} /> },
        {
          state: 'diff stat',
          node: (
            <span style={{ display: 'inline-flex', gap: 16 }}>
              <DiffStat add={140} del={0} />
              <DiffStat add={90} del={34} />
              <DiffStat add={10} del={40} />
              <DiffStat add={0} del={0} />
            </span>
          ),
        },
      ]}
    />
  ),
}
