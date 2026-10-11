import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useRef, useState } from 'react'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { BUSY, IDLE, MEMORY_TIGHT, NEAR_MAX, NOTHING_RUNNING, ONE_AGENT } from '../fixtures'
import { BarHost, Frame, Pairs, pairsParameters, runningIn, type Scheme, Stage, useLive } from '../stage/Stage'
import { PeekReadout, type PeekReadoutProps } from './Peek'

/* The bar of a project's window, with the glyph where the work's status starts. */
function InBar({ scheme, room, ...props }: PeekReadoutProps & { scheme?: Scheme; room?: 'below' }) {
  return (
    <Stage scheme={scheme} room={room}>
      <BarHost running={runningIn(props.usage)} readout={<PeekReadout {...props} />} />
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

/* Turned off from the peek: the glyph leaves the bar, and focus goes to what follows it there. */
function Hideable() {
  const [shown, setShown] = useState(true)
  const next = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!shown) next.current?.focus()
  }, [shown])
  return (
    <Stage room="below">
      <BarHost running={3} nextRef={next} readout={shown && <PeekReadout usage={BUSY} onHide={() => setShown(false)} />} />
    </Stage>
  )
}

const meta = {
  title: 'Prototypes/System usage/D · Glyph and peek',
  component: InBar,
  args: { usage: BUSY, onOpenTask: fn(), onHide: fn() },
} satisfies Meta<typeof InBar>
export default meta
type Story = StoryObj<typeof meta>

/** Quiet: one bar of three. It stays there through everything short of a build. */
export const Idle: Story = { args: { usage: IDLE } }
/** A task running its tests is still quiet: one task seldom makes a Mac busy. */
export const OneAgent: Story = { args: { usage: ONE_AGENT } }
/** Busy: two bars. */
export const Busy: Story = {}
/** Full: three bars in full ink, and a word for what holds the Mac back. */
export const NearMax: Story = { args: { usage: NEAR_MAX } }

/** A click opens the peek: the last two minutes, the figures, each task's share across every project, and a switch to take the glyph out of the bar. */
export const Open: Story = { args: { defaultOpen: true, room: 'below' } }
/** Under strain the peek says what it means for the work, and which task to look at first. */
export const OpenNearMax: Story = { args: { usage: NEAR_MAX, defaultOpen: true, room: 'below' } }
export const OpenOneAgent: Story = { args: { usage: ONE_AGENT, defaultOpen: true, room: 'below' } }
/** With nothing running, the peek says so; the rest is the Mac on its own. */
export const OpenNothingRunning: Story = { args: { usage: NOTHING_RUNNING, defaultOpen: true, room: 'below' } }

export const Dark: Story = { args: { scheme: 'dark' } }
export const OpenDark: Story = { args: { scheme: 'dark', defaultOpen: true, room: 'below' } }

/** The made-up loop, a sample every 2 seconds (every 6 with reduced motion). The glyph changes only at the build and the test suite. */
export const Live: Story = { render: () => <LiveBars /> }

/** Off: the bar as it is today. */
export const Off: Story = {
  render: () => (
    <Frame caption="Turned off from the peek's own switch, or in Settings. Nothing is left in its place.">
      <Stage>
        <BarHost running={3} />
      </Stage>
    </Frame>
  ),
}

/** A task's row is a way into it. */
export const OpeningATask: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'This Mac: Busy' }))
    const peek = await screen.findByRole('dialog', { name: 'This Mac’s load' })
    await userEvent.click(within(peek).getByRole('button', { name: /Migrate billing webhooks/ }))
    await expect(args.onOpenTask).toHaveBeenCalledWith('419')
  },
}

/** The switch at the peek's foot takes the glyph out of the bar, and focus goes to what follows it. */
export const TurningItOff: Story = {
  render: () => <Hideable />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'This Mac: Busy' }))
    const peek = await screen.findByRole('dialog', { name: 'This Mac’s load' })
    await userEvent.click(within(peek).getByRole('switch', { name: 'Show in the bar' }))
    await waitFor(() => expect(canvas.queryByRole('button', { name: 'This Mac: Busy' })).toBeNull())
    await waitFor(() => expect(canvas.getByRole('button', { name: /Knowledge/ })).toHaveFocus())
  },
}

export const AllStates: Story = {
  parameters: pairsParameters,
  render: () => (
    <Pairs
      rows={[
        { state: 'nothing running', node: <PeekReadout usage={NOTHING_RUNNING} /> },
        { state: 'idle', node: <PeekReadout usage={IDLE} /> },
        { state: 'one agent', node: <PeekReadout usage={ONE_AGENT} /> },
        { state: 'several', node: <PeekReadout usage={BUSY} /> },
        { state: 'memory tight', node: <PeekReadout usage={MEMORY_TIGHT} /> },
        { state: 'near max', node: <PeekReadout usage={NEAR_MAX} /> },
        { state: 'hover', node: <PeekReadout usage={BUSY} />, force: 'hover' },
        { state: 'focus', node: <PeekReadout usage={BUSY} />, force: 'focus' },
      ]}
    />
  ),
}
