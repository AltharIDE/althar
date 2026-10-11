import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, screen, within } from 'storybook/test'

import { BUSY, IDLE, MEMORY_TIGHT, NEAR_MAX, NOTHING_RUNNING, ONE_AGENT } from '../fixtures'
import { ComposerHost, Frame, Pairs, pairsParameters, type Scheme, Stage, useLive } from '../stage/Stage'
import type { Usage } from '../usage'
import { Dial, type DialProps } from './Dial'

/* The composer is task 418's: its share of each moment. */
const own = (usage: Usage) => usage.shares.find((share) => share.id === '418')

/* Task 418's composer, with the dial before the context ring. */
function InComposer({ scheme, room, ...props }: DialProps & { scheme?: Scheme; room?: 'above' }) {
  return (
    <Stage scheme={scheme} room={room}>
      <ComposerHost dial={<Dial {...props} />} />
    </Stage>
  )
}

function LiveComposers() {
  const { ref, usage } = useLive()
  return (
    <div ref={ref} style={{ display: 'grid', gap: 12 }}>
      <InComposer usage={usage} task={own(usage)} />
      <InComposer usage={usage} task={own(usage)} scheme="dark" />
    </div>
  )
}

const meta = {
  title: 'Prototypes/System usage/C · Dial by the composer',
  component: InComposer,
  args: { usage: BUSY, task: own(BUSY) },
} satisfies Meta<typeof InComposer>
export default meta
type Story = StoryObj<typeof meta>

/** The lead is thinking: one tick, if that. */
export const Idle: Story = { args: { usage: IDLE, task: own(IDLE) } }
/** This task is the only one, running its tests: its ticks are cobalt, from the top. */
export const OneAgent: Story = { args: { usage: ONE_AGENT, task: own(ONE_AGENT) } }
/** Four tasks: this one's two ticks in cobalt, the rest of the Mac's load in ink after them. */
export const Busy: Story = {}
/** Every tick lit, the ink at full strength. There's no room for a word by the composer; the detail says it. */
export const NearMax: Story = { args: { usage: NEAR_MAX, task: own(NEAR_MAX) } }
/** In the project's conversation there is no task: the dial is the Mac's alone, in ink. */
export const NoTask: Story = { args: { task: undefined } }

/** Pointed at or focused: the Mac's figures, then this task's share. */
export const Detail: Story = { args: { defaultOpen: true, room: 'above' } }
export const DetailNearMax: Story = { args: { usage: NEAR_MAX, task: own(NEAR_MAX), defaultOpen: true, room: 'above' } }

export const Dark: Story = { args: { scheme: 'dark' } }
export const DetailDark: Story = { args: { scheme: 'dark', defaultOpen: true, room: 'above' } }

/** The made-up loop, a sample every 2 seconds (every 6 with reduced motion). Twelve ticks change more often than five steps, less often than a line. */
export const Live: Story = { render: () => <LiveComposers /> }

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
        { state: 'nothing running', node: <Dial usage={NOTHING_RUNNING} /> },
        { state: 'idle', node: <Dial usage={IDLE} task={own(IDLE)} /> },
        { state: 'one agent', node: <Dial usage={ONE_AGENT} task={own(ONE_AGENT)} /> },
        { state: 'several', node: <Dial usage={BUSY} task={own(BUSY)} /> },
        { state: 'memory tight', node: <Dial usage={MEMORY_TIGHT} task={own(MEMORY_TIGHT)} /> },
        { state: 'near max', node: <Dial usage={NEAR_MAX} task={own(NEAR_MAX)} /> },
        { state: 'no task', node: <Dial usage={BUSY} /> },
        { state: 'hover', node: <Dial usage={BUSY} task={own(BUSY)} />, force: 'hover' },
        { state: 'focus', node: <Dial usage={BUSY} task={own(BUSY)} />, force: 'focus' },
      ]}
    />
  ),
}
