import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { TaskKind, TaskStatus } from '../../foundations/vocabulary'
import {
  CHANGE_CONFLICT,
  CHANGE_PERMISSION,
  CHANGE_QUESTION,
  CHANGE_QUEUED,
  CHANGE_QUEUED_MIDWAY,
  CHANGE_READY,
  CHANGE_RUNNING,
  CHANGE_RUNNING_PR,
  CHANGE_STOPPED,
  CHANGE_STUCK,
  KIND_CARDS,
  PLAIN_FILES,
  PLAIN_FINISHED,
  PLAIN_PICTURES,
  PLAIN_PICTURES_MAKING,
  PLAIN_WORKING,
  REVIEW_DRAFTED,
  REVIEW_RUNNING,
} from '../../fixtures/kinds'
import { States, statesOn } from '../../storybook/States'
import { cardStates, laneDecorator } from '../../storybook/lane'
import { SettleWays } from '../SettleWays/SettleWays'
import { BoardCard } from './BoardCard'
import { BranchChip, Fact, FactLine, NextStep, PullChip } from './Chips'
import { GITHUB } from '../../fixtures/outputs'

const resolveNow = fn()

const meta = {
  title: 'Board/BoardCard',
  component: BoardCard,
  decorators: [laneDecorator],
  // What every card has; the rest is each story's own, so none carries another's track or chip.
  args: {
    status: TaskStatus.Running,
    word: CHANGE_RUNNING.word,
    kind: TaskKind.Change,
    at: '9m',
    title: CHANGE_RUNNING.title,
    onOpen: fn(),
  },
} satisfies Meta<typeof BoardCard>
export default meta
type Story = StoryObj<typeof meta>

/** A change at work: its step in cobalt, its kind, its steps, and its branch with how big it is so far. */
export const ChangeRunning: Story = {
  args: CHANGE_RUNNING,
  play: async ({ canvasElement }) => {
    const card = within(canvasElement)
    // Its step's word, on top and under its bar.
    await expect(card.getAllByText('Implement')).toHaveLength(2)
    await expect(card.getByText('Change')).toBeInTheDocument()
    await expect(card.getByRole('list', { name: 'Steps' })).toBeInTheDocument()
    await expect(card.getByText('meridian/return-409-on-reused-idempotency-key')).toBeInTheDocument()
    // Nothing on it is pressed but the card itself.
    await expect(card.getAllByRole('button')).toHaveLength(1)
  },
}
/** A follow-up on a change whose pull request is open: the pull request, and its checks so far. */
export const ChangeRunningWithItsPullRequest: Story = { args: CHANGE_RUNNING_PR }
export const ReadyToAccept: Story = {
  args: CHANGE_READY,
  play: async ({ canvasElement }) => {
    const card = within(canvasElement)
    await expect(card.getByText('Ready to accept')).toBeInTheDocument()
    await expect(card.getByText('#1187')).toBeInTheDocument()
    await expect(card.getByText('All 8 checks passed')).toBeInTheDocument()
    await expect(card.queryByText(/Review/)).not.toBeInTheDocument()
  },
}
/*
 * A ready change's foot, as the board says it: what blocks first, then what to do, then what is fine. Where the facts
 * don't fit on one line they are a list, a glyph column and no middots; the next step sits under them, with them.
 */
