import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { CODEX, OPUS } from '../../fixtures/models'
import { ToolKind, ToolState, Verdict } from '../../foundations/vocabulary'
import { ThreadFrame } from '../../storybook/ThreadFrame'
import { AltharLine } from '../AltharLine/AltharLine'
import { Markdown } from '../Markdown/Markdown'
import { Reasoning } from '../Reasoning/Reasoning'
import { Reviewer, type ReviewerFinding } from '../Reviewer/Reviewer'
import { ReviewLine } from '../ReviewLine/ReviewLine'
import { Round } from '../Round/Round'
import { Tool } from '../Tool/Tool'
import { Turn } from '../Turn/Turn'
import { WorkedFor } from '../WorkedFor/WorkedFor'
import { WorkLine, WorkSaid } from '../WorkLine/WorkLine'
import { You } from '../You/You'
import { Thread } from './Thread'

/*
 * A task's thread as the app draws it (the desktop's TaskThread), from the
 * kit's parts: a turn while it runs, its thinking streaming under its line
 * and folding to a line as it moves on, its words streaming at an even
 * pace; a long turn once it is over; a task with two rounds of review, each
 * a line, the lead's latest handoff open under them; and the coordinator's
 * turn as it thinks and answers.
 */

const meta = {
  title: 'Thread/Task thread',
  component: Thread,
  parameters: { layout: 'fullscreen' },
  args: { label: 'Merge line back-off, with its lead', children: null },
  render: (args) => (
    <ThreadFrame>
      <Thread {...args} />
    </ThreadFrame>
  ),
} satisfies Meta<typeof Thread>
export default meta
type Story = StoryObj<typeof meta>

const REQUEST =
  'The merge line hammers GitHub when it’s rate-limited: every task polls every 15 seconds whatever GitHub says. Make it back off when GitHub says to.'

const ACK = 'I’ll find where the merge line polls GitHub, make it wait when GitHub says to, and say so on the card.'

const THOUGHT_CLAUDE = `The person wants the merge line to back off when GitHub rate-limits it. First I need to find where the poll is scheduled. MergeLine.ts owns the queue, but the polling itself is probably in Follow.ts, which watches a pull request's checks. GitHub answers a rate-limited call with 403 or 429, and the headers say when to come back: x-ratelimit-reset as epoch seconds, and retry-after for secondary limits. So read those headers in the connector, surface a "come back at" time, and have the poll wait until then instead of its fixed interval.`

const THOUGHT_CODEX = `**Finding where the poll is scheduled**

\`Follow.ts\` schedules the next poll with a fixed \`POLL_EVERY\` of 15 seconds, and on a failure polls again at the same interval.

**Keeping GitHub's reset time on the error**

The connector throws \`HostRefused\` with the status but drops the headers; keeping \`resetAt\` on it lets Follow wait until then.`

const RESULT = `The merge line now backs off when GitHub rate-limits it, and the task's card says it's waiting on GitHub, with when it will try again.

- **Back-off.** \`Follow.ts\` waits until GitHub's reset time (\`x-ratelimit-reset\`, or \`retry-after\` for secondary limits), with a little jitter, instead of polling every 15 seconds.
- **The card.** A rate-limited task reads *Waiting on GitHub until 14:32*, where an offline host already shows.
- **The connector.** \`github.ts\` keeps the rate-limit headers on the error it raises.

To look at: start a task that opens a pull request, then run \`bun run fake:ratelimit\`. The card changes within a poll.`

const SETTLED = `Moved \`backoffFor\` into \`rateLimit.ts\` beside the header parsing, and pointed its test there. Nothing else changed; the checks pass.`

const FINDINGS: ReviewerFinding[] = [
  {
    id: 'r1',
    weight: 'major',
    at: 'packages/runtime/src/Follow.ts:118',
    title: 'Jitter is added after the cap',
    claim: 'The wait can run past five minutes.',
  },
  {
    id: 'r2',
    weight: 'major',
    at: 'packages/runtime/src/Follow.ts:96',
    title: 'The reset time is read against this computer’s clock',
    claim: 'Use the `Date` header of GitHub’s answer.',
  },
  {
    id: 'r3',
    weight: 'minor',
    at: 'packages/ui/src/board/TaskCard/TaskCard.tsx:210',
    title: 'The card doesn’t say until when',
    claim: 'Say the time it will try again.',
  },
]

