import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import {
  CHANGE_BRANCH,
  CHANGE_DRAFT,
  CHANGE_FAILED,
  CHANGE_HELD,
  CHANGE_MERGED,
  CHANGE_NIGHTLY,
  CHANGE_ONE_REPO,
  CHANGE_QUEUED,
  CHANGE_READY,
  CHANGE_REDIRECTS,
  PR_416,
} from '../../fixtures/outputs'
import { States, statesParameters } from '../../storybook/States'
import { ChangeState } from '../../foundations/vocabulary'
import { Button } from '../../primitives/Button/Button'
import { ChangeSet, foldersOf, groupsOf } from './ChangeSet'

const accept = fn()
const push = fn()
const open = fn()

/** As wide as it is beside what a task made; `alone`, as wide as the page gives it with nothing beside it. */
const SIDE = 360
const ALONE = 700

const meta = {
  title: 'Outputs/ChangeSet',
  component: ChangeSet,
  decorators: [(Story, { parameters }) => <div style={{ maxWidth: (parameters.width as number | undefined) ?? SIDE }}>{Story()}</div>],
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
/** Alone on the page: the button beside what it acts on, at its own width. */
export const ReadyAlone: Story = { parameters: { width: ALONE } }
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
/** Merged where no check ran: none will now, so nothing is said of them. */
export const MergedNoChecks: Story = {
  args: { ...CHANGE_MERGED, checks: [], review: undefined, actions: undefined },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByText('No checks have run yet')).toBeNull()
  },
}
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

export const Accepting: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Accept and merge both' }))
    await expect(accept).toHaveBeenCalled()
    await userEvent.click(c.getByRole('button', { name: /Review the diff/ }))
    await expect(args.onReviewDiff).toHaveBeenCalledOnce()
    // A few files are each there to press, opening its diff by its whole path.
    await userEvent.click(c.getByRole('button', { name: 'Open the diff of src/auth/session.ts' }))
    await expect(args.onOpenFile).toHaveBeenCalledWith('src/auth/session.ts')
  },
}

/** Ended on its branch, with no pull request: opening its draft pull request, or merging it here, is the choice. */
export const OnItsBranch: Story = {
  args: {
    ...CHANGE_BRANCH,
    actions: (
      <>
        <Button variant="signal" onClick={open}>
          Open a draft pull request
        </Button>
        <Button>Merge into main here</Button>
      </>
    ),
  },
  parameters: { width: ALONE },
}

/**
 * A nightly check its lead stopped, alone on the page: its branch by name, the two commits since it was pushed, and its draft pull
 * request the one thing to do. Each file is listed with its lines: a heading over each lone manifest would only repeat its path.
 */
export const NightlyCheck: Story = {
  args: {
    ...CHANGE_NIGHTLY,
    checks: undefined,
    review: undefined,
    push: (
      <Button variant="quiet" size="small" onClick={push}>
        Push to origin
      </Button>
    ),
    actions: (
      <Button variant="signal" onClick={open}>
        Open a draft pull request
      </Button>
    ),
  },
  parameters: { width: ALONE },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('althar/nightly-dependency-check-27-oct')).toBeInTheDocument()
    await expect(c.getByText('2 commits not pushed')).toBeInTheDocument()
    await expect(c.queryByText(/Not on origin/)).toBeNull()
    await expect(c.queryByText(/Top level|more folders/)).toBeNull()
    await expect(groupsOf(CHANGE_NIGHTLY.prs[0]?.files ?? [])).toBeNull()
    await userEvent.click(c.getByRole('button', { name: 'Open the diff of apps/cli/package.json' }))
    await expect(args.onOpenFile).toHaveBeenCalledWith('apps/cli/package.json')
    await userEvent.click(c.getByRole('button', { name: 'Open a draft pull request' }))
    await expect(open).toHaveBeenCalled()
  },
}

/** The same beside what a task made: the button under the facts, as wide as the card. */
export const NightlyCheckBeside: Story = { args: NightlyCheck.args }

