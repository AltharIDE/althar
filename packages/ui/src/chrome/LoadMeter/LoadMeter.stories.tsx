import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState } from 'react'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import {
  LOAD_BUSY,
  LOAD_IDLE,
  LOAD_MEMORY_SHORT,
  LOAD_NEAR_MAX,
  LOAD_NOTHING_RUNNING,
  LOAD_ONE_TASK,
  LOAD_SLOTS,
  LOAD_UNKNOWN_WORK,
} from '../../fixtures/load'
import { MARKED } from '../../fixtures/marks'
import { Room } from '../../foundations/vocabulary'
import { States, statesOn } from '../../storybook/States'
import { ChromeButton } from '../ChromeButton/ChromeButton'
import { ProjectTabs } from '../ProjectTabs/ProjectTabs'
import { RoomSwitch } from '../RoomSwitch/RoomSwitch'
import type { LoadGlance, LoadPoint } from './load'
import { LoadMeter, type LoadMeterProps } from './LoadMeter'

const meta = {
  title: 'Chrome/LoadMeter',
  component: LoadMeter,
  args: { load: LOAD_BUSY, slots: LOAD_SLOTS, onOpen: fn(), onHide: fn() },
  // At the end of a row, as in the bar, with room under it for the peek.
  decorators: [
    (Story, { parameters }) =>
      parameters.pseudo ? (
        Story()
      ) : (
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-start', minHeight: 640 }}>{Story()}</div>
      ),
  ],
} satisfies Meta<typeof LoadMeter>
export default meta
type Story = StoryObj<typeof meta>

/** Nothing of Althar's runs: the Mac on its own, its steps in ink. */
export const NothingRunning: Story = { args: { load: LOAD_NOTHING_RUNNING } }
/** A lead thinking barely touches the CPU: nothing lights. */
export const Idle: Story = { args: { load: LOAD_IDLE } }
/** One task running its tests: its part lit in cobalt, the rest of the Mac after it in ink. */
export const OneTask: Story = { args: { load: LOAD_ONE_TASK } }
/** Four pieces of work across two projects. */
export const Busy: Story = {}
/** Every core busy and memory tight: both meters in full ink. */
export const NearMax: Story = { args: { load: LOAD_NEAR_MAX } }
/** macOS moving memory to disk. */
export const MemoryShort: Story = { args: { load: LOAD_MEMORY_SHORT } }
/** Where Althar's part can't be known, as on Windows: the Mac's load alone, in ink. */
export const WorkUnknown: Story = { args: { load: LOAD_UNKNOWN_WORK } }

/** A click opens the peek: the last two minutes, the figures, each piece of work's share, and the switch. */
export const Open: Story = { args: { defaultOpen: true } }
export const OpenNearMax: Story = { args: { load: LOAD_NEAR_MAX, defaultOpen: true } }
/** Without ways in or out: the rows say, and there is no switch. */
export const OpenWithoutWays: Story = { args: { defaultOpen: true, onOpen: undefined, onHide: undefined } }

/* A loop of three minutes, a reading every two seconds: leads thinking, a build, a test suite that fills the Mac, then quiet. */
const LOOP: LoadPoint[] = Array.from({ length: 90 }, (_, i) => {
  const t = i / 90
  const build = Math.exp(-(((t - 0.28) / 0.06) ** 2)) * 0.38
  const suite = t > 0.45 && t < 0.78 ? 0.55 + Math.sin(i * 1.7) * 0.06 : 0
  const work = Math.min(1, 0.04 + Math.sin(i * 0.9) * 0.01 + build + suite)
  return { cpu: Math.min(1, work + 0.1 + Math.sin(i * 0.43) * 0.04), work }
})

const liveAt = (n: number): LoadGlance => {
  const now = LOOP[n % LOOP.length] ?? { cpu: 0, work: 0 }
  const scale = now.work / (LOAD_BUSY.work ?? 1)
  return {
    ...LOAD_BUSY,
    cpu: now.cpu,
    work: now.work,
    memory: 0.5 + now.work * 0.3,
    workMemory: 0.1 + now.work * 0.25,
    memoryUsed: `${(32 * (0.5 + now.work * 0.3)).toFixed(1)} GB`,
    rows: (LOAD_BUSY.rows ?? []).map((row) => ({ ...row, cpu: row.cpu * scale })),
    history: Array.from(
      { length: Math.min(n + 1, LOAD_SLOTS) },
      (_, i) => LOOP[(n - Math.min(n, LOAD_SLOTS - 1) + i) % LOOP.length] ?? now,
    ),
  }
}

