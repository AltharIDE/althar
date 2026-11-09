import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'

import { Brand } from '../../foundations/brands/brands'
import { TaskEnd } from '../../foundations/vocabulary'
import { States } from '../../storybook/States'
import { PullRequestPreview } from './PullRequestPreview'
import { PULL_REQUEST_PREVIEW_SAMPLE } from './samples'

const meta = {
  title: 'Setup/TaskPreviews/PullRequestPreview',
  component: PullRequestPreview,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div style={{ width: 640 }}>{Story()}</div>],
  args: { end: TaskEnd.DraftPr, screenshots: false, issues: true, seal: true, sample: PULL_REQUEST_PREVIEW_SAMPLE },
} satisfies Meta<typeof PullRequestPreview>
export default meta
type Story = StoryObj<typeof meta>

const pr = (canvasElement: HTMLElement) => within(canvasElement).getByRole('figure', { name: 'A pull request as GitHub shows it' })

/** A draft, as tasks open by default: its branch into main, its description with the seal, and its issue In Progress. */
export const Draft: Story = {
  play: async ({ canvasElement }) => {
    const page = pr(canvasElement)
    await expect(page).toHaveTextContent('Draft')
    await expect(page).toHaveTextContent('Retry the checkout call with backoff #212')
    await expect(page).toHaveTextContent('balazs wants to merge 3 commits into main from althar/dev-212-retry-checkout')
    await expect(page.querySelector('img')).not.toBeNull()
    await expect(page).toHaveTextContent('DEV-212In Progress')
    await expect(within(page).queryByRole('img', { name: 'Screenshots from the task' })).toBeNull()
  },
}

/** Opened for review: Open, and its issue In Review. */
export const OpenForReview: Story = {
  args: { end: TaskEnd.ReadyPr },
  play: async ({ canvasElement }) => {
    const page = pr(canvasElement)
    await expect(page).toHaveTextContent('Open')
    await expect(page).toHaveTextContent('In Review')
  },
}

/** With the lead's screenshots posted to it. */
export const WithScreenshots: Story = {
  args: { end: TaskEnd.ReadyPr, screenshots: true },
  play: async ({ canvasElement }) => {
    await expect(within(pr(canvasElement)).getByRole('img', { name: 'Screenshots from the task' })).toBeInTheDocument()
  },
}

/** Its issue left where it was: Todo. */
export const IssuesStayPut: Story = {
  args: { issues: false },
  play: async ({ canvasElement }) => {
    await expect(pr(canvasElement)).toHaveTextContent('DEV-212Todo')
  },
}

/** No seal, and a project with no tracker: only its description. */
export const NoSealNoTracker: Story = {
  args: { seal: false, sample: { ...PULL_REQUEST_PREVIEW_SAMPLE, issue: undefined } },
  play: async ({ canvasElement }) => {
    const page = pr(canvasElement)
    await expect(page.querySelector('img')).toBeNull()
    await expect(page).not.toHaveTextContent('DEV-212')
  },
}

/** Pushing the branch only: GitHub's line that it had recent pushes, and its button, a picture nothing in which takes focus. */
export const PushTheBranchOnly: Story = {
  args: { end: TaskEnd.PushOnly },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const branch = c.getByRole('figure', { name: 'A branch as GitHub shows it' })
    await expect(branch).toHaveTextContent('althar/dev-212-retry-checkout had recent pushes 2 minutes ago')
    await expect(branch).toHaveTextContent('Compare & pull request')
    await expect(within(branch).queryByRole('button')).toBeNull()
    await userEvent.tab()
    await expect(branch.contains(document.activeElement)).toBe(false)
  },
}

/** A project's own facts: its branch, its default branch, its tracker's key, long ones wrapping. */
export const ProjectFacts: Story = {
  args: {
    end: TaskEnd.ReadyPr,
    screenshots: true,
    sample: {
      ...PULL_REQUEST_PREVIEW_SAMPLE,
      title: 'Backfill idempotency keys on every refund created before the ledger migration landed',
      base: 'release/2026.11-hotfixes',
      branch: 'althar/ops-1184-backfill-idempotency-keys-on-refunds-before-ledger-migration',
      issue: { key: 'OPS-1184', tracker: Brand.Jira },
    },
  },
}

export const DraftDark: Story = { ...Draft, globals: { theme: 'dark' } }
export const PushTheBranchOnlyDark: Story = { ...PushTheBranchOnly, globals: { theme: 'dark' } }

/** In the narrowest sheet, an 800 px window: the branches wrap, the seal stays in its corner. */
export const Narrow: Story = {
  args: { end: TaskEnd.ReadyPr, screenshots: true },
  decorators: [(Story) => <div style={{ width: 420 }}>{Story()}</div>],
}

export const AllStates: Story = {
  render: () => (
    <States
      size="wide"
      cells={[
        {
          state: 'draft',
          node: <PullRequestPreview end={TaskEnd.DraftPr} screenshots={false} issues seal sample={PULL_REQUEST_PREVIEW_SAMPLE} />,
        },
        { state: 'open', node: <PullRequestPreview end={TaskEnd.ReadyPr} screenshots issues seal sample={PULL_REQUEST_PREVIEW_SAMPLE} /> },
        {
          state: 'no seal, issues stay',
          node: (
            <PullRequestPreview
              end={TaskEnd.DraftPr}
              screenshots={false}
              issues={false}
              seal={false}
              sample={PULL_REQUEST_PREVIEW_SAMPLE}
            />
          ),
        },
        {
          state: 'branch only',
          node: <PullRequestPreview end={TaskEnd.PushOnly} screenshots={false} issues seal sample={PULL_REQUEST_PREVIEW_SAMPLE} />,
        },
      ]}
    />
  ),
}
