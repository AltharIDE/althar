import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'

import { OPUS } from '../../fixtures/models'
import { TaskFace } from '../../thread/TaskFace/TaskFace'
import { Thread } from '../../thread/Thread/Thread'
import { Prose, Turn } from '../../thread/Turn/Turn'
import { You } from '../../thread/You/You'
import { Behind } from '../Behind/Behind'
import { Composer } from '../Composer/Composer'
import type { RunningProcess } from '../Running/Running'
import { MergingBack, MergingPill, type MergingPillProps, type MergingRow } from './MergingPill'

/*
 * What is on its way into a branch, pinned on the composer's edge beside the
 * run chip, so it stays in view while the thread scrolls on; pressed, it grows
 * into a card of a row for each. One thing is open on the edge at a time.
 */

const pull = (number: number, title: string, state: MergingRow['state'], reason?: string): MergingRow => ({
  key: `#${number}`,
  label: `#${number}`,
  title,
  url: `https://github.com/meridian/api/pull/${number}`,
  state,
  ...(reason === undefined ? {} : { reason }),
})

/** A merge kept for later, whose pull request isn't open yet: by its task's name. */
const kept = (task: string, once: string): MergingRow => ({ key: task, label: task, title: '', url: null, state: 'waiting', once })

const FOUR: ReadonlyArray<MergingRow> = [
  pull(1224, 'Plan card offers Runs on during its countdown too', 'merged'),
  pull(1226, 'Keep for later shelves a task without losing it', 'merging'),
  pull(1222, 'A home’s whole experience reviewed and made good', 'queued'),
  kept('Workers readiness', 'once its checks pass'),
]
const SENT_BACK: ReadonlyArray<MergingRow> = [
  pull(1224, 'Plan card offers Runs on during its countdown too', 'merged'),
  pull(
    1226,
    'Keep for later shelves a task without losing it',
    'sent_back',
    'the queue’s end-to-end checks failed in homes.spec.ts. Its lead is fixing it.',
  ),
  pull(1222, 'A home’s whole experience reviewed and made good', 'merging'),
]
const SITE: RunningProcess = { id: 'site', name: 'Site dev server', command: 'bun run dev', url: 'localhost:5173', since: '41m' }

/** On a composer's edge, beside the run chip, at a width: one of them open at a time, as the app holds them. */
function Edge({ width = 640, open: first = false, ...props }: MergingPillProps & { readonly width?: number }) {
  const [open, setOpen] = useState<'merging' | 'runs' | null>(first ? 'merging' : null)
  const opens = (which: 'merging' | 'runs') => (next: boolean) => setOpen((was) => (next ? which : was === which ? null : was))
  return (
    <div style={{ width, paddingTop: 300 }}>
      <Composer
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        placeholder="Ask the coordinator"
        above={
          <>
            <Behind processes={[SITE]} open={open === 'runs'} onOpenChange={opens('runs')} />
            <MergingPill {...props} open={open === 'merging'} onOpenChange={opens('merging')} />
          </>
        }
        notice={open === 'merging' || !props.rows.some((row) => row.state === 'sent_back') ? null : <MergingBack rows={props.rows} />}
      />
    </div>
  )
}

const meta = {
  title: 'Composer/MergingPill',
  component: MergingPill,
  args: { rows: FOUR },
  render: (args) => <Edge {...args} />,
} satisfies Meta<typeof MergingPill>
export default meta
type Story = StoryObj<typeof meta>

/** Four on their way: one in, one merging, one in the queue, one whose pull request isn't open yet. */
export const OnTheirWay: Story = {
  play: async ({ canvasElement }) => {
    const pill = within(canvasElement).getByRole('button', { name: /^Merging:/ })
    await expect(pill).toHaveAccessibleName('Merging: #1224 merged, #1226 merging, #1222 in the queue, Workers readiness not in line yet')
  },
}

/** Opened: a row for each, where it stands in a column of its own, and what it waits for under it. */
export const Opened: Story = {
  play: async ({ canvasElement }) => {
    const edge = within(canvasElement)
    await userEvent.click(edge.getByRole('button', { name: /^Merging:/ }))
    await expect(edge.getAllByRole('listitem')).toHaveLength(4)
  },
}

