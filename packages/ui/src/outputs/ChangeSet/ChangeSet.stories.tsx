import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import {
  CHANGE_BRANCH,
  CHANGE_DRAFT,
  CHANGE_FAILED,
  CHANGE_HELD,
  CHANGE_MERGED,
  CHANGE_ONE_REPO,
  CHANGE_QUEUED,
  CHANGE_READY,
  PR_416,
} from '../../fixtures/outputs'
import { States, statesParameters } from '../../storybook/States'
import { ChangeState } from '../../foundations/vocabulary'
import { Button } from '../../primitives/Button/Button'
import { ChangeSet, foldersOf } from './ChangeSet'

const accept = fn()
const push = fn()

const meta = {
  title: 'Outputs/ChangeSet',
  component: ChangeSet,
  decorators: [(Story) => <div style={{ maxWidth: 360 }}>{Story()}</div>],
  args: {
    ...CHANGE_READY,
    actions: (
      <Button variant="signal" onClick={accept}>
        Accept and merge both
      </Button>
    ),
    onReviewDiff: fn(),
    onOpenFile: fn(),
    diffKey: '⌘D',
  },
} satisfies Meta<typeof ChangeSet>
export default meta
type Story = StoryObj<typeof meta>

/** Every check passed, and its review: the button is what's left. */
export const Ready: Story = {}
/** A draft: its checks still running, said in a line. */
export const Draft: Story = { args: { ...CHANGE_DRAFT, actions: <Button>Mark ready for review</Button> } }
/** Just opened: its checks haven't started, and it says so rather than counting none. */
export const NoChecksYet: Story = {
  args: { ...CHANGE_DRAFT, checks: [], actions: undefined },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('No checks have run yet')).toBeInTheDocument()
    await expect(c.queryByText(/0 of 0/)).not.toBeInTheDocument()
  },
}
/** A check waits on your call: the line says which. */
export const Held: Story = { args: { ...CHANGE_HELD, actions: undefined } }
/** A check failed: the line names it, red, and opens to the list. */
export const Failed: Story = {
  args: {
    ...CHANGE_FAILED,
    actions: (
      <Button variant="signal" onClick={push}>
        Push 2 commits
      </Button>
    ),
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const line = c.getByRole('button', { name: 'Its checks: Integration failed' })
    await expect(c.queryByText('2 of 38 failed · the lead is fixing them')).toBeNull()
    await userEvent.click(line)
    await expect(c.getByText('2 of 38 failed · the lead is fixing them')).toBeInTheDocument()
  },
}
export const Merged: Story = { args: { ...CHANGE_MERGED, actions: undefined } }
/** Accepted on a branch that merges through a merge queue: in it, with nothing to press, until its host merges it. */
export const Queued: Story = {
  args: { ...CHANGE_QUEUED, actions: undefined },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('In the merge queue')).toBeInTheDocument()
    await expect(within(canvasElement).queryByRole('button', { name: /Accept/ })).not.toBeInTheDocument()
  },
}
/** One pull request: its number is the one link to its host. */
export const OneRepository: Story = {
  args: CHANGE_ONE_REPO,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('link', { name: 'Open stripe-internal/meridian-api #1191 on GitHub' })).toHaveTextContent('PR #1191')
    await expect(c.getAllByRole('link')).toHaveLength(1)
  },
}
/** Ended on its branch, with no pull request: merging it here, or opening one, is the choice. */
export const OnItsBranch: Story = {
  args: {
    ...CHANGE_BRANCH,
    actions: (
      <>
        <Button variant="signal">Open a pull request</Button>
        <Button>Merge into main here</Button>
      </>
    ),
  },
}

export const Accepting: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Accept and merge both' }))
    await expect(accept).toHaveBeenCalled()
    await userEvent.click(c.getByRole('button', { name: /Review the diff/ }))
    await expect(args.onReviewDiff).toHaveBeenCalledOnce()
    // A folder opens to its files, each by its path in it, opening its diff by its whole path.
    await userEvent.click(c.getByRole('button', { name: /^src\/auth/ }))
    await userEvent.click(c.getByRole('button', { name: 'Open the diff of src/auth/session.ts' }))
    await expect(args.onOpenFile).toHaveBeenCalledWith('src/auth/session.ts')
  },
}

/** On its branch, its remote not having it yet: the page gives Push, with the person's own git. */
export const BranchNotPushed: Story = {
  args: {
    ...CHANGE_BRANCH,
    remote: { name: 'origin', pushed: false, ahead: 2 },
    actions: <Button variant="signal">Push the branch to origin</Button>,
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Not on origin yet')).toBeInTheDocument()
    await expect(c.queryByRole('link', { name: /Open a pull request/ })).toBeNull()
  },
}

/** Pushed: the host's page for a pull request from it is a press away. */
export const BranchPushed: Story = {
  args: {
    ...CHANGE_BRANCH,
    prs: [
      {
        repo: 'meridian-api',
        files: PR_416[0]?.files ?? [],
        newPullRequest: { url: 'https://github.com/meridian/api/compare/main...althar/return-409-on-reuse?expand=1', host: 'GitHub' },
      },
    ],
    remote: { name: 'origin', pushed: true, ahead: 0 },
    actions: <Button variant="signal">Merge into main here</Button>,
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('On origin')).toBeInTheDocument()
    await expect(c.getByRole('link', { name: /Open a pull request on GitHub/ })).toHaveAttribute(
      'href',
      'https://github.com/meridian/api/compare/main...althar/return-409-on-reuse?expand=1',
    )
  },
}

