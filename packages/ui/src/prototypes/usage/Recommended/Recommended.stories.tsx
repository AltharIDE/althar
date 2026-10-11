import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, screen, userEvent, within } from 'storybook/test'

import { BUSY, IDLE, MEMORY_TIGHT, NEAR_MAX, NOTHING_RUNNING, ONE_AGENT } from '../fixtures'
import { BarHost, Pairs, pairsParameters, runningIn, type Scheme, Stage, useLive } from '../stage/Stage'
import { Recommended, type RecommendedProps } from './Recommended'

/* The bar of a project's window, with the meter where the work's status starts. */
function InBar({ scheme, room, ...props }: RecommendedProps & { scheme?: Scheme; room?: 'below' }) {
  return (
    <Stage scheme={scheme} room={room}>
      <BarHost running={runningIn(props.usage)} readout={<Recommended {...props} />} />
    </Stage>
  )
}

function LiveBars() {
  const { ref, usage } = useLive()
  return (
    <div ref={ref} style={{ display: 'grid', gap: 12 }}>
      <InBar usage={usage} />
      <InBar usage={usage} scheme="dark" />
    </div>
  )
}

const meta = {
  title: 'Prototypes/System usage/E · Recommended',
  component: InBar,
  args: { usage: BUSY, onOpenTask: fn(), onHide: fn() },
} satisfies Meta<typeof InBar>
export default meta
type Story = StoryObj<typeof meta>

export const Idle: Story = { args: { usage: IDLE } }
export const OneAgent: Story = { args: { usage: ONE_AGENT } }
export const Busy: Story = {}
export const NearMax: Story = { args: { usage: NEAR_MAX } }

/** A click on the meter opens direction D's peek: who is using the Mac, and the switch to take the meter out of the bar. */
export const Open: Story = { args: { defaultOpen: true, room: 'below' } }
export const OpenNearMax: Story = { args: { usage: NEAR_MAX, defaultOpen: true, room: 'below' } }

export const Dark: Story = { args: { scheme: 'dark' } }
export const OpenDark: Story = { args: { scheme: 'dark', defaultOpen: true, room: 'below' } }

/** The made-up loop, a sample every 2 seconds (every 6 with reduced motion). */
export const Live: Story = { render: () => <LiveBars /> }

/** The meter's name says its numbers; pressed, it opens the peek. */
export const Opening: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'CPU 63%, MEM 61%' }))
    const peek = await screen.findByRole('dialog', { name: 'This Mac’s load' })
    await expect(within(peek).getByRole('heading', { name: 'Tasks' })).toBeInTheDocument()
  },
}

export const AllStates: Story = {
  parameters: pairsParameters,
  render: () => (
    <Pairs
      rows={[
        { state: 'nothing running', node: <Recommended usage={NOTHING_RUNNING} /> },
        { state: 'idle', node: <Recommended usage={IDLE} /> },
        { state: 'one agent', node: <Recommended usage={ONE_AGENT} /> },
        { state: 'several', node: <Recommended usage={BUSY} /> },
        { state: 'memory tight', node: <Recommended usage={MEMORY_TIGHT} /> },
        { state: 'near max', node: <Recommended usage={NEAR_MAX} /> },
        { state: 'hover', node: <Recommended usage={BUSY} />, force: 'hover' },
        { state: 'focus', node: <Recommended usage={BUSY} />, force: 'focus' },
      ]}
    />
  ),
}
