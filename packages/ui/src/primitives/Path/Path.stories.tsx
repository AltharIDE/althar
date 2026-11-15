import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { States } from '../../storybook/States'
import { Path } from './Path'

const meta = {
  title: 'Primitives/Path',
  component: Path,
  args: { path: 'packages/runtime/tests/coordinatorTools.test.ts' },
  decorators: [(Story) => <div style={{ font: '12px/1.3 var(--mono)' }}>{Story()}</div>],
} satisfies Meta<typeof Path>
export default meta
type Story = StoryObj<typeof meta>

const WIDTHS = [380, 300, 240, 180, 120]

/** Narrower rooms take whole folders off the start, never part of a name. */
export const Shortening: Story = {
  render: (args) => (
    <States
      size="wide"
      cells={WIDTHS.map((width) => ({
        state: `${width}px`,
        node: (
          <div style={{ width, boxShadow: 'inset 0 -1px 0 var(--line)' }}>
            <Path {...args} />
          </div>
        ),
      }))}
    />
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const shown = c.getAllByTitle('packages/runtime/tests/coordinatorTools.test.ts').map((one) => one.lastElementChild as HTMLElement)
    for (const one of shown) {
      await expect(one).toHaveTextContent(/^(…\/)?(packages\/)?(runtime\/)?(tests\/)?coordinatorTools\.test\.ts$/)
      await expect(one.scrollWidth).toBeLessThanOrEqual(one.clientWidth)
    }
  },
}

/** A folder, with its slash or not: the last folder stays. */
export const AFolder: Story = {
  args: { path: 'packages/runtime/src/' },
  render: (args) => (
    <div style={{ width: 120 }}>
      <Path {...args} />
    </div>
  ),
}
