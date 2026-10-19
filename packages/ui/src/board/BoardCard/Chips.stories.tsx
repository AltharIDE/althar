import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { GITHUB } from '../../fixtures/outputs'
import { SHOT_AFTER, SHOT_BEFORE } from '../../fixtures/shots'
import { States } from '../../storybook/States'
import { laneDecorator } from '../../storybook/lane'
import { BoardCard } from './BoardCard'
import { BranchChip, CommandChip, Fact, FactLine, FileChips, Findings, NextStep, PullChip, Thumbs } from './Chips'

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
      <Fact tone="live">Checks running, 2 of 5 passed</Fact>
    </div>
  ),
}
/** What stands between a ready change and merging, as one line, the most pressing first; then the one next thing, at the foot's end. */
export const FactsInALine: Story = {
  render: () => (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 10px', fontSize: 11.5 }}>
      <FactLine>
        <Fact key="push" icon="up" tone="warm">
          2 commits not on the PR
        </Fact>
        <Fact key="checks" tone="danger">
          harness / verify failed
        </Fact>
      </FactLine>
      <NextStep onPress={() => {}} label="Push 2 commits to #1187" signal>
        Push 2 commits
      </NextStep>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const line = within(canvasElement)
    await expect(line.getByText('2 commits not on the PR')).toBeInTheDocument()
    await expect(line.getByText('harness / verify failed')).toBeInTheDocument()
    // One middot between two facts, and none before the first.
    await expect(line.getAllByText('·')).toHaveLength(1)
    await expect(line.getByRole('button', { name: 'Push 2 commits to #1187' })).toBeInTheDocument()
  },
}
/** A step the person does from the card is a button of its own; pressing it does the step and does not open the card. */
const opened = fn()
export const NextStepButton: Story = {
  render: () => (
    <BoardCard
      word="Ready to accept"
      title="Add a retry to the sync"
      onOpen={opened}
      foot={
        <NextStep signal onPress={fn()} label="Push 13 commits to #189">
          Push 13 commits
        </NextStep>
      }
    />
  ),
  play: async ({ canvasElement }) => {
    const card = within(canvasElement)
    opened.mockClear()
    await userEvent.click(card.getByRole('button', { name: 'Push 13 commits to #189' }))
    await expect(opened).not.toHaveBeenCalled()
    await userEvent.click(card.getByRole('button', { name: 'Add a retry to the sync' }))
    await expect(opened).toHaveBeenCalledOnce()
  },
}
/** A push that failed says why in the foot's line, and the button offers to try again. */
export const NextStepFailed: Story = {
  render: () => (
    <BoardCard
      word="Ready to accept"
      title="Add a retry to the sync"
      onOpen={opened}
      foot={
        <>
          <FactLine>
            <Fact key="failed" icon="close" tone="danger" role="alert">
              Push failed: the branch is protected
            </Fact>
            <Fact key="unpushed" tone="warm">
              13 commits not on the PR
            </Fact>
          </FactLine>
          <NextStep signal onPress={fn()} label="Try pushing 13 commits to #189 again">
            Try again
          </NextStep>
        </>
      }
    />
  ),
  play: async ({ canvasElement }) => {
    const card = within(canvasElement)
    await expect(card.getByRole('alert')).toHaveTextContent('Push failed: the branch is protected')
    await expect(card.getByRole('button', { name: 'Try pushing 13 commits to #189 again' })).toBeInTheDocument()
  },
}
/** Under way it says so, stays focusable and ignores presses. */
export const NextStepBusy: Story = {
  render: () => {
    const press = fn()
    return (
      <NextStep signal busy onPress={press} label="Push 13 commits to #189" doing="Pushing 13 commits">
        Push 13 commits
      </NextStep>
    )
  },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Push 13 commits to #189' })
    await expect(button).toHaveAttribute('aria-busy', 'true')
    await expect(button).toHaveTextContent('Pushing 13 commits')
  },
}
/** What needs the lead is words with an arrow, a link into the task: the card around it opens the task. */
export const NextStepLink: Story = {
  render: () => <NextStep>Ask the lead to fix it</NextStep>,
  play: async ({ canvasElement }) => {
    const step = within(canvasElement)
    await expect(step.getByText('Ask the lead to fix it')).toBeInTheDocument()
    await expect(step.queryByRole('button')).toBeNull()
  },
}
/** A live fact has its cobalt dot, not a glyph, even given one. */
export const LiveFact: Story = {
  render: () => (
    <Fact tone="live" icon="check">
      Checks running, 2 of 5 passed
    </Fact>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Checks running, 2 of 5 passed')).toBeInTheDocument()
    await expect(canvasElement.querySelector('svg')).toBeNull()
  },
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
        { state: 'fact, live', node: <Fact tone="live">Checks running, 2 of 5 passed</Fact> },
        {
          state: 'facts in a line, narrow',
          node: (
            <div style={{ ...narrow, fontSize: 11.5 }}>
              <FactLine>
                <Fact key="push" icon="up" tone="warm">
                  2 commits not on the PR
                </Fact>
                <Fact key="checks" tone="danger">
                  harness / verify failed
                </Fact>
              </FactLine>
            </div>
          ),
        },
        { state: 'next, a link', node: <NextStep>Ask the lead to fix it</NextStep> },
        {
          state: 'next, a button',
          node: (
            <NextStep signal onPress={() => {}}>
              Accept and merge
            </NextStep>
          ),
        },
        {
          state: 'next, pushing',
          node: (
            <NextStep signal busy onPress={() => {}} doing="Pushing 13 commits">
              Push 13 commits
            </NextStep>
          ),
        },
        { state: 'findings', node: <Findings count={3} detail="1 blocking · request changes" /> },
      ]}
    />
  ),
}
