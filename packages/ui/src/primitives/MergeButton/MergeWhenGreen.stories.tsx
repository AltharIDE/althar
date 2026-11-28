import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { BoardCard } from '../../board/BoardCard/BoardCard'
import { Fact, FactLine, PullChip } from '../../board/BoardCard/Chips'
import { MERIDIAN } from '../../fixtures/home'
import { GITHUB } from '../../fixtures/outputs'
import { ChangeState, CheckState, TaskKind, TaskStatus } from '../../foundations/vocabulary'
import { NeedLine, NeedList } from '../../home/NeedLine/NeedLine'
import { ChangeSet } from '../../outputs/ChangeSet/ChangeSet'
import { States } from '../../storybook/States'
import { LinkButton } from '../LinkButton/LinkButton'
import { NextStep } from '../NextStep/NextStep'
import { MergeButton, mergeButtonText } from './MergeButton'

/*
 * Merge when checks pass, wherever Merge shows: a task's Change card, its
 * board card's strip, and its line in Needs you. While only its checks,
 * still running, stand in the way, it offers Merge when checks pass in
 * Merge's place, quiet, as nothing is ready to merge yet. Pressed, it says
 * at once that it waits, with Don't merge beside it. A failed check or a
 * push sends it back, saying why; green, it merges.
 */

const meta = {
  title: 'Primitives/MergeButton/When checks pass',
  component: MergeButton,
  parameters: { layout: 'padded' },
  args: { onMerge: fn(), onLeave: fn() },
} satisfies Meta<typeof MergeButton>
export default meta
type Story = StoryObj<typeof meta>

const pr = [{ repo: 'meridian/api', number: 1191, url: 'https://github.com/meridian/api/pull/1191', files: [] }]
const TITLE = 'Return 409 when a refund idempotency key is reused'

type Stage = 'running' | 'waiting' | 'sent back' | 'merged'

const checksOf = (stage: Stage) =>
  [
    { id: 'lint', name: 'lint', state: CheckState.Passed },
    { id: 'unit', name: 'unit', state: CheckState.Passed },
    {
      id: 'e2e',
      name: 'e2e',
      state: stage === 'sent back' ? CheckState.Failed : stage === 'merged' ? CheckState.Passed : CheckState.Running,
    },
  ] as const

const BACK = 'Not merged: its checks failed.'
/** What a failed check offers next, as the window words it: the lead's to fix. */
const FIX = 'Ask the lead to fix it'

/** What its button is at each stage, in a place's own size and shape. */
const button = (stage: Stage, args: Story['args'], place: { strip?: boolean; size?: 'small' }) =>
  stage === 'running' ? (
    <MergeButton {...place} whenGreen onMerge={args?.onMerge} />
  ) : stage === 'waiting' ? (
    <MergeButton {...place} whenGreen standing="waiting" onLeave={args?.onLeave} />
  ) : stage === 'merged' ? (
    <MergeButton {...place} standing="merged" />
  ) : null

const changeCard = (stage: Stage, args: Story['args']) => (
  <ChangeSet
    state={stage === 'merged' ? ChangeState.Merged : ChangeState.Ready}
    host={GITHUB}
    prs={pr}
    target="main"
    checks={[...checksOf(stage)]}
    {...(stage === 'sent back' ? { error: BACK } : {})}
    {...(stage === 'merged' ? {} : { actions: button(stage, args, {}) })}
  />
)

const footOf = (stage: Stage): ReactNode => (
  <FactLine>
    {stage === 'sent back' && (
      <Fact icon="close" tone="danger" role="alert">
        {BACK}
      </Fact>
    )}
    {stage === 'sent back' ? (
      <Fact icon="close" tone="danger">
        e2e failed
      </Fact>
    ) : stage === 'merged' ? (
      <Fact icon="check" tone="ok">
        Merged into main
      </Fact>
    ) : (
      <Fact tone="live">2 of 3 checks passed</Fact>
    )}
  </FactLine>
)

const boardCard = (stage: Stage, args: Story['args']) => (
  <div style={{ width: 340 }}>
    <BoardCard
      status={stage === 'merged' ? TaskStatus.Done : TaskStatus.Yours}
      word={stage === 'merged' ? 'Merged' : stage === 'sent back' ? 'Checks failed' : 'Checks running'}
      kind={TaskKind.Change}
      at="12m"
      title={TITLE}
      object={<PullChip host={GITHUB} repo="meridian-api" number={1191} add={212} del={41} />}
      foot={footOf(stage)}
      {...(stage === 'merged'
        ? {}
        : { next: stage === 'sent back' ? <NextStep arrow>{FIX}</NextStep> : button(stage, args, { strip: true }) })}
    />
  </div>
)

const needLine = (stage: Stage, args: Story['args']) =>
  stage === 'merged' ? (
    <p style={{ color: 'var(--t-3)', fontSize: 12.5 }}>Out of Needs you once merged.</p>
  ) : (
    <NeedList style={{ maxWidth: 760 }}>
      <NeedLine
        kind={stage === 'sent back' ? 'Checks failed' : 'Checks running'}
        project={MERIDIAN}
        task="416"
        title={TITLE}
        brief={
          stage === 'sent back' ? (
            <Fact icon="close" tone="danger" role="alert">
              {BACK}
            </Fact>
          ) : (
            'meridian-api #1191 · 2 of 3 checks passed · +212 −41'
          )
        }
        onOpen={fn()}
        actions={stage === 'sent back' ? <LinkButton onClick={fn()}>{FIX}</LinkButton> : button(stage, args, { size: 'small' })}
      />
    </NeedList>
  )

const placesAt = (stage: Stage, args: Story['args']) => (
  <States
    size="thread"
    cells={[
      { state: `Change card, ${stage}`, node: changeCard(stage, args) },
      { state: `Board card, ${stage}`, node: boardCard(stage, args) },
      { state: `Needs you, ${stage}`, node: needLine(stage, args) },
    ]}
  />
)

/** Its checks still running: Merge when checks pass in Merge's place, quiet. */
export const Running: Story = {
  render: (args) => placesAt('running', args),
  play: async ({ args, canvasElement }) => {
    const [first] = within(canvasElement).getAllByRole('button', { name: mergeButtonText.whenGreen })
    if (first !== undefined) await userEvent.click(first)
    await expect(args.onMerge).toHaveBeenCalled()
  },
}

/** Pressed: it says at once that it waits, with Don't merge beside it to take it out again. */
export const Waiting: Story = {
  render: (args) => placesAt('waiting', args),
  play: async ({ args, canvasElement }) => {
    await expect(within(canvasElement).getAllByText(mergeButtonText.waiting).length).toBeGreaterThan(0)
    const [first] = within(canvasElement).getAllByRole('button', { name: mergeButtonText.leave })
    if (first !== undefined) await userEvent.click(first)
    await expect(args.onLeave).toHaveBeenCalled()
  },
}

/** A check failed: it came back unmerged, saying why. */
export const SentBack: Story = { render: (args) => placesAt('sent back', args) }

/** Green, the merge line merged it. */
export const Merged: Story = { render: (args) => placesAt('merged', args) }