/**
 * The nightly check once all of it is on origin, GitHub connected: nothing said of where it stands, and Althar's own button opens
 * its pull request, never GitHub's page for one.
 */
export const NightlyCheckPushed: Story = {
  args: {
    ...CHANGE_NIGHTLY,
    checks: undefined,
    review: undefined,
    remote: { name: 'origin', pushed: true, ahead: 0 },
    actions: (
      <Button variant="signal" onClick={open}>
        Open a draft pull request
      </Button>
    ),
  },
  parameters: { width: ALONE },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('althar/nightly-dependency-check-27-oct')).toBeInTheDocument()
    await expect(c.queryByText(/pushed|origin|so far/)).toBeNull()
    await expect(c.queryByRole('link', { name: /Open a pull request/ })).toBeNull()
    await userEvent.click(c.getByRole('button', { name: 'Open a draft pull request' }))
    await expect(open).toHaveBeenCalled()
  },
}

/** Althar can't open its pull request until GitHub is connected: connecting is the button, pushing it alone stays quiet. */
export const NotConnected: Story = {
  args: {
    ...CHANGE_NIGHTLY,
    checks: undefined,
    review: undefined,
    remote: { name: 'origin', pushed: false, ahead: 2 },
    note: 'Althar opens its pull request once GitHub is connected.',
    push: (
      <Button variant="quiet" size="small">
        Push to origin
      </Button>
    ),
    actions: <Button variant="signal">Connect GitHub</Button>,
  },
  parameters: { width: ALONE },
}

/**
 * All of it pushed and committed: nothing said of it. With no connection, connecting is the button, and the host's own page for its
 * pull request is a press away.
 */
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
    note: 'Althar opens its pull request once GitHub is connected.',
    actions: (
      <>
        <Button variant="signal">Connect GitHub</Button>
        <Button>Merge into main here</Button>
      </>
    ),
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.queryByText(/pushed|origin/)).toBeNull()
    await expect(c.getByRole('button', { name: 'Connect GitHub' })).toBeInTheDocument()
    await expect(c.getByRole('link', { name: /Open a pull request on GitHub/ })).toHaveAttribute(
      'href',
      'https://github.com/meridian/api/compare/main...althar/return-409-on-reuse?expand=1',
    )
  },
}

/**
 * Merging it here refused, beside what it made: why in a line, and the paths, each file's name whole where the card is too narrow
 * for its folder.
 */
export const RefusedHere: Story = {
  args: {
    ...CHANGE_REDIRECTS,
    checks: undefined,
    push: (
      <Button variant="quiet" size="small" onClick={push}>
        Push to origin
      </Button>
    ),
    actions: <Button variant="signal">Merge into main on this Mac</Button>,
    error: 'Your main checkout has uncommitted changes to middleware.ts.',
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('alert')).toHaveTextContent('Your main checkout has uncommitted changes to middleware.ts.')
    // Each file's name whole, apart from its folder, which keeps its slash and gives way first; the whole path on hover. Where
    // there is layout (Storybook, not jsdom), the name isn't cut either.
    const name = c.getByText('middleware.test.js')
    await expect(name.previousElementSibling).toHaveTextContent(/^tests\/unit\/$/)
    await expect(name.closest('[title]')).toHaveAttribute('title', 'tests/unit/middleware.test.js')
    await expect(name.scrollWidth).toBeLessThanOrEqual(name.clientWidth)
    await expect(c.getByText('middleware.ts').previousElementSibling).toBeNull()
  },
}

/** The same alone on the page: every path whole. */
export const RefusedHereAlone: Story = { args: RefusedHere.args, parameters: { width: ALONE } }