const readyFoot = (
  width: number,
  stacked: boolean,
  facts: ReadonlyArray<{ words: string; icon?: 'up' | 'branch' | 'close' | 'check'; tone: 'warm' | 'danger' | 'live' | 'ok' }>,
  step?: string,
) => ({
  render: () => (
    <div style={{ width }}>
      <BoardCard
        status={TaskStatus.Yours}
        word="Ready to accept"
        kind={TaskKind.Change}
        at="31m"
        title="Drop any file or folder onto the composer"
        object={<PullChip host={GITHUB} repo="althar" number={344} add={412} del={37} />}
        foot={
          <>
            <FactLine stacked={stacked}>
              {facts.map((one) => (
                <Fact key={one.words} {...(one.icon === undefined ? {} : { icon: one.icon })} tone={one.tone}>
                  {one.words}
                </Fact>
              ))}
            </FactLine>
            {step !== undefined && (
              <NextStep signal onPress={fn()} label={`${step} to #344`}>
                {step}
              </NextStep>
            )}
          </>
        }
      />
    </div>
  ),
})
/** No line of facts starts with a middot, wherever it wraps. */
const noStrayDots = async (canvasElement: HTMLElement) => {
  for (const part of canvasElement.querySelectorAll('[class*="factLinePart"]'))
    await expect((part.textContent ?? '').trimStart().startsWith('·')).toBe(false)
}
const THE_FACTS = [
  { words: 'The push should resolve the conflict with main', icon: 'up', tone: 'warm' },
  { words: 'Checks running, 11 of 12 passed', tone: 'live' },
] as const
/** The card that was ugly: commits to push that resolve a conflict, checks running, on a narrow card. A list, not a wrapped line. */
export const ReadyPushResolvesConflictNarrow: Story = {
  ...readyFoot(260, true, THE_FACTS, 'Push 5 commits'),
  play: async ({ canvasElement }) => {
    const card = within(canvasElement)
    await expect(card.getAllByRole('listitem')).toHaveLength(2)
    await expect(card.queryByText('·')).not.toBeInTheDocument()
    await noStrayDots(canvasElement)
    await expect(card.queryByText(/^Conflicts with main/)).not.toBeInTheDocument()
    const button = card.getByRole('button', { name: 'Push 5 commits to #344' })
    await userEvent.click(button)
    // Pressed with the mouse, it shows no focus ring.
    await expect(button.matches(':focus-visible')).toBe(false)
    await expect(getComputedStyle(button).outlineStyle).not.toBe('solid')
  },
}
/** Left to itself, on a narrow card the facts become a list; its width is measured, so the story is laid out in a browser. */
export const ReadyFactsMeasuredNarrow: Story = {
  render: () => (
    <div style={{ width: 260 }}>
      <BoardCard
        status={TaskStatus.Yours}
        word="Ready once pushed"
        kind={TaskKind.Change}
        at="31m"
        title="Drop any file or folder onto the composer"
        foot={
          <FactLine>
            {THE_FACTS.map((one) => (
              <Fact key={one.words} {...('icon' in one ? { icon: one.icon } : {})} tone={one.tone}>
                {one.words}
              </Fact>
            ))}
          </FactLine>
        }
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const line = canvasElement.querySelector('[class*="factLine"]')
    // jsdom has no layout to measure; a browser does.
    if (line !== null && line.scrollWidth > 0) await expect(line).toHaveAttribute('data-stacked')
  },
}
/** Failed checks block, so they come before what is still running. */
export const ReadyChecksFailedNarrow: Story = {
  ...readyFoot(
    260,
    true,
    [
      { words: 'harness / verify failed', icon: 'close', tone: 'danger' },
      { words: 'Checks running, 3 of 4 passed', tone: 'live' },
    ],
    'Push 2 commits',
  ),
  play: async ({ canvasElement }) => {
    const items = within(canvasElement).getAllByRole('listitem')
    await expect(items.map((item) => item.textContent)).toEqual(['harness / verify failed', 'Checks running, 3 of 4 passed'])
    await noStrayDots(canvasElement)
  },
}
/**
 * Failing checks its lead brought to the person rather than fixing (ADR-070): only the check that fails, its lead's line being in
 * its task; nothing to ask of the lead, which said what would fix it.
 */
export const ReadyChecksBroughtBackNarrow: Story = {
  render: () => (
    <div style={{ width: 260 }}>
      <BoardCard
        status={TaskStatus.Yours}
        word="Not ready to accept"
        kind={TaskKind.Change}
        at="31m"
        title="Drop any file or folder onto the composer"
        object={<PullChip host={GITHUB} repo="althar" number={344} add={412} del={37} />}
        foot={
          <FactLine>
            <Fact icon="close" tone="danger">
              runtime (windows) failed
            </Fact>
          </FactLine>
        }
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[class*="factLine"]')?.textContent).toBe('runtime (windows) failed')
    await expect(within(canvasElement).queryByRole('button', { name: /fix/i })).not.toBeInTheDocument()
    await noStrayDots(canvasElement)
  },
}
/** Everything fine: one fact, green, nothing to push. */
export const ReadyAllGreen: Story = {
  ...readyFoot(260, true, [{ words: 'All 12 checks passed', icon: 'check', tone: 'ok' }], 'Accept and merge'),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('All 12 checks passed')).toBeInTheDocument()
    await noStrayDots(canvasElement)
  },
}
/** Two short facts on a wide card stay on one line, a middot between them and none before the first. */
export const ReadyFactsOnOneLine: Story = {
  ...readyFoot(
    420,
    false,
    [
      { words: 'test failed', icon: 'close', tone: 'danger' },
      { words: 'Checks running, 3 of 4 passed', tone: 'live' },
    ],
    'Push 2 commits',
  ),
  play: async ({ canvasElement }) => {
    const card = within(canvasElement)
    await expect(card.queryAllByRole('listitem')).toHaveLength(0)
    await expect(card.getAllByText('·')).toHaveLength(1)
    // On one line a middot sits between facts, never before the first.
    await expect((canvasElement.querySelector('[class*="factLinePart"]')?.textContent ?? '').startsWith('·')).toBe(false)
  },
}
/** A conflict its lead couldn't resolve: warm, with a glyph, and why under the title. */
export const MergeConflict: Story = { args: CHANGE_CONFLICT }
/** Files by name, three at most; a long unbroken word still wraps inside the card at its narrowest. */
export const MergeConflictLongNote: Story = {
  args: {
    ...CHANGE_CONFLICT,
    why: 'The lead couldn’t resolve the conflict with main in accounts.test.ts, heldKept.test.ts, packages/runtime/tests/aVeryLongFileNameThatHasNoPlaceToBreakAtAll.test.ts and 3 more. origin/main isn’t merged into the branch.',
  },
  decorators: [(Story) => <div style={{ width: 232 }}>{Story()}</div>],
  play: async ({ canvasElement }) => {
    const why = canvasElement.querySelector('[class*="why"]') as HTMLElement
    await expect(why.scrollWidth).toBeLessThanOrEqual(why.clientWidth)
  },
}
/**
 * A conflict Althar didn't ask its lead to resolve, though its rules say to:
 * why, in one line, and Resolve now, which asks the lead anyway (ADR-030).
 */
