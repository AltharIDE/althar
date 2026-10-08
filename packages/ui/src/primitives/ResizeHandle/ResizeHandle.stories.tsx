import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { States, statesOn } from '../../storybook/States'
import { ResizeHandle } from './ResizeHandle'

/** A column with the handle on its end, beside the rest. */
function Columns({ start = 320, onReset }: { start?: number; onReset?: () => void }) {
  const [width, setWidth] = useState(start)
  return (
    <div style={{ display: 'flex', height: 160, border: '1px solid var(--line)', background: 'var(--n-2)' }}>
      <div style={{ position: 'relative', width, flex: 'none', background: 'var(--n-1)', borderRight: '1px solid var(--line)' }}>
        <p style={{ margin: 16, fontSize: 12, color: 'var(--t-3)' }}>{width}px</p>
        <ResizeHandle
          value={width}
          min={240}
          max={480}
          onChange={setWidth}
          onReset={onReset ?? (() => setWidth(start))}
          label="Width of the conversation"
        />
      </div>
      <div style={{ flex: 1 }} />
    </div>
  )
}

const meta = {
  title: 'Primitives/ResizeHandle',
  component: ResizeHandle,
  args: { value: 320, min: 240, max: 480, onChange: fn(), label: 'Width of the conversation' },
  render: () => <Columns />,
} satisfies Meta<typeof ResizeHandle>
export default meta
type Story = StoryObj<typeof meta>

export const BetweenTwoColumns: Story = {}

/** The keyboard moves it a step at a time, and Home and End to the ends. */
export const ByKeyboard: Story = {
  play: async ({ canvasElement }) => {
    const handle = within(canvasElement).getByRole('separator', { name: 'Width of the conversation' })
    handle.focus()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    await expect(handle).toHaveAttribute('aria-valuenow', '352')
    await userEvent.keyboard('{End}')
    await expect(handle).toHaveAttribute('aria-valuenow', '480')
    await userEvent.keyboard('{Home}')
    await expect(handle).toHaveAttribute('aria-valuenow', '240')
  },
}

/** Where a move ended is said once, not at every step of it. */
export const CommittingOnce: Story = {
  render: function Render() {
    const [width, setWidth] = useState(320)
    const [kept, setKept] = useState<number[]>([])
    return (
      <div style={{ position: 'relative', width, height: 120, background: 'var(--n-1)' }}>
        <p data-testid="kept" style={{ margin: 16, fontSize: 12 }}>
          {kept.join(' ')}
        </p>
        <ResizeHandle
          value={width}
          min={240}
          max={480}
          onChange={setWidth}
          onCommit={(at) => setKept((all) => [...all, at])}
          label="Width of the conversation"
        />
      </div>
    )
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    c.getByRole('separator').focus()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    await expect(c.getByTestId('kept')).toHaveTextContent('336 352')
  },
}

/** A double click puts it back. */
export const Reset: Story = {
  render: () => <Columns start={400} />,
  play: async ({ canvasElement }) => {
    const handle = within(canvasElement).getByRole('separator')
    handle.focus()
    await userEvent.keyboard('{Home}')
    await userEvent.dblClick(handle)
    await expect(handle).toHaveAttribute('aria-valuenow', '400')
  },
}

export const AllStates: Story = {
  parameters: statesOn({ hover: '[role="separator"]', focus: '[role="separator"]', pressed: '[role="separator"]' }),
  render: () => (
    <States
      size="wide"
      cells={[
        { state: 'rest', node: <Columns /> },
        { state: 'hover', node: <Columns /> },
        { state: 'focus', node: <Columns /> },
        { state: 'pressed', node: <Columns /> },
      ]}
    />
  ),
}
