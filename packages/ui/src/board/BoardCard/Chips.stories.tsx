import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { GITHUB } from '../../fixtures/outputs'
import { SHOT_AFTER, SHOT_BEFORE } from '../../fixtures/shots'
import { States } from '../../storybook/States'
import { laneDecorator } from '../../storybook/lane'
import { BranchChip, CommandChip, Fact, FileChips, Findings, PullChip, Thumbs } from './Chips'

/* The chips a board card holds, each at a card's width, and narrow, where what gives way first shows. */

const meta = {
  title: 'Board/Chips',
  component: PullChip,
  decorators: [laneDecorator],
  args: { host: GITHUB, repo: 'meridian-api', number: 1187, add: 412, del: 37 },
} satisfies Meta<typeof PullChip>
export default meta
type Story = StoryObj<typeof meta>

const pictures = [SHOT_BEFORE, SHOT_AFTER].map((shot) => ({ id: shot.id, src: shot.src ?? '', name: shot.name }))
const narrow = { width: 190 }

/** The task's own pull request: its host's mark, repository, number and size. */
export const PullRequest: Story = {
  play: async ({ canvasElement }) => {
    const chip = within(canvasElement)
    await expect(chip.getByText('meridian-api')).toBeInTheDocument()
    await expect(chip.getByText('#1187')).toBeInTheDocument()
    await expect(chip.getByText('+412')).toBeInTheDocument()
  },
}
/** Someone else's: its number whole, then whose it is, which gives way first. */
export const TheirPullRequest: Story = {
  args: { repo: undefined, number: 1199, add: 58, del: 20, by: 'ninemate' },
  play: async ({ canvasElement }) => {
    const chip = within(canvasElement)
    await expect(chip.getByText('#1199')).toBeInTheDocument()
    await expect(chip.getByText('ninemate')).toBeInTheDocument()
    await expect(chip.queryByText('meridian-api')).not.toBeInTheDocument()
  },
}
/** A host that doesn't count lines: no size, rather than +0 −0. */
export const LinesUncounted: Story = {
  args: { add: undefined, del: undefined },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByText('+0')).not.toBeInTheDocument()
  },
}
/** A host Althar has no mark for, and GitLab's own prefix. */
export const NoMarkOtherPrefix: Story = {
  args: { host: { name: 'Gitea' }, text: { number: (n: number) => `!${n}` } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('!1187')).toBeInTheDocument()
  },
}
export const Branch: Story = {
  render: () => <BranchChip name="meridian/return-409-on-reused-idempotency-key" add={84} del={6} />,
}
export const BranchUncounted: Story = { render: () => <BranchChip name="meridian/return-409" /> }
export const Files: Story = {
  render: () => (
    <FileChips
      files={[
        { path: 'docs/releases/partners/release-notes-0.4.md', add: 64 },
        { path: 'CHANGELOG.md', add: 3 },
        { path: '/tmp/refund-ids.csv', add: null },
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    const chips = within(canvasElement)
    await expect(chips.getAllByRole('listitem')).toHaveLength(3)
    // A file at the top of its repository has no folder to give way.
    await expect(chips.getByText('CHANGELOG.md')).toBeInTheDocument()
  },
}
export const Pictures: Story = {
  render: () => <Thumbs pictures={pictures} />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('list', { name: 'Pictures' })).toBeInTheDocument()
  },
}
export const PicturesBeingMade: Story = { render: () => <Thumbs pictures={pictures.slice(0, 1)} making={2} /> }
export const Command: Story = { render: () => <CommandChip>bun run scripts/backfill-idempotency.ts --env staging --batch 500</CommandChip> }
export const Facts: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 8, fontSize: 11.5 }}>
      <Fact>6 of 8 checks passed</Fact>
      <Fact icon="check" tone="ok">
        All 8 checks passed
      </Fact>
      <Fact icon="branch" tone="warm">
        Conflicts with main in 2 files
      </Fact>
      <Fact icon="close" tone="danger">
        2 checks failed
      </Fact>
    </div>
  ),
}
export const FindingsCount: Story = {
  render: () => <Findings count={3} detail="1 blocking · request changes" />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('3 findings')).toBeInTheDocument()
  },
}
export const OneFinding: Story = {
  render: () => <Findings count={1} />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('1 finding')).toBeInTheDocument()
  },
}

export const AllStates: Story = {
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'pull request', node: <PullChip {...args} /> },
        { state: 'theirs', node: <PullChip host={GITHUB} number={1199} add={58} del={20} by="ninemate" /> },
        { state: 'uncounted', node: <PullChip host={GITHUB} repo="meridian-api" number={1187} /> },
        {
          state: 'theirs, narrow',
          node: (
            <div style={narrow}>
              <PullChip host={GITHUB} number={11990} add={1058} del={220} by="a-very-long-handle-for-someone" />
            </div>
          ),
        },
        { state: 'branch', node: <BranchChip name="meridian/return-409-on-reused-idempotency-key" add={84} del={6} /> },
        {
          state: 'files, narrow',
          node: (
            <div style={narrow}>
              <FileChips files={[{ path: 'docs/releases/partners/release-notes-0.4.md', add: 64 }]} />
            </div>
          ),
        },
        { state: 'pictures', node: <Thumbs pictures={pictures} making={1} /> },
        { state: 'command', node: <CommandChip>bun run scripts/backfill-idempotency.ts --env staging --batch 500</CommandChip> },
        { state: 'fact', node: <Fact>6 of 8 checks passed</Fact> },
        {
          state: 'fact, ok',
          node: (
            <Fact icon="check" tone="ok">
              All 8 checks passed
            </Fact>
          ),
        },
        {
          state: 'fact, warm',
          node: (
            <Fact icon="branch" tone="warm">
              Conflicts with main in 2 files
            </Fact>
          ),
        },
        {
          state: 'fact, danger',
          node: (
            <Fact icon="close" tone="danger">
              2 checks failed
            </Fact>
          ),
        },
        { state: 'findings', node: <Findings count={3} detail="1 blocking · request changes" /> },
      ]}
    />
  ),
}
