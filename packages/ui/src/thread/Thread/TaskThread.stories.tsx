import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState } from 'react'

import type { IconName } from '../../foundations/Icon/Icon'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { CODEX, OPUS } from '../../fixtures/models'
import { ToolKind, ToolState, Verdict } from '../../foundations/vocabulary'
import { ThreadFrame } from '../../storybook/ThreadFrame'
import { AltharLine } from '../AltharLine/AltharLine'
import { Markdown } from '../Markdown/Markdown'
import { Reasoning, Thinking } from '../Reasoning/Reasoning'
import { Reviewer, type ReviewerFinding } from '../Reviewer/Reviewer'
import { ReviewLine } from '../ReviewLine/ReviewLine'
import { Round } from '../Round/Round'
import { glyphOf, Tool } from '../Tool/Tool'
import { Turn } from '../Turn/Turn'
import { WorkedFor, WorkNow } from '../WorkedFor/WorkedFor'
import { WorkLine, WorkSaid } from '../WorkLine/WorkLine'
import { You } from '../You/You'
import { Thread } from './Thread'

/*
 * A task's thread as the app draws it (the desktop's TaskThread), from the
 * kit's parts: a turn while it runs, as Codex's app shows one (how long it
 * has worked, what it said on the way and one line for what it does now,
 * folding away under "Worked for" as it answers, its words fading in at an
 * even pace); a long turn once it is over; a task with two rounds of review,
 * each a line, the lead's latest handoff open under them; and the
 * coordinator's turn as it works and answers.
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

/** A run of a long turn's work, as its header opens to it: what it said first and on the way, reads, edits, commands, and its thoughts, folded. */
const longWork = (
  <>
    <WorkSaid source={ACK} />
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

/** A long turn, once it is over: its work folded under how long it took (what it said on the way and its thoughts inside), and its handoff. */
export const FinishedLongTurn: Story = {
  args: {
    children: (
      <>
        <You at="2h ago">{REQUEST}</You>
        <Round model={OPUS} at="2h ago" copy={RESULT}>
          <WorkedFor took="8m 37s">{longWork}</WorkedFor>
          <Markdown source={RESULT} />
        </Round>
      </>
    ),
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    // Folded, nothing of the work shows; opened, what it said first and its thoughts, each a line of how long and what about.
    await expect(c.queryByText(ACK)).toBeNull()
    await userEvent.click(c.getByRole('button', { name: /Worked for 8m 37s/ }))
    await waitFor(() => expect(c.getByRole('button', { name: /Thought for 42s.*Keeping GitHub's reset time on the error/ })).toBeVisible())
    await expect(c.getByRole('button', { name: /Thought for 27s.*The person wants the merge line to back off/ })).toBeTruthy()
    await expect(c.getByText(ACK)).toBeVisible()
  },
}

/** A task's thread after two rounds of review: each a line, the lead's latest handoff open under them; the first opened. */
export const TwoReviewRounds: Story = {
  args: {
    children: (
      <>
        <You at="2h ago">{REQUEST}</You>
        <Round model={OPUS} at="2h ago">
          <WorkedFor took="8m 37s">{longWork}</WorkedFor>
          <Markdown source={RESULT} />
        </Round>
        <ReviewLine model={CODEX} verdict={Verdict.Changes} findings={3} settled="2 fixed, 1 declined">
          <Reviewer verdict={Verdict.Changes} findings={FINDINGS} said={false} />
          <Markdown source="The back-off is in the right place and the connector change is small. Three things before this goes in." />
          <Round model={OPUS} at="2h ago">
            <WorkedFor took="3m 18s" />
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
          <WorkedFor took="1m 56s" />
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

/** A round with nothing said in it, only work: who worked, and for how long, in one line. */
export const QuietRound: Story = {
  args: {
    children: (
      <>
        <You at="1h ago">Rebase on main and run the checks again.</You>
        <WorkLine who={OPUS} took="2m 4s" summary="ran 3 commands">
          {longWork}
        </WorkLine>
      </>
    ),
  },
}

/**
 * What a live turn goes through, again and again: thinking with nothing to
 * show, then what it says it will do, its steps one after another, thinking
 * again, and its answer.
 */
type Beat =
  | { readonly wait: number }
  | { readonly think: string; readonly ms: number }
  | { readonly tool: string; readonly kind: ToolKind; readonly verb: readonly [string, string]; readonly ms: number }
  | { readonly say: string }
  | { readonly answer: string }

const BEATS: ReadonlyArray<Beat> = [
  { wait: 2200 },
  { think: THOUGHT_CODEX, ms: 1800 },
  { say: ACK },
  { tool: 'POLL_EVERY', kind: ToolKind.Search, verb: ['Searching', 'Searched'], ms: 1600 },
  { tool: 'packages/runtime/src/Follow.ts', kind: ToolKind.Read, verb: ['Reading', 'Read'], ms: 1800 },
  { think: THOUGHT_CLAUDE, ms: 1600 },
  { say: 'The poll interval is fixed in `Follow.ts`, and the connector drops the headers that say when to come back. Fixing both.' },
  { tool: 'packages/runtime/src/Follow.ts', kind: ToolKind.Edit, verb: ['Editing', 'Edited'], ms: 1400 },
  { tool: 'bunx vitest run tests/follow.test.ts', kind: ToolKind.Run, verb: ['Running', 'Ran'], ms: 2000 },
  { answer: RESULT },
]

/** Plays the beats as a model sends them: text in uneven bursts of a few words, with the odd stall. */
const usePlayed = (beats: ReadonlyArray<Beat>) => {
  const [at, setAt] = useState({ beat: 0, chars: 0, since: Date.now(), began: [Date.now()] })
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(tick)
  }, [])
  const beat = beats[at.beat]
  useEffect(() => {
    const next = () => setAt((one) => ({ beat: one.beat + 1, chars: 0, since: one.since, began: [...one.began, Date.now()] }))
    if (beat === undefined) {
      const again = window.setTimeout(() => setAt({ beat: 0, chars: 0, since: Date.now(), began: [Date.now()] }), 4000)
      return () => window.clearTimeout(again)
    }
    if ('wait' in beat || 'tool' in beat || 'think' in beat) {
      const done = window.setTimeout(next, 'wait' in beat ? beat.wait : beat.ms)
      return () => window.clearTimeout(done)
    }
    const whole = 'say' in beat ? beat.say : beat.answer
    if (at.chars >= whole.length) {
      const done = window.setTimeout(next, 500)
      return () => window.clearTimeout(done)
    }
    const stall = Math.random() < 0.08 ? 400 + Math.random() * 500 : 0
    const wait = 50 + stall
    const more = window.setTimeout(
      () => setAt((one) => ({ ...one, chars: Math.min(whole.length, one.chars + Math.round((wait * 300) / 1000)) })),
      wait,
    )
    return () => window.clearTimeout(more)
  }, [at, beat])
  return { at, beats, now }
}

const clock = (ms: number) => {
  const all = Math.max(0, Math.floor(ms / 1000))
  return all < 60 ? `${all}s` : `${Math.floor(all / 60)}m ${all % 60}s`
}

/** The turn as it stands at a moment of the play: its work's header, what it said on the way and does now, and its answer. */
function PlayedTurn({ played, foldAt }: { played: ReturnType<typeof usePlayed>; foldAt: 'answer' | 'end' }) {
  const { at, beats, now } = played
  const current = beats[at.beat]
  const over = current === undefined
  // It works from the end of its wait; answering, its work stops where the answer began.
  const started = at.began[1] ?? now
  if (current !== undefined && 'wait' in current) return <Thinking />
  const shown = beats.slice(0, over ? beats.length : at.beat + 1)
  const answering = over || (current !== undefined && 'answer' in current)
  const writing = current !== undefined && ('say' in current || 'answer' in current)
  // What it said on the way: each word it is done with; what it writes now stands under the work, where its answer will.
  const said = shown.flatMap((beat, index) => ('say' in beat && index !== at.beat ? [beat.say] : []))
  const step = [...shown].reverse().find((beat) => 'tool' in beat || 'think' in beat)
  const now_ =
    writing || step === undefined
      ? null
      : 'tool' in step
        ? { icon: glyphOf(step.kind) as IconName | undefined, text: `${step.verb[0]} ${step.tool}` }
        : { icon: undefined, text: step.think.startsWith('**') ? (step.think.split('**')[1] ?? 'Thinking') : 'Thinking' }
  const answer = beats.find((beat): beat is { answer: string } => 'answer' in beat)?.answer ?? ''
  const live = !over && !(foldAt === 'answer' && answering)
  const answerStart = at.began[beats.findIndex((beat) => 'answer' in beat)] ?? now
  const took = clock((live ? now : Math.min(now, answerStart)) - started)
  const trail = shown.map((beat, index) =>
    'think' in beat ? (
      <Reasoning key={index} source={beat.think} live={index === at.beat} took={clock(beat.ms)} />
    ) : 'tool' in beat ? (
      <Tool
        key={index}
        kind={beat.kind}
        verb={index === at.beat ? beat.verb[0] : beat.verb[1]}
        target={beat.tool}
        state={index === at.beat ? ToolState.Running : ToolState.Done}
      />
    ) : 'say' in beat && index !== at.beat ? (
      <WorkSaid key={index} source={beat.say} />
    ) : null,
  )
  return (
    <>
      <WorkedFor
        took={took}
        live={live}
        said={said.length === 0 ? undefined : said.map((words) => <Markdown key={words} source={words} />)}
        now={now_ === null ? undefined : <WorkNow {...(now_.icon === undefined ? {} : { icon: now_.icon })}>{now_.text}</WorkNow>}
      >
        {trail}
      </WorkedFor>
      {current !== undefined && 'say' in current && <Markdown key={at.beat} source={current.say.slice(0, at.chars)} streaming />}
      {answering && <Markdown key="answer" source={over ? answer : answer.slice(0, at.chars)} streaming={!over} />}
    </>
  )
}

/**
 * A task's round while its lead works, as Codex's app shows a turn: thinking
 * before anything, then how long it has worked, what it says it will do, and
 * one line for its step, replaced in place; its handoff comes in as the work
 * folds away under how long it took, its newest words fading in.
 */
export const LiveTurn: Story = {
  render: function LiveTurn(args) {
    const played = usePlayed(BEATS)
    return (
      <ThreadFrame>
        <Thread {...args}>
          <You at="just now">Does the back-off survive a restart?</You>
          <Round model={OPUS} at="just now">
            <PlayedTurn played={played} foldAt="answer" />
          </Round>
        </Thread>
      </ThreadFrame>
    )
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    // Thinking before anything, then at work: how long, and one line for what it does now.
    await waitFor(() => expect(c.getByRole('status')).toHaveTextContent('Thinking'))
    await waitFor(() => expect(c.getByRole('button', { name: /Working for/ })).toBeTruthy(), { timeout: 4000 })
  },
}

/** The coordinator's turn: the same, but for its answer, which it can't tell from what it says on the way until its turn ends. */
export const CoordinatorLive: Story = {
  render: function CoordinatorLive(args) {
    const played = usePlayed(BEATS)
    return (
      <ThreadFrame>
        <Thread {...args}>
          <You at="just now">What needs me today?</You>
          <Turn model={CODEX} at="just now">
            <PlayedTurn played={played} foldAt="end" />
          </Turn>
        </Thread>
      </ThreadFrame>
    )
  },
}
