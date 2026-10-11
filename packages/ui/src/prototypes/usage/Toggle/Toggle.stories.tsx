import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useRef, useState } from 'react'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { SettingList } from '../../../setup/Preferences/Preferences'
import { Recommended } from '../Recommended/Recommended'
import { BUSY, NOTHING_RUNNING } from '../fixtures'
import { BarHost, Frame, runningIn, type Scheme, Sheet, Stage } from '../stage/Stage'
import type { Usage } from '../usage'
import { LoadSetting } from './LoadSetting'

/*
 * How the readout comes and goes, shown with the recommended one: a row in
 * Settings, a switch in its own peek, and leaving the bar by itself while
 * nothing runs. Every direction comes and goes the same way.
 */

interface WindowProps {
  usage: Usage
  scheme?: Scheme
  /** Whether the setting starts on. */
  on?: boolean
  onlyRunning?: boolean
}

/* The bar, and Settings under it, wired together as the app would. */
function Window({ usage, scheme, on: initial = true, onlyRunning: initialOnly = true }: WindowProps) {
  const [on, setOn] = useState(initial)
  const [onlyRunning, setOnlyRunning] = useState(initialOnly)
  const next = useRef<HTMLButtonElement>(null)
  /* turned off from the readout itself, focus goes to what follows it in the bar */
  const fromReadout = useRef(false)
  useEffect(() => {
    if (on || !fromReadout.current) return
    fromReadout.current = false
    next.current?.focus()
  }, [on])
  const shown = on && (!onlyRunning || usage.shares.length > 0)
  return (
    <Stage scheme={scheme} room="below">
      <BarHost
        running={runningIn(usage)}
        nextRef={next}
        readout={
          shown && (
            <Recommended
              usage={usage}
              onOpenTask={fn()}
              onHide={() => {
                fromReadout.current = true
                setOn(false)
              }}
            />
          )
        }
      />
      <div style={{ padding: 24 }}>
        <Sheet>
          <SettingList>
            <LoadSetting on={on} onChange={setOn} onlyRunning={onlyRunning} onOnlyRunningChange={setOnlyRunning} />
          </SettingList>
        </Sheet>
      </div>
    </Stage>
  )
}

const meta = {
  title: 'Prototypes/System usage/Turning it on and off',
  component: Window,
  args: { usage: BUSY },
} satisfies Meta<typeof Window>
export default meta
type Story = StoryObj<typeof meta>

/** The row in Settings, and the bar it changes. Try both switches. */
export const InSettings: Story = {}
export const InSettingsDark: Story = { args: { scheme: 'dark' } }

/** Off: the bar as it is today. It is off until the person turns it on. */
export const Off: Story = { args: { on: false } }

/** Nothing running, and only while work runs: the bar is as it is today until a task starts. */
export const NothingRunning: Story = {
  render: (args) => (
    <Frame caption="The setting is on, but no task runs, so the meter is out of the bar. It comes back when a task starts.">
      <Window {...args} />
    </Frame>
  ),
  args: { usage: NOTHING_RUNNING },
}

/** Off in Settings, the meter leaves the bar, and the row under it waits; on again, it's back. */
export const TurningOffInSettings: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const setting = canvas.getByRole('switch', { name: 'Show this Mac’s load' })
    await expect(canvas.getByRole('button', { name: 'CPU 63%, MEM 61%' })).toBeInTheDocument()
    await userEvent.click(setting)
    await expect(canvas.queryByRole('button', { name: 'CPU 63%, MEM 61%' })).toBeNull()
    await expect(canvas.getByRole('switch', { name: 'Only while work runs' })).toBeDisabled()
    await userEvent.click(setting)
    await expect(canvas.getByRole('button', { name: 'CPU 63%, MEM 61%' })).toBeInTheDocument()
  },
}

/** Off from the peek: the meter leaves, Settings shows it off, and focus goes to what follows it in the bar. */
export const TurningOffFromTheReadout: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'CPU 63%, MEM 61%' }))
    const peek = await screen.findByRole('dialog', { name: 'This Mac’s load' })
    await userEvent.click(within(peek).getByRole('switch', { name: 'Show in the bar' }))
    await waitFor(() => expect(canvas.queryByRole('button', { name: 'CPU 63%, MEM 61%' })).toBeNull())
    await expect(canvas.getByRole('switch', { name: 'Show this Mac’s load' })).toHaveAttribute('aria-checked', 'false')
    await waitFor(() => expect(canvas.getByRole('button', { name: /Knowledge/ })).toHaveFocus())
  },
}

/** With "Only while work runs" off, the meter stays with nothing running: the Mac on its own. */
export const ShownWhileNothingRuns: Story = {
  args: { usage: NOTHING_RUNNING },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: /^CPU/ })).toBeNull()
    await userEvent.click(canvas.getByRole('switch', { name: 'Only while work runs' }))
    await expect(canvas.getByRole('button', { name: 'CPU 5%, MEM 38%' })).toBeInTheDocument()
  },
}
