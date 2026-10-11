import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, screen, within } from 'storybook/test'

import { BUSY, IDLE, MEMORY_TIGHT, NEAR_MAX, NOTHING_RUNNING, ONE_AGENT } from '../fixtures'
import { BarHost, Frame, LivePair, Pairs, pairsParameters, runningIn, type Scheme, Stage } from '../stage/Stage'
import { Trace, type TraceProps } from './Trace'

/* The bar of a project's window, with the trace where the work's status starts. */
function InBar({ scheme, room, ...props }: TraceProps & { scheme?: Scheme; room?: 'below' }) {
  return (
    <Stage scheme={scheme} room={room}>
      <BarHost running={runningIn(props.usage)} readout={<Trace {...props} />} />
    </Stage>
  )
}

const meta = {
  title: 'Prototypes/System usage/B. Trace beside the work',
  component: InBar,
  args: { usage: BUSY },
} satisfies Meta<typeof InBar>
export default meta
type Story = StoryObj<typeof meta>

/** A flat line near the floor: one task, its lead thinking. */
export const Idle: Story = { args: { usage: IDLE } }
/** The line steps up a minute ago, when the lead started the tests; the cobalt under it is that task. */
export const OneAgent: Story = { args: { usage: ONE_AGENT } }
/** Four tasks: the cobalt fills most of what is under the line. */
export const Busy: Story = { args: { usage: BUSY } }
/** At the top, the line in full ink, and a word for what holds the Mac back. */
export const NearMax: Story = { args: { usage: NEAR_MAX } }

/** Pointed at or focused: the last two minutes, wide enough to read, then the figures. */
export const Detail: Story = { args: { defaultOpen: true, room: 'below' } }
export const DetailNearMax: Story = { args: { usage: NEAR_MAX, defaultOpen: true, room: 'below' } }

export const Dark: Story = { args: { scheme: 'dark' } }
export const DetailDark: Story = { args: { scheme: 'dark', defaultOpen: true, room: 'below' } }

/** The made-up loop, a point every 2 seconds (every 6 with reduced motion). The line moves with every point: judge whether that is calm enough beside your work. */
export const Live: Story = { render: () => <LivePair>{(usage, scheme) => <InBar usage={usage} scheme={scheme} />}</LivePair> }

/** Off: the bar as it is today. */
export const Off: Story = {
  render: () => (
    <Frame caption="Turned off in Settings. Nothing is left in its place.">
      <Stage>
        <BarHost running={3} />
      </Stage>
    </Frame>
  ),
}

/** Focus shows the trend and the figures, for the keyboard as for the pointer. */
export const ShowingTheTrend: Story = {
  play: async ({ canvasElement }) => {
    within(canvasElement).getByRole('button', { name: 'CPU 63%, agents 51%' }).focus()
    const card = await screen.findByRole('tooltip')
    await expect(card).toHaveTextContent('CPU over the last 2 minutes')
    await expect(card).toHaveTextContent('Agents 51%')
  },
}

export const AllStates: Story = {
  parameters: pairsParameters,
  render: () => (
    <Pairs
      rows={[
        { state: 'nothing running', node: <Trace usage={NOTHING_RUNNING} /> },
        { state: 'idle', node: <Trace usage={IDLE} /> },
        { state: 'one agent', node: <Trace usage={ONE_AGENT} /> },
        { state: 'several', node: <Trace usage={BUSY} /> },
        { state: 'memory tight', node: <Trace usage={MEMORY_TIGHT} /> },
        { state: 'near max', node: <Trace usage={NEAR_MAX} /> },
        { state: 'hover', node: <Trace usage={BUSY} />, force: 'hover' },
        { state: 'focus', node: <Trace usage={BUSY} />, force: 'focus' },
      ]}
    />
  ),
}
