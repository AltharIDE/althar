import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, screen, userEvent, within } from 'storybook/test'

import { BUSY, IDLE, MEMORY_TIGHT, NEAR_MAX, NOTHING_RUNNING, ONE_AGENT } from '../fixtures'
import { BarHost, Frame, Pairs, pairsParameters, runningIn, type Scheme, Stage, useLive } from '../stage/Stage'
import { Meter, type MeterProps } from './Meter'

/* The bar of a project's window, with the meter where the work's status starts. */
function InBar({ scheme, room, ...props }: MeterProps & { scheme?: Scheme; room?: 'below' }) {
  return (
    <Stage scheme={scheme} room={room}>
      <BarHost running={runningIn(props.usage)} readout={<Meter {...props} />} />
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
  title: 'Prototypes/System usage/A · Meter in the bar',
  component: InBar,
  args: { usage: BUSY },
} satisfies Meta<typeof InBar>
export default meta
type Story = StoryObj<typeof meta>

/** One task, its lead waiting on the model: an agent thinking barely touches the CPU, so nothing lights. */
export const Idle: Story = { args: { usage: IDLE } }
/** One task running its tests: a step of cobalt is that task's agent and what it started. */
export const OneAgent: Story = { args: { usage: ONE_AGENT } }
/** Four tasks across two projects: most of what is lit is the agents'. */
export const Busy: Story = { args: { usage: BUSY } }
/** Every step lit, the ink at full strength, and a word for what holds the Mac back. No new colour. */
export const NearMax: Story = { args: { usage: NEAR_MAX } }
/** A click swaps the steps for figures, as wide as the steps, so the bar doesn't move. */
export const Figures: Story = { args: { defaultFigures: true } }

/** Pointed at or focused, the numbers: CPU and memory, the agents' part of each, and pressure and heat. */
export const Detail: Story = { args: { defaultOpen: true, room: 'below' } }
/** Under strain, the detail says what it means for the work. */
export const DetailNearMax: Story = { args: { usage: NEAR_MAX, defaultOpen: true, room: 'below' } }

export const Dark: Story = { args: { scheme: 'dark' } }
export const DetailDark: Story = { args: { scheme: 'dark', defaultOpen: true, room: 'below' } }

/** The made-up loop of a build and a test suite, a sample every 2 seconds (every 6 with reduced motion). Watch how seldom a step changes. */
export const Live: Story = { render: () => <LiveBars /> }

/** Off: the bar as it is today. */
export const Off: Story = {
  render: () => (
    <Frame caption="Turned off in Settings, or by a switch in the detail in direction D. Nothing is left in its place.">
      <Stage>
        <BarHost running={3} />
      </Stage>
    </Frame>
  ),
}

/** A click swaps steps and figures; the name says the numbers either way. */
export const SwitchingToFigures: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const meter = canvas.getByRole('button', { name: 'CPU 63%, MEM 61%' })
    await expect(canvas.queryByText('63%')).toBeNull()
    await userEvent.click(meter)
    await expect(canvas.getByText('63%')).toBeInTheDocument()
    await userEvent.click(meter)
    await expect(canvas.queryByText('63%')).toBeNull()
  },
}

/** Focus shows the numbers, for the keyboard as for the pointer. */
export const ShowingTheNumbers: Story = {
  args: { usage: NEAR_MAX },
  play: async ({ canvasElement }) => {
    within(canvasElement).getByRole('button', { name: 'CPU 96%, MEM 91%' }).focus()
    const card = await screen.findByRole('tooltip')
    await expect(card).toHaveTextContent('Slowed by heat.')
    await expect(within(canvasElement).getByText('Slowed by heat')).toBeInTheDocument()
  },
}

export const AllStates: Story = {
  parameters: pairsParameters,
  render: () => (
    <Pairs
      rows={[
        { state: 'nothing running', node: <Meter usage={NOTHING_RUNNING} /> },
        { state: 'idle', node: <Meter usage={IDLE} /> },
        { state: 'one agent', node: <Meter usage={ONE_AGENT} /> },
        { state: 'several', node: <Meter usage={BUSY} /> },
        { state: 'memory tight', node: <Meter usage={MEMORY_TIGHT} /> },
        { state: 'near max', node: <Meter usage={NEAR_MAX} /> },
        { state: 'figures', node: <Meter usage={BUSY} defaultFigures /> },
        { state: 'figures, near max', node: <Meter usage={NEAR_MAX} defaultFigures /> },
        { state: 'hover', node: <Meter usage={BUSY} />, force: 'hover' },
        { state: 'focus', node: <Meter usage={BUSY} />, force: 'focus' },
      ]}
    />
  ),
}