/** A run of a long turn's work, as its line opens to it: reads, edits, commands, what it said on the way, and its thoughts, folded. */
const longWork = (
  <>
    <Reasoning source={THOUGHT_CLAUDE} took="27s" />
    <Tool kind={ToolKind.Search} verb="Searched" target="POLL_EVERY" state={ToolState.Done} />
    <Tool kind={ToolKind.Read} verb="Read" target="packages/runtime/src/MergeLine.ts" state={ToolState.Done} />
    <Tool kind={ToolKind.Read} verb="Read" target="packages/runtime/src/Follow.ts" state={ToolState.Done} />
    <Tool kind={ToolKind.Read} verb="Read" target="packages/connectors/src/github.ts" state={ToolState.Done} />
    <Reasoning source={THOUGHT_CODEX} took="42s" />
    <WorkSaid source="The poll interval is fixed in `Follow.ts`, and the connector drops the headers that say when to come back. Fixing both." />
    <Tool kind={ToolKind.Edit} verb="Edited" target="packages/connectors/src/github.ts" state={ToolState.Done} />
    <Tool kind={ToolKind.Edit} verb="Edited" target="packages/runtime/src/Follow.ts" state={ToolState.Done} />
    <Tool kind={ToolKind.Run} verb="Run" target="bunx vitest run tests/rateLimit.test.ts" state={ToolState.Failed} exit={1} />
    <Reasoning
      source="The test failed because the fake host answers 429 without a reset header, and my code read that as reset at 0. Without either header, fall back to doubling the wait up to five minutes."
      took="9s"
    />
    <Tool kind={ToolKind.Edit} verb="Edited" target="packages/runtime/src/Follow.ts" state={ToolState.Done} />
    <Tool kind={ToolKind.Run} verb="Ran" target="bunx vitest run tests/rateLimit.test.ts tests/follow.test.ts" state={ToolState.Done} />
  </>
)