export const MergeConflictNotAsked: Story = {
  args: {
    ...CHANGE_CONFLICT,
    why: undefined,
    foot: (
      <>
        <FactLine>
          <Fact icon="branch" tone="warm">
            It has no lead yet to ask.
          </Fact>
        </FactLine>
        <NextStep signal onPress={resolveNow}>
          Resolve now
        </NextStep>
      </>
    ),
  },
  play: async ({ canvasElement, args }) => {
    const card = within(canvasElement)
    await expect(card.getByText('Merge conflict')).toBeInTheDocument()
    await userEvent.click(card.getByRole('button', { name: 'Resolve now' }))
    await expect(resolveNow).toHaveBeenCalledOnce()
    // Its own button: the card doesn't open.
    await expect(args.onOpen).not.toHaveBeenCalled()
  },
}
export const Permission: Story = {
  args: CHANGE_PERMISSION,
  play: async ({ canvasElement }) => {
    const card = within(canvasElement)
    await expect(card.getByText(/staging database/)).toBeInTheDocument()
    await expect(card.getByText(/backfill-idempotency/)).toBeInTheDocument()
    // Answered in its task: no Allow here.
    await expect(card.queryByText('Allow')).not.toBeInTheDocument()
  },
}
export const Question: Story = { args: CHANGE_QUESTION }
export const Stuck: Story = { args: CHANGE_STUCK }
export const ReviewRunning: Story = {
  args: REVIEW_RUNNING,
  play: async ({ canvasElement }) => {
    const card = within(canvasElement)
    // Someone else's pull request: its number whole, and whose it is.
    await expect(card.getByText('#1202')).toBeInTheDocument()
    await expect(card.getByText('okafor-dev')).toBeInTheDocument()
    await expect(card.getByText('Review')).toBeInTheDocument()
  },
}
export const ReviewDrafted: Story = {
  args: REVIEW_DRAFTED,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('3 findings')).toBeInTheDocument()
  },
}
/** A plain task says where it stands and nothing of its kind. */
export const PlainWorking: Story = {
  args: PLAIN_WORKING,
  play: async ({ canvasElement }) => {
    const card = within(canvasElement)
    await expect(card.getByText('Working')).toBeInTheDocument()
    await expect(card.queryByText('Change')).not.toBeInTheDocument()
    await expect(card.queryByRole('list', { name: 'Steps' })).not.toBeInTheDocument()
  },
}
/** Finished: its Done and Keep for later in its corner, shown as it is hovered or has the focus. */
export const PlainFinished: Story = {
  args: { ...PLAIN_FINISHED, corner: <SettleWays onDone={fn()} onKeep={fn()} doneHint="Settle it, and stop its page." /> },
  play: async ({ canvasElement }) => {
    const card = within(canvasElement)
    await userEvent.hover(card.getByText('Finished'))
    await expect(card.getByRole('button', { name: 'Done' })).toBeInTheDocument()
    await expect(card.getByRole('button', { name: 'Keep for later' })).toBeInTheDocument()
  },
}
export const PlainWithPictures: Story = {
  args: PLAIN_PICTURES,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByRole('img')).toHaveLength(3)
  },
}
/** One of its pictures still being made, in its place. */
export const PlainWithAPictureBeingMade: Story = {
  args: PLAIN_PICTURES_MAKING,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Being made')).toBeInTheDocument()
  },
}
export const PlainWithFiles: Story = {
  args: PLAIN_FILES,
  play: async ({ canvasElement }) => {
    const card = within(canvasElement)
    // The name whole, and the folder before it, which gives way first.
    await expect(card.getByText('release-notes-0.4.md')).toBeInTheDocument()
    await expect(card.getByText('docs/releases/partners/')).toBeInTheDocument()
  },
}
/** Waiting for a free agent before any work: only its title, its status and why. */
export const WaitingForAnAgent: Story = { args: CHANGE_QUEUED }
/** Waiting for a free agent after real work: its done steps and branch stay, and the step it waits for is empty and still. */
export const WaitingForAnAgentMidway: Story = { args: CHANGE_QUEUED_MIDWAY }
/** Waiting while more agents are busy than the computer runs at once, by what the person started: how many more. */
export const WaitingOverTheNumber: Story = {
  args: { ...CHANGE_QUEUED_MIDWAY, why: '6 of 6 agents busy on this Mac, and 1 more' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('6 of 6 agents busy on this Mac, and 1 more')).toBeInTheDocument()
  },
}
export const Stopped: Story = { args: CHANGE_STOPPED }
const carryOn = fn()
/**
 * Stopped, with a conflict its lead wasn't asked about: what stopped it and when lead, the conflict is one quiet line under them,
 * and Carry on, which tells the lead to merge the default branch in on its way, is the one thing to press.
 */
