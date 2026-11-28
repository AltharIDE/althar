import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { States } from '../../storybook/States'
import { type UpdateKind, type UpdateRow, Updates } from './Updates'

/* Althar's own update, a home's and its workers', as the window's bar gathers them under one glyph. */

const restart = fn()
const ALTHAR: UpdateRow = {
  kind: 'app',
  tone: 'offer',
  title: 'Althar 0.10.1 is ready',
  who: 'Althar 0.10.1',
  end: { kind: 'press', label: 'Restart', onPress: restart },
  hides: true,
}
const HOME: UpdateRow = {
  kind: 'home',
  tone: 'offer',
  title: 'runner-1 can update to 0.3.0',
  line: 'runner-1 restarts once, in a minute or two.',
  who: 'runner-1',
  end: { kind: 'press', label: 'Update', onPress: fn() },
  hides: true,
}
const WORKERS: UpdateRow = {
  kind: 'workers',
  tone: 'offer',
  title: '11 workers can update to 0.3.0',
  line: 'Each restarts once, between its tasks: the 3 at work once they’re done.',
  who: '11 workers',
  end: { kind: 'press', label: 'Update all', onPress: fn() },
  hides: true,
}

/** As the bar holds it: what's put aside goes, and with nothing left, where they still are, for a moment. */
function Held({ rows, ...props }: Parameters<typeof Updates>[0]) {
  const [hidden, setHidden] = useState<UpdateKind[]>([])
  const left = rows.filter((row) => !hidden.includes(row.kind))
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', minHeight: 420, padding: 8 }}>
      <Updates
        {...props}
        rows={left}
        onHide={(kind) => setHidden((was) => [...was, kind])}
        still={left.length === 0 ? { where: 'Settings › Computers', onShow: fn() } : null}
      />
    </div>
  )
}

const meta = {
  title: 'Chrome/Updates',
  component: Held,
  args: { rows: [ALTHAR, WORKERS], onCheck: fn() },
} satisfies Meta<typeof Held>
export default meta
type Story = StoryObj<typeof meta>

/** Althar's update and its workers': a dot on the glyph. */
export const Offered: Story = {}

/** Open: a row each, Althar's first, each with its press. */
export const Open: Story = {
  args: { open: true },
  play: async ({ canvasElement }) => {
    const rows = within(canvasElement.ownerDocument.body).getAllByRole('listitem')
    await expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Althar 0.10.1 is ready'),
      expect.stringContaining('11 workers can update to 0.3.0'),
    ])
  },
}

/** In a window on another computer's home: that home's update too, between Althar's and its workers'. */
export const OnAHome: Story = { args: { rows: [ALTHAR, HOME, WORKERS], open: true } }

/** Under way: the glyph turns; the home's steps, the workers' count. */
export const UnderWay: Story = {
  args: {
    open: true,
    rows: [
      ALTHAR,
      {
        ...HOME,
        tone: 'running',
        title: 'Updating runner-1',
        line: 'Restarting runner-1',
        end: { kind: 'steps', steps: ['Getting the new release', 'Restarting runner-1', 'Reconnecting'], at: 1 },
        hides: false,
      },
      {
        ...WORKERS,
        tone: 'running',
        title: 'Updating 11 workers',
        line: '3 on 0.3.0 · 3 after their tasks',
        end: { kind: 'count', done: 3, of: 11 },
        hides: false,
      },
    ],
  },
}

/** Tasks run here: Althar installs as it quits, with no Restart; a worker at work updates after its task. */
export const TasksRunningHere: Story = {
  args: {
    open: true,
    rows: [
      { ...ALTHAR, tone: 'quiet', line: 'Installs when you quit, as tasks are running here.', end: undefined },
      {
        ...WORKERS,
        tone: 'quiet',
        title: 'hermes-box updates after its task',
        line: 'Once Repair token refresh is done, before its next task.',
        who: 'hermes-box',
        end: { kind: 'cancel', onPress: fn() },
      },
    ],
  },
}

/** What stopped leads, in the danger colour, each with Try again; the glyph is the problem mark. */
export const Failed: Story = {
  args: {
    open: true,
    rows: [
      {
        ...ALTHAR,
        tone: 'failed',
        title: 'Couldn’t restart into Althar 0.10.1',
        line: 'It couldn’t replace the app where it’s installed. It installs when you quit.',
        end: { kind: 'press', label: 'Try again', onPress: fn() },
      },
      {
        ...WORKERS,
        tone: 'failed',
        title: 'Couldn’t update hermes-box',
        line: '0.3.0 didn’t start there, so it went back to 0.2.2 and takes tasks as before.',
        who: 'hermes-box',
        end: { kind: 'press', label: 'Try again', onPress: fn() },
      },
    ],
  },
}

/** A home's restart stops its tasks: asked in its row first. */
export const AsksFirst: Story = {
  args: {
    open: true,
    rows: [
      {
        ...HOME,
        tone: 'asking',
        title: 'Stop 2 running tasks?',
        line: 'runner-1 restarts to update, and its running tasks stop with it.',
        end: { kind: 'ask', label: 'Update anyway', onPress: fn(), onCancel: fn() },
        hides: false,
      },
    ],
  },
}

/** Each put aside on its own; with none left, the glyph goes, and says where they still are. */
export const PutAside: Story = {
  args: { rows: [WORKERS], open: true },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    await userEvent.click(await page.findByRole('button', { name: 'Hide until its next release' }))
    await expect(await page.findByRole('button', { name: 'Still in Settings › Computers' })).toBeVisible()
  },
}

/** The glyph, closed, by what's most urgent under it. */
export const Glyphs: Story = {
  render: () => (
    <States
      cells={[
        { state: 'can update', node: <Updates rows={[ALTHAR]} /> },
        { state: 'under way', node: <Updates rows={[{ ...WORKERS, tone: 'running' }]} /> },
        { state: 'failed', node: <Updates rows={[{ ...WORKERS, tone: 'failed' }]} /> },
        { state: 'done', node: <Updates rows={[{ ...WORKERS, tone: 'done' }]} /> },
      ]}
    />
  ),
}