/** A long turn, once it is over: what it said first, its work in one line (its thoughts folded inside), and its handoff. */
export const FinishedLongTurn: Story = {
  args: {
    children: (
      <>
        <You at="2h ago">{REQUEST}</You>
        <Round model={OPUS} at="2h ago" copy={RESULT}>
          <Markdown source={ACK} />
          <WorkLine took="8m 37s" summary="edited 4 files, read 4 files, ran 4 commands">
            {longWork}
          </WorkLine>
          <Markdown source={RESULT} />
        </Round>
      </>
    ),
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    // Opened, its thoughts are folded lines, each how long and what about.
    await userEvent.click(c.getByRole('button', { name: /Worked 8m 37s/ }))
    await waitFor(() => expect(c.getByRole('button', { name: /Thought for 42s.*Keeping GitHub's reset time on the error/ })).toBeVisible())
    await expect(c.getByRole('button', { name: /Thought for 27s.*The person wants the merge line to back off/ })).toBeTruthy()
  },
}

/** A task's thread after two rounds of review: each a line, the lead's latest handoff open under them; the first opened. */
export const TwoReviewRounds: Story = {
  args: {
    children: (
      <>
        <You at="2h ago">{REQUEST}</You>
        <Round model={OPUS} at="2h ago">
          <Markdown source={ACK} />
          <WorkLine took="8m 37s" summary="edited 4 files, read 4 files, ran 4 commands">
            {longWork}
          </WorkLine>
          <Markdown source={RESULT} />
        </Round>
        <ReviewLine model={CODEX} verdict={Verdict.Changes} findings={3} settled="2 fixed, 1 declined">
          <Reviewer verdict={Verdict.Changes} findings={FINDINGS} said={false} />
          <Markdown source="The back-off is in the right place and the connector change is small. Three things before this goes in." />
          <Round model={OPUS} at="2h ago">
            <WorkLine took="3m 18s" summary="edited 2 files, read 1 file, ran 2 commands" />
            <Markdown source="Settled the review: fixed the jitter and the clock, and set the card's time aside: it already says *until 14:32*." />
          </Round>
        </ReviewLine>
        <ReviewLine model={CODEX} verdict={Verdict.Changes} findings={1} settled="1 fixed">
          <Reviewer
            said={false}
            verdict={Verdict.Changes}
            findings={[
              {
                id: 'r4',
                weight: 'nit',
                at: 'packages/runtime/src/Follow.ts:40',
                title: '`backoffFor` belongs beside the header parsing',
                claim: 'Move it to `rateLimit.ts`.',
              },
            ]}
          />
        </ReviewLine>
        <Round model={OPUS} at="2h ago" copy={SETTLED}>
          <WorkLine took="1m 56s" summary="edited 2 files, read 1 file, ran 1 command" />
          <Markdown source={SETTLED} />
        </Round>
        <ReviewLine model={CODEX} verdict={Verdict.Pass}>
          <Markdown source="Looks right. The back-off, the clock and the card all hold." />
        </ReviewLine>
        <AltharLine>Opened PR #412.</AltharLine>
      </>
    ),
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    // The latest handoff is open; the reviews are lines, and what they said is a click away.
    await expect(c.getByText(/Moved/)).toBeTruthy()
    await expect(c.queryByText('Jitter is added after the cap')).toBeNull()
    await userEvent.click(c.getByRole('button', { name: /Review.*3 findings.*2 fixed, 1 declined/ }))
    await waitFor(() => expect(c.getByText('Jitter is added after the cap')).toBeVisible())
  },
}

/** What a live turn goes through, again and again: what it said first, then thinking, a tool, thinking again, its answer. */
type Beat = { readonly think: string } | { readonly tool: string; readonly ms: number } | { readonly say: string }

const BEATS: ReadonlyArray<Beat> = [
  { think: THOUGHT_CLAUDE },
  { tool: 'Reading packages/runtime/src/Follow.ts', ms: 1400 },
  { tool: 'Running bunx vitest run tests/follow.test.ts', ms: 1800 },
  { think: THOUGHT_CODEX },
  { tool: 'Editing packages/runtime/src/Follow.ts', ms: 1200 },
  { say: RESULT },
]

/** Plays the beats as a model sends them: text in uneven bursts of a few words, with the odd stall. */
const usePlayed = (beats: ReadonlyArray<Beat>) => {
  const [at, setAt] = useState({ beat: 0, chars: 0 })
  const beat = beats[at.beat]
  useEffect(() => {
    if (beat === undefined) {
      const again = window.setTimeout(() => setAt({ beat: 0, chars: 0 }), 3000)
      return () => window.clearTimeout(again)
    }
    if ('tool' in beat) {
      const done = window.setTimeout(() => setAt({ beat: at.beat + 1, chars: 0 }), beat.ms)
      return () => window.clearTimeout(done)
    }
    const whole = 'think' in beat ? beat.think : beat.say
    if (at.chars >= whole.length) {
      const next = window.setTimeout(() => setAt({ beat: at.beat + 1, chars: 0 }), 500)
      return () => window.clearTimeout(next)
    }
    const stall = Math.random() < 0.08 ? 400 + Math.random() * 500 : 0
    const wait = 50 + stall
    const more = window.setTimeout(
      () => setAt({ beat: at.beat, chars: Math.min(whole.length, at.chars + Math.round((wait * 300) / 1000)) }),
      wait,
    )
    return () => window.clearTimeout(more)
  }, [at, beat])
  return { at, beats }
}

/** The turn as it stands at a moment of the play: its line, its latest thought, and its answer once it gives one. */
const playedTurn = (played: ReturnType<typeof usePlayed>) => {
  const { at, beats } = played
  const shown = beats.slice(0, at.beat + 1)
  const thoughts = shown.flatMap((beat, index) => ('think' in beat ? [{ index, text: beat.think }] : []))
  const latest = thoughts.at(-1)
  const now = beats[at.beat]
  const thinking = now !== undefined && 'think' in now
  const answering = now === undefined || 'say' in now
  const doing = [...shown].reverse().find((beat) => 'tool' in beat)
  const answer = beats.find((beat) => 'say' in beat)
  return {
    over: now === undefined,
    summary: doing !== undefined && 'tool' in doing ? doing.tool : undefined,
    thinking:
      latest === undefined || answering ? undefined : (
        <Reasoning
          key={latest.index}
          source={thinking ? latest.text.slice(0, at.chars) : latest.text}
          live={thinking}
          {...(thinking ? {} : { took: '14s' })}
        />
      ),
    answer:
      answer === undefined || !answering || !('say' in answer) ? undefined : (
        <Markdown source={now === undefined ? answer.say : answer.say.slice(0, at.chars)} streaming={now !== undefined} />
      ),
  }
}

/** A task's round while its lead works: its thinking streams under its line, folds to a line as it moves on; then its answer. */
export const LiveTurn: Story = {
  render: function LiveTurn(args) {
    const turn = playedTurn(usePlayed(BEATS))
    return (
      <ThreadFrame>
        <Thread {...args}>
          <You at="just now">Does the back-off survive a restart?</You>
          <Round model={OPUS} at="just now">
            <Markdown source="I’ll check what the merge line reads back when Althar starts." />
            <WorkLine
              took="1m 4s"
              live={!turn.over}
              {...(turn.summary === undefined ? {} : { summary: turn.summary })}
              thinking={turn.thinking}
            >
              {longWork}
            </WorkLine>
            {turn.answer}
          </Round>
        </Thread>
      </ThreadFrame>
    )
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    // Thinking, it shows as it streams, under the line.
    await waitFor(() => expect(c.getByRole('button', { name: /Thinking/ })).toBeTruthy())
  },
}

/** The coordinator's turn: its thinking under its line, then its answer streaming in at an even pace. */
export const CoordinatorLive: Story = {
  render: function CoordinatorLive(args) {
    const turn = playedTurn(usePlayed(BEATS))
    return (
      <ThreadFrame>
        <Thread {...args}>
          <You at="just now">What needs me today?</You>
          <Turn model={CODEX} at="just now">
            <WorkedFor
              took="12s"
              live={!turn.over}
              {...(turn.summary === undefined ? {} : { summary: turn.summary })}
              thinking={turn.thinking}
            >
              {longWork}
            </WorkedFor>
            {turn.answer}
          </Turn>
        </Thread>
      </ThreadFrame>
    )
  },
}
