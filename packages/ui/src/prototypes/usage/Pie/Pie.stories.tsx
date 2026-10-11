import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, screen, within } from 'storybook/test'

import { BUSY, IDLE, MEMORY_TIGHT, NEAR_MAX, NOTHING_RUNNING, ONE_AGENT } from '../fixtures'
import { ComposerHost, Frame, LivePair, Pairs, pairsParameters, type Scheme, Stage } from '../stage/Stage'
import type { Usage } from '../usage'
import { Pie, type PieProps } from './Pie'

/* The composer is task 418's: its share of each moment. */
const own = (usage: Usage) => usage.shares.find((share) => share.id === '418')

/* Task 418's composer, with the pie before the context ring. */
function InComposer({ scheme, room, ...props }: PieProps & { scheme?: Scheme; room?: 'above' }) {
  return (
    <Stage scheme={scheme} room={room}>
      <ComposerHost pie={<Pie {...props} />} />
    </Stage>
  )
}

const meta = {
  title: 'Prototypes/System usage/C. Pie by the composer',
  component: InComposer,
  args: { usage: BUSY, task: own(BUSY) },
} satisfies Meta<typeof InComposer>
export default meta
type Story = StoryObj<typeof meta>

/** The lead is thinking: the pie is empty. */
export const Idle: Story = { args: { usage: IDLE, task: own(IDLE) } }
/** This task is the only one, running its tests: its slice is cobalt, from the top. */
export const OneAgent: Story = { args: { usage: ONE_AGENT, task: own(ONE_AGENT) } }
/** Four tasks: this one's slice in cobalt, the rest of the Mac's load in ink after it. */
export const Busy: Story = {}
/** The pie full, its ink at full strength. There's no room for a word by the composer; the detail says it. */
export const NearMax: Story = { args: { usage: NEAR_MAX, task: own(NEAR_MAX) } }
/** In the project's conversation there is no task: the pie is the Mac's alone, in ink. */
export const NoTask: Story = { args: { task: undefined } }

/** Pointed at or focused: the Mac's figures, then this task's share. */
export const Detail: Story = { args: { defaultOpen: true, room: 'above' } }
export const DetailNearMax: Story = { args: { usage: NEAR_MAX, task: own(NEAR_MAX), defaultOpen: true, room: 'above' } }

export const Dark: Story = { args: { scheme: 'dark' } }
export const DetailDark: Story = { args: { scheme: 'dark', defaultOpen: true, room: 'above' } }

/** The made-up loop, a sample every 2 seconds (every 6 with reduced motion). In fifths, it changes as seldom as A's steps. */
export const Live: Story = {
  render: () => <LivePair>{(usage, scheme) => <InComposer usage={usage} task={own(usage)} scheme={scheme} />}</LivePair>,
}

/** Off: the composer as it is today, the context ring alone. */
export const Off: Story = {
  render: () => (
    <Frame caption="Turned off in Settings. The context ring stands alone again.">
      <Stage>
        <ComposerHost />
      </Stage>
    </Frame>
  ),
}

/** Focus shows the Mac's figures and this task's share, for the keyboard as for the pointer. */
export const ShowingThisTask: Story = {
  play: async ({ canvasElement }) => {
    within(canvasElement).getByRole('button', { name: 'This Mac: CPU 63%, this task 14%' }).focus()
    const card = await screen.findByRole('tooltip')
    await expect(card).toHaveTextContent('This task')
    await expect(card).toHaveTextContent('14% of the CPU · 2.1 GB · 14 processes')
  },
}

export const AllStates: Story = {
  parameters: pairsParameters,
  render: () => (
    <Pairs
      rows={[
        { state: 'nothing running', node: <Pie usage={NOTHING_RUNNING} /> },
        { state: 'idle', node: <Pie usage={IDLE} task={own(IDLE)} /> },
        { state: 'one agent', node: <Pie usage={ONE_AGENT} task={own(ONE_AGENT)} /> },
        { state: 'several', node: <Pie usage={BUSY} task={own(BUSY)} /> },
        { state: 'memory tight', node: <Pie usage={MEMORY_TIGHT} task={own(MEMORY_TIGHT)} /> },
        { state: 'near max', node: <Pie usage={NEAR_MAX} task={own(NEAR_MAX)} /> },
        { state: 'no task', node: <Pie usage={BUSY} /> },
        { state: 'hover', node: <Pie usage={BUSY} task={own(BUSY)} />, force: 'hover' },
        { state: 'focus', node: <Pie usage={BUSY} task={own(BUSY)} />, force: 'focus' },
      ]}
    />
  ),
}