/** One sent back: why, on the notice line while folded, and under its row once opened. */
export const SentBack: Story = { args: { rows: SENT_BACK } }

export const SentBackOpened: Story = {
  args: { rows: SENT_BACK },
  play: async ({ canvasElement }) => {
    const edge = within(canvasElement)
    await userEvent.click(edge.getByRole('button', { name: /^Merging:/ }))
    await expect(edge.getByText('The queue’s end-to-end checks failed in homes.spec.ts. Its lead is fixing it.')).toBeVisible()
  },
}

/** One open on the edge at a time: the run chip's list folds the card back into its pill. */
export const OneAtATime: Story = {
  play: async ({ canvasElement }) => {
    const edge = within(canvasElement)
    await userEvent.click(edge.getByRole('button', { name: /^Merging:/ }))
    await expect(edge.getByRole('region', { name: 'Merging' })).toBeVisible()
    await userEvent.click(edge.getByRole('button', { name: /Site dev server/ }))
    await expect(edge.queryByRole('region', { name: 'Merging' })).toBeNull()
    await expect(edge.getByRole('button', { name: /^Merging:/ })).toBeVisible()
  },
}

/** Narrow: what is in, and what isn't in line yet, keep only their marks; opened, titles end in "…". */
export const Narrow: Story = { render: (args) => <Edge {...args} width={380} /> }

export const NarrowOpened: Story = {
  render: (args) => <Edge {...args} width={380} />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /^Merging:/ }))
  },
}

/** Into a branch that isn't the default, named. */
export const IntoABranch: Story = { args: { rows: FOUR.slice(0, 2), branch: 'release/0.10' } }

const SAID = [
  ['Ship it, and merge it once it’s green.', 'Shipped. #1224 is in, #1226 is merging, and #1222 waits its turn in the queue.'],
  [
    'While that goes: is the same race anywhere else?',
    'One more place reads a branch right after writing it: settle. It hasn’t failed in CI, but it can, the same way.',
  ],
  ['How long did the stress runs take?', 'About four minutes each, on one worker: 200 runs of each test, 1.2 seconds a run.'],
  ['And the Windows run?', 'Green on the last two pushes. The one red run before them was the runner’s disk filling up, not the change.'],
  ['Anything you need from me?', 'Nothing now. I’ll say if one of them comes back from the queue.'],
] as const

/** A conversation long enough to scroll, on the kit's own face: the pill stays on the composer's edge while the thread scrolls on. With `allIn`, they merge, the pill shows them so for a moment, and goes. */
function Conversation({
  rows,
  allIn = false,
  draft = '',
}: {
  readonly rows: ReadonlyArray<MergingRow>
  readonly allIn?: boolean
  /** What the person has written and not sent: a long one makes the composer tall. */
  readonly draft?: string
}) {
  const [open, setOpen] = useState<'merging' | 'runs' | null>(null)
  const opens = (which: 'merging' | 'runs') => (next: boolean) => setOpen((was) => (next ? which : was === which ? null : was))
  const [phase, setPhase] = useState<'moving' | 'in' | 'going' | 'gone'>('moving')
  useEffect(() => {
    if (!allIn) return
    const steps = [
      setTimeout(() => setPhase('in'), 1200),
      setTimeout(() => setPhase('going'), 1200 + 1800),
      setTimeout(() => setPhase('gone'), 1200 + 1800 + 140),
    ]
    return () => steps.forEach(clearTimeout)
  }, [allIn])
  const shown = phase === 'moving' ? rows : rows.map((row) => ({ ...row, state: 'merged' as const, reason: undefined }))
  const back = open !== 'merging' && phase !== 'gone' && shown.some((row) => row.state === 'sent_back')
  return (
    <div style={{ height: '100vh' }}>
      <TaskFace
        composer={
          <Composer
            value={draft}
            onChange={() => {}}
            onSubmit={() => {}}
            placeholder="Tell the lead"
            above={
              <>
                <Behind processes={[SITE]} open={open === 'runs'} onOpenChange={opens('runs')} />
                {phase !== 'gone' && (
                  <MergingPill rows={shown} open={open === 'merging'} onOpenChange={opens('merging')} leaving={phase === 'going'} />
                )}
              </>
            }
            notice={back ? <MergingBack rows={shown} /> : null}
          />
        }
      >
        <Thread label="Task">
          {SAID.map(([asked, answered], at) => (
            <div key={asked}>
              <You at={`14:${10 + at * 6}`}>{asked}</You>
              <Turn model={OPUS} at={`14:${11 + at * 6}`}>
                <Prose>{answered}</Prose>
                <Prose>{answered}</Prose>
              </Turn>
            </div>
          ))}
        </Thread>
      </TaskFace>
    </div>
  )
}

