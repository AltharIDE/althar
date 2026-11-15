import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useRef, useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { BoardCard } from '../../board/BoardCard/BoardCard'
import { PullChip } from '../../board/BoardCard/Chips'
import { CODEX } from '../../fixtures/models'
import { GITHUB } from '../../fixtures/outputs'
import { ChangeState, CheckState, TaskKind, TaskStatus } from '../../foundations/vocabulary'
import { ChangeSet } from '../../outputs/ChangeSet/ChangeSet'
import { SmallChange } from '../../thread/SmallChange/SmallChange'
import { Button } from '../Button/Button'
import { MergeButton } from '../MergeButton/MergeButton'
import { MergeFeel, type MergeFeelStage } from './MergeFeel'

/*
 * A merge, felt where it is pressed: the thread's small change, a change on
 * Outputs and a lane of board cards, on a host that takes each into its
 * queue half a second after the press and lands it a few seconds later, or
 * at Land now. Start over plays it again.
 */

const meta = {
  title: 'Primitives/MergeFeel',
  component: MergeFeel,
  args: { stage: 'ready' },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof MergeFeel>
export default meta
type Story = StoryObj<typeof meta>

const at = (time: string) => `2026-11-15T${time}:00`
/** From the press to its host saying it's in its queue, and from there to landing. */
const TAKEN = 520
const LANDS = 2600
const LANE = [
  { id: 'b1', title: 'Usage card drops the time breakdown', number: 767, add: 1, del: 42, at: '2m' },
  { id: 'b2', title: 'Plan usage reads the weekly limit', number: 771, add: 64, del: 9, at: '9m' },
  { id: 'b3', title: 'Tab titles stay on one line', number: 773, add: 12, del: 30, at: '14m' },
] as const

type Stages = Readonly<Record<string, MergeFeelStage>>

/** A host's merge queue, as a merge goes through it: Merging at once, In the queue, then merged. */
function useHost() {
  const [stages, setStages] = useState<Stages>({})
  const timers = useRef<number[]>([])
  const set = (id: string, stage: MergeFeelStage) => setStages((now) => ({ ...now, [id]: stage }))
  const later = (ms: number, run: () => void) => {
    timers.current.push(window.setTimeout(run, ms))
  }
  useEffect(() => () => timers.current.forEach((timer) => clearTimeout(timer)), [])
  return {
    stageOf: (id: string): MergeFeelStage => stages[id] ?? 'ready',
    press: (id: string, lands = true) => {
      set(id, 'merging')
      later(TAKEN, () => set(id, 'queued'))
      if (lands) later(TAKEN + LANDS, () => set(id, 'merged'))
    },
    land: () =>
      setStages((now) => Object.fromEntries(Object.entries(now).map(([id, stage]) => [id, stage === 'queued' ? 'merged' : stage]))),
    again: () => {
      timers.current.forEach((timer) => clearTimeout(timer))
      timers.current = []
      setStages({})
    },
  }
}

function Places({ lands = true }: { lands?: boolean }) {
  const host = useHost()
  const thread = host.stageOf('thread')
  const outputs = host.stageOf('outputs')
  const open = (stage: MergeFeelStage) => stage === 'ready' || stage === 'merging'
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 640px) 300px', gap: 32, padding: 32, alignItems: 'start' }}>
      <div style={{ display: 'grid', gap: 28 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="small" onClick={host.again}>
            Start over
          </Button>
          <Button size="small" onClick={host.land}>
            Land now
          </Button>
          <Button size="small" onClick={() => LANE.forEach((card) => host.press(card.id, lands))}>
            Merge the lane
          </Button>
        </div>
        <SmallChange
          title="Changelog shows 0.9.0’s publish time"
          started={at('17:02')}
          changed={{ at: at('17:06'), words: '1 line in apps/site/src/changelog.ts' }}
          checks={{ state: 'passed', passed: 5, total: 5, failing: null, at: at('17:13') }}
          merge={{ state: thread, at: thread === 'merged' ? at('17:21') : null }}
          review={{ when: 'before', state: 'clear', findings: 0, at: at('17:10') }}
          text={{ fullTask: 'Small change', clear: 'Reviewed before Ship' }}
          team="Claude Sonnet 5.5 · Low, GPT-6.1 Terra reviews"
          onMerge={() => host.press('thread', lands)}
        />
        <ChangeSet
          state={open(outputs) ? ChangeState.Ready : outputs === 'queued' ? ChangeState.Queued : ChangeState.Merged}
          host={GITHUB}
          prs={[
            {
              repo: 'AltharIDE/althar',
              number: 964,
              url: 'https://github.com/AltharIDE/althar/pull/964',
              files: [
                { path: 'apps/site/src/changelog.ts', add: 1, del: 1 },
                { path: 'apps/site/tests/changelog.test.ts', add: 14, del: 0 },
              ],
            },
          ]}
          checks={['lint', 'types', 'unit', 'e2e'].map((name) => ({ id: name, name, state: CheckState.Passed }))}
          review={{ state: CheckState.Passed, by: [CODEX] }}
          {...(open(outputs)
            ? {
                actions: (
                  <MergeButton
                    variant="signal"
                    standing={outputs === 'merging' ? 'merging' : null}
                    onMerge={() => host.press('outputs', lands)}
                  >
                    Accept and merge
                  </MergeButton>
                ),
              }
            : {})}
        />
      </div>
      <div style={{ display: 'grid', gap: 10 }}>
        {LANE.map((card) => {
          const stage = host.stageOf(card.id)
          return (
            <BoardCard
              key={card.id}
              status={open(stage) ? TaskStatus.Yours : stage === 'queued' ? TaskStatus.Running : TaskStatus.Done}
              word={open(stage) ? 'Ready to accept' : stage === 'queued' ? 'In the merge queue' : 'Merged'}
              kind={TaskKind.Change}
              at={card.at}
              title={card.title}
              object={<PullChip host={GITHUB} repo="althar" number={card.number} add={card.add} del={card.del} />}
              {...(open(stage) ? { merge: stage } : {})}
              next={
                open(stage) && (
                  <MergeButton
                    strip
                    busy={stage === 'merging'}
                    aria-label={`Accept and merge #${card.number}`}
                    onMerge={() => host.press(card.id, lands)}
                  >
                    Accept and merge
                  </MergeButton>
                )
              }
            />
          )
        })}
      </div>
    </div>
  )
}

/** Press Merge in any place: it answers, goes into its queue, and lands on its own a few seconds later. */
export const Felt: Story = {
  render: () => <Places />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const thread = canvas.getByText('Changelog shows 0.9.0’s publish time').closest('[data-rhythm]') as HTMLElement
    await userEvent.click(within(thread).getByRole('button', { name: 'Merge' }))
    // At once, in Merge's place and nothing to press again; then in its queue, and merged.
    await expect(within(thread).getByRole('status')).toHaveTextContent('Merging')
    await expect(within(thread).queryByRole('button', { name: 'Merge' })).toBeNull()
    await waitFor(() => expect(within(thread).getByText('In the queue')).toBeInTheDocument())
    await waitFor(() => expect(within(thread).queryByText('In the queue')).toBeNull(), { timeout: 4000 })
  },
}

/** Lands only at Land now: for looking at each step, and at many landing at once. */
export const LandsWhenTold: Story = {
  render: () => <Places lands={false} />,
}