function Live(props: Omit<LoadMeterProps, 'load'>) {
  const [n, setN] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setN((was) => was + 1), 2_000)
    return () => clearInterval(timer)
  }, [])
  return <LoadMeter {...props} load={liveAt(n)} />
}

/** Made-up readings every two seconds: the steps hold still near their edges, and change only when the load really does. */
export const LiveReadings: Story = { render: (args) => <Live {...args} /> }

/** In the window's bar, at its end, before the screen's own controls. */
export const InTheBar: Story = {
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <div style={{ minHeight: 600 }}>{Story()}</div>],
  render: (args) => (
    <ProjectTabs
      lights="drawn"
      tabs={MARKED.slice(0, 3).map((p) => ({ id: p.id, name: p.name, seed: p.id, ink: p.ink, running: p.running, yours: 0 }))}
      current={MARKED[0]?.id ?? null}
      yours={0}
      others={[]}
      onSelect={fn()}
      onClose={fn()}
      onOpen={fn()}
      onNewProject={fn()}
      end={
        <>
          <LoadMeter {...args} />
          <RoomSwitch value={Room.Talk} onChange={fn()} />
          <ChromeButton icon="plus" label="New task" onClick={fn()} />
        </>
      }
    />
  ),
}

/** Its name says its numbers; pressed, it opens the peek, and a row opens its work, closing the peek. */
export const OpeningAPieceOfWork: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'CPU 63%, MEM 61%' }))
    const peek = await screen.findByRole('dialog', { name: 'This Mac’s load' })
    await expect(within(peek).getByRole('heading', { name: 'This Mac' })).toBeInTheDocument()
    await userEvent.click(within(peek).getByRole('button', { name: /Migrate billing webhooks/ }))
    await expect(args.onOpen).toHaveBeenCalledWith('task 419')
    // The peek closes as its work opens.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  },
}

/** The switch in the peek takes the meter out of the bar. */
export const Hiding: Story = {
  args: { defaultOpen: true },
  play: async ({ args }) => {
    const peek = await screen.findByRole('dialog', { name: 'This Mac’s load' })
    const show = within(peek).getByRole('switch', { name: 'Show in the bar' })
    await expect(show).toHaveAccessibleDescription('Settings brings it back.')
    await userEvent.click(show)
    await expect(args.onHide).toHaveBeenCalledOnce()
  },
}

/** Escape closes the peek and puts focus back on the meter. */
export const EscapeReturnsFocus: Story = {
  play: async ({ canvasElement }) => {
    const meter = within(canvasElement).getByRole('button', { name: 'CPU 63%, MEM 61%' })
    await userEvent.click(meter)
    await screen.findByRole('dialog', { name: 'This Mac’s load' })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await expect(meter).toHaveFocus()
  },
}

export const AllStates: Story = {
  parameters: statesOn({ hover: 'button', focus: 'button', pressed: 'button' }),
  render: (args) => (
    <States
      size="wide"
      cells={[
        ...['rest', 'hover', 'focus', 'pressed'].map((state) => ({ state, node: <LoadMeter {...args} /> })),
        { state: 'nothing running', node: <LoadMeter {...args} load={LOAD_NOTHING_RUNNING} /> },
        { state: 'idle', node: <LoadMeter {...args} load={LOAD_IDLE} /> },
        { state: 'one task', node: <LoadMeter {...args} load={LOAD_ONE_TASK} /> },
        { state: 'near max', node: <LoadMeter {...args} load={LOAD_NEAR_MAX} /> },
        { state: 'memory short', node: <LoadMeter {...args} load={LOAD_MEMORY_SHORT} /> },
        { state: 'work unknown', node: <LoadMeter {...args} load={LOAD_UNKNOWN_WORK} /> },
      ]}
    />
  ),
}