/** In a conversation that scrolls: the pill on the composer's edge, the thread's end clear of it, the card open or folded. */
export const InAConversation: Story = {
  parameters: { layout: 'fullscreen' },
  args: { rows: SENT_BACK },
  render: (args) => <Conversation rows={args.rows} />,
}

/** In a conversation, all of them merging in: the pill shows them in for a moment, then goes. */
export const AllInAConversation: Story = {
  parameters: { layout: 'fullscreen' },
  args: { rows: FOUR.slice(0, 3) },
  render: (args) => <Conversation rows={args.rows} allIn />,
}

const QUEUE: ReadonlyArray<MergingRow> = [
  pull(1230, 'Release notes say what each fix does', 'merging'),
  pull(1231, 'A worker’s doctor checks its disk', 'checks'),
  pull(1232, 'Fix runtime flakies: changesMergeNeeds and backToWork', 'queued'),
  pull(1233, 'Board cards keep their place on a refresh', 'queued'),
  pull(1234, 'Asides open where the person was', 'queued'),
  pull(1235, 'The usage line reads per account', 'queued'),
]

/** Narrow, a long branch and a queue of six: the pill keeps within itself, the branch cut with "…", the tokens with no room waiting in the card. */
export const NarrowCrowded: Story = {
  args: { rows: QUEUE, branch: 'release/0.10-cascade-into-main-for-the-windows-fixes' },
  render: (args) => <Edge {...args} width={380} />,
}

export const NarrowCrowdedOpened: Story = {
  args: { rows: QUEUE, branch: 'release/0.10-cascade-into-main-for-the-windows-fixes' },
  render: (args) => <Edge {...args} width={380} />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /^Merging into/ }))
    await expect(within(canvasElement).getAllByRole('listitem')).toHaveLength(6)
  },
}

/** A long queue in a short window: opened, the card's head stays in view and its rows scroll within it. */
export const ManyInAShortWindow: Story = {
  parameters: { layout: 'fullscreen' },
  args: { rows: [...QUEUE, ...QUEUE.map((row) => ({ ...row, key: `${row.key}b`, label: `#${Number(row.label.slice(1)) + 10}` }))] },
  render: (args) => <Conversation rows={args.rows} />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /^Merging:/ }))
  },
}

const LONG_DRAFT = [
  'Before the next batch goes in, a few things:',
  '',
  '1. Hold #1233 until the board refresh fix is on main.',
  '2. #1234 can go as it is.',
  '3. For #1235, ask its lead whether the usage line still reads per account on Windows.',
  '4. Once they are all in, cut 0.10.1 from the release branch.',
  '',
  'And tell me when the cascade into main has run.',
].join('\n')

/** A tall composer, a long draft in it, and a long queue opened: the card keeps its head in view, its rows scrolling in what is left. */
export const ManyWithATallComposer: Story = {
  parameters: { layout: 'fullscreen' },
  args: { rows: [...QUEUE, ...QUEUE.map((row) => ({ ...row, key: `${row.key}b`, label: `#${Number(row.label.slice(1)) + 10}` }))] },
  render: (args) => <Conversation rows={args.rows} draft={LONG_DRAFT} />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /^Merging:/ }))
  },
}