/** Pushed, with changes the lead never committed: said, since no push takes them. */
export const Uncommitted: Story = {
  args: { ...CHANGE_BRANCH, remote: { name: 'origin', pushed: true, ahead: 0 }, uncommitted: 2, actions: undefined },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Uncommitted changes in 2 files')).toBeInTheDocument()
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

/**
 * Drafts in two repositories, each with commits to push and to mark ready, and a new one to open: more than two buttons, so
 * they get a row of their own under what they act on, each at its own width, wrapping, just past where the card turns wide.
 */
export const SeveralActing: Story = {
  args: {
    ...CHANGE_DRAFT,
    actions: [
      <Button key="push-api" variant="signal">
        Push 2 commits to meridian-api
      </Button>,
      <Button key="push-web" variant="signal">
        Push 1 commit to meridian-web
      </Button>,
      <Button key="ready-api">Mark meridian-api ready for review</Button>,
      <Button key="ready-web">Mark meridian-web ready for review</Button>,
      <Button key="open">Open a new draft pull request</Button>,
    ],
  },
  parameters: { width: 560 },
  play: async ({ canvasElement }) => {
    const card = within(canvasElement).getByRole('article')
    const edge = card.getBoundingClientRect().right
    for (const button of within(card).getAllByRole('button', { name: /^(Push|Mark|Open a new)/ }))
      await expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(edge)
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

const GROUPED = [
  { path: 'README.md', add: 4, del: 1 },
  { path: 'src/refunds/create.ts', add: 21, del: 7 },
  { path: 'src/refunds/idempotency.ts', add: 9, del: 2 },
  { path: 'src/refunds/limits.ts', add: 34, del: 0 },
  { path: 'src/refunds/partners.ts', add: 12, del: 3 },
  { path: 'test/refunds/idempotency.test.ts', add: 18, del: 0 },
  { path: 'test/refunds/limits.test.ts', add: 41, del: 0 },
  { path: 'test/refunds/partners.test.ts', add: 22, del: 0 },
]

/** A few files, several to a folder: each folder a quiet heading over its files, the top of the repository under its name. */
export const GroupedFiles: Story = {
  args: { ...CHANGE_ONE_REPO, prs: [{ ...PR_416[0]!, files: GROUPED }] },
  parameters: { width: ALONE },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(groupsOf(GROUPED)?.map((folder) => folder.path)).toEqual(['', 'src/refunds', 'test/refunds'])
    await expect(c.getByText('meridian-api')).toBeInTheDocument()
    await expect(c.getByText('src/refunds')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Open the diff of test/refunds/limits.test.ts' }))
    await expect(args.onOpenFile).toHaveBeenCalledWith('test/refunds/limits.test.ts')
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

/** A change of 116 files stays short: its folders, the most first, each with how much changed in it, six and the rest a press away. */
export const ManyFiles: Story = {
  args: { ...CHANGE_ONE_REPO, prs: [{ ...PR_416[0]!, files: MANY }] },
  parameters: { width: ALONE },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('116 files')).toBeInTheDocument()
    const folders = c.getAllByRole('button', { name: /^(apps|packages|docs|scripts|meridian-api)/ })
    await expect(folders[0]).toHaveTextContent(/^apps\/desktop.*56 files$/)
    await expect(folders).toHaveLength(6)
    await userEvent.click(c.getByRole('button', { name: '4 more folders' }))
    // The top of the repository is under its name.
    await expect(c.getByRole('button', { name: /^meridian-api/ })).toBeInTheDocument()
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
        { state: 'on its branch, commits not pushed', node: <ChangeSet {...args} {...NightlyCheck.args} /> },
        { state: 'on its branch, not connected', node: <ChangeSet {...args} {...NotConnected.args} /> },
        { state: 'on its branch, pushed', node: <ChangeSet {...args} {...NightlyCheckPushed.args} /> },
        { state: 'on its branch, pushed, not connected', node: <ChangeSet {...args} {...BranchPushed.args} /> },
        { state: 'on its branch, uncommitted', node: <ChangeSet {...args} {...Uncommitted.args} /> },
        { state: 'merged here, not pushed', node: <ChangeSet {...args} {...MergedHere.args} /> },
        { state: 'accept failed', node: <ChangeSet {...args} error="GitHub refused the merge: meridian-web is behind main." /> },
        { state: 'a host without a mark', node: <ChangeSet {...args} host={{ name: 'Gitea' }} /> },
      ]}
    />
  ),
}