export const StoppedInConflict: Story = {
  args: {
    status: TaskStatus.Stopped,
    word: 'Stopped',
    kind: TaskKind.Change,
    at: 'Oct 27',
    title: 'Nightly dependency check, 27 Oct',
    why: 'Stopped by Althar',
    from: 'Nightly dependency check',
    object: <BranchChip name="althar/nightly-dependency-check-27-oct" add={287} del={375} />,
    foot: (
      <>
        <FactLine>
          <Fact icon="branch" tone="warm">
            Conflicts with the default branch
          </Fact>
        </FactLine>
        <NextStep signal onPress={carryOn}>
          Carry on
        </NextStep>
      </>
    ),
  },
  play: async ({ canvasElement, args }) => {
    const card = within(canvasElement)
    await expect(card.getByText('Stopped by Althar')).toBeInTheDocument()
    await expect(card.getByText('Conflicts with the default branch')).toBeInTheDocument()
    await expect(card.queryByRole('button', { name: 'Resolve now' })).toBeNull()
    await userEvent.click(card.getByRole('button', { name: 'Carry on' }))
    await expect(carryOn).toHaveBeenCalledOnce()
    await expect(args.onOpen).not.toHaveBeenCalled()
  },
}
export const Current: Story = { args: { current: true } }
export const LongTitle: Story = {
  args: {
    title: 'Return 409 when a refund idempotency key is reused across partners, and say which partner reused it first in the response body',
  },
}
/** The kinds' words, in another language. */
export const Translated: Story = {
  args: {
    ...REVIEW_RUNNING,
    kind: TaskKind.Review,
    text: { kind: { [TaskKind.Change]: 'Änderung', [TaskKind.Review]: 'Prüfung', [TaskKind.Plain]: '' } },
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Prüfung')).toBeInTheDocument()
  },
}

export const Opening: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: CHANGE_RUNNING.title }))
    await expect(args.onOpen).toHaveBeenCalledOnce()
  },
}

/** Without a way to open it, its title is words, and nothing on it is a button. */
export const NothingOpensIt: Story = {
  args: { onOpen: undefined },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button')).not.toBeInTheDocument()
  },
}

/** A task an automation's run started: which one, quietly, at its foot. Still nothing to press but the card. */
export const FromAnAutomation: Story = {
  args: { ...REVIEW_RUNNING, from: 'Morning review' },
  play: async ({ canvasElement }) => {
    const card = within(canvasElement)
    await expect(card.getByText('From Morning review')).toBeInTheDocument()
    await expect(card.getAllByRole('button')).toHaveLength(1)
  },
}

export const AllStates: Story = {
  parameters: statesOn(cardStates),
  render: (args) => (
    <States
      size="wide"
      cells={[
        ...KIND_CARDS.map(({ id, card }) => ({ state: id, node: <BoardCard {...card} onOpen={args.onOpen} /> })),
        { state: 'done', node: <BoardCard {...args} status={TaskStatus.Done} word="Done" /> },
        { state: 'current', node: <BoardCard {...args} current /> },
        { state: 'from an automation', node: <BoardCard {...args} from="Nightly bump" /> },
        { state: 'nothing opens it', node: <BoardCard {...args} onOpen={undefined} /> },
        { state: 'hover', node: <BoardCard {...args} /> },
        { state: 'focus', node: <BoardCard {...args} /> },
        { state: 'pressed', node: <BoardCard {...args} /> },
      ]}
    />
  ),
}