/** Pushed, and the lead committed more since: the remote is behind. */
export const BranchBehind: Story = {
  args: { ...BranchPushed.args, remote: { name: 'origin', pushed: true, ahead: 1 } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('1 commit not on origin yet')).toBeInTheDocument()
  },
}

/** Several repositories, pushed: each says where its own pull request can be. */
export const BranchPushedSeveral: Story = {
  args: {
    ...CHANGE_BRANCH,
    prs: [
      {
        repo: 'meridian-api',
        files: PR_416[0]?.files ?? [],
        newPullRequest: { url: 'https://github.com/meridian/api/compare/main...x', host: 'GitHub' },
      },
      {
        repo: 'meridian-web',
        files: [{ path: 'meridian-web/src/refund.tsx', add: 12, del: 3 }],
        newPullRequest: { url: 'https://github.com/meridian/web/compare/main...x' },
      },
    ],
    remote: { name: 'origin', pushed: true, ahead: 0 },
    actions: undefined,
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('link', { name: 'Open a pull request on GitHub' })).toBeInTheDocument()
    await expect(c.getByRole('link', { name: 'Open a pull request' })).toBeInTheDocument()
  },
}

/** Merged on this Mac, not on its remote yet: a line says so, and the page gives the push. */
export const MergedHere: Story = {
  args: {
    ...CHANGE_BRANCH,
    state: ChangeState.Merged,
    note: 'Into main on this Mac. origin doesn’t have it yet.',
    actions: <Button variant="signal">Push main to origin</Button>,
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Into main on this Mac. origin doesn’t have it yet.')).toBeInTheDocument()
    await expect(c.getByRole('button', { name: 'Push main to origin' })).toBeInTheDocument()
  },
}

const MANY = [
  ...Array.from({ length: 56 }, (_, i) => ({
    path: `apps/desktop/src/renderer/features/project/part${i}.tsx`,
    add: 40 - (i % 30),
    del: i % 7,
  })),
  ...Array.from({ length: 33 }, (_, i) => ({ path: `packages/ui/src/screens/Settings/piece${i}.tsx`, add: 21, del: 9 })),
  ...Array.from({ length: 14 }, (_, i) => ({ path: `packages/runtime/src/settings${i}.ts`, add: 4, del: 2 })),
  ...Array.from({ length: 5 }, (_, i) => ({ path: `docs/adr/0${i}.md`, add: 4, del: 2 })),
  ...Array.from({ length: 3 }, (_, i) => ({ path: `packages/connectors/src/host${i}.ts`, add: 30, del: 3 })),
  { path: 'packages/contracts/src/Api.ts', add: 10, del: 2 },
  { path: 'packages/provider-adapters/src/codex.ts', add: 2, del: 1 },
  { path: 'apps/site/src/pages/index.astro', add: 3, del: 1 },
  { path: 'scripts/release.ts', add: 2, del: 2 },
  { path: 'README.md', add: 1, del: 1 },
]

/** A change of 116 files stays short: its folders, the most first, six of them and the rest a press away. */
export const ManyFiles: Story = {
  args: { ...CHANGE_ONE_REPO, prs: [{ ...PR_416[0]!, files: MANY }] },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('116 files')).toBeInTheDocument()
    const folders = c.getAllByRole('button', { name: /^(apps|packages|docs|scripts|Top level)/ })
    await expect(folders[0]).toHaveTextContent('apps/desktop56')
    await expect(folders).toHaveLength(6)
    await userEvent.click(c.getByRole('button', { name: '4 more folders' }))
    await expect(c.getByRole('button', { name: /^Top level/ })).toBeInTheDocument()
    await expect(foldersOf(MANY).map((folder) => folder.path)).toEqual([
      'apps/desktop',
      'packages/ui',
      'packages/runtime',
      'docs/adr',
      'packages/connectors',
      '',
      'apps/site',
      'packages/contracts',
      'packages/provider-adapters',
      'scripts',
    ])
  },
}

export const AllStates: Story = {
  parameters: statesParameters,
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'ready', node: <ChangeSet {...args} /> },
        { state: 'draft', node: <ChangeSet {...args} {...Draft.args} /> },
        { state: 'held', node: <ChangeSet {...args} {...Held.args} /> },
        { state: 'a check failed', node: <ChangeSet {...args} {...Failed.args} /> },
        { state: 'merged', node: <ChangeSet {...args} {...Merged.args} /> },
        { state: 'in the merge queue', node: <ChangeSet {...args} {...Queued.args} /> },
        { state: 'one repository', node: <ChangeSet {...args} {...CHANGE_ONE_REPO} /> },
        { state: 'on its branch', node: <ChangeSet {...args} {...OnItsBranch.args} /> },
        { state: 'on its branch, not pushed', node: <ChangeSet {...args} {...BranchNotPushed.args} /> },
        { state: 'on its branch, pushed', node: <ChangeSet {...args} {...BranchPushed.args} /> },
        { state: 'merged here, not pushed', node: <ChangeSet {...args} {...MergedHere.args} /> },
        { state: 'accept failed', node: <ChangeSet {...args} error="GitHub refused the merge: meridian-web is behind main." /> },
        { state: 'a host without a mark', node: <ChangeSet {...args} host={{ name: 'Gitea' }} /> },
      ]}
    />
  ),
}
