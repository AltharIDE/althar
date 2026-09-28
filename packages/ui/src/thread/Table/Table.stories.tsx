import type { Meta, StoryObj } from '@storybook/react-vite'

import { threadDecorator } from '../../storybook/ThreadFrame'
import { Table } from './Table'
import { States, statesOn } from '../../storybook/States'

const meta = {
  title: 'Thread/Table',
  component: Table,
  decorators: [threadDecorator],
  args: {
    caption: 'Limits as they now apply',
    head: ['Endpoint', 'Budget', 'Window', 'Over the limit'],
    rows: [
      ['POST /charges', '600', '1 min', '429 · Retry-After'],
      ['POST /refunds', 'shared', '1 min', '429 · Retry-After'],
      ['GET /refunds/:id', 'none', '—', '—'],
    ],
  },
} satisfies Meta<typeof Table>
export default meta
type Story = StoryObj<typeof meta>

export const Limits: Story = {}
/** Wider than the column: it scrolls sideways. */
export const Wide: Story = {
  args: {
    head: ['Endpoint', 'Budget', 'Window', 'Over the limit', 'Header', 'Since', 'Partners affected yesterday'],
    rows: [['POST /refunds', 'shared', '1 min', '429', 'Retry-After (seconds)', '2.14', '3 of 212']],
  },
}

export const AllStates: Story = {
  parameters: statesOn({ hover: '[role="region"]', focus: '[role="region"]', pressed: '[role="region"]' }),
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'with caption', node: <Table {...args} /> },
        { state: 'no caption', node: <Table {...args} caption={undefined} /> },
        { state: 'one row', node: <Table {...args} rows={args.rows.slice(0, 1)} /> },
        { state: 'focus', node: <Table {...args} /> },
      ]}
    />
  ),
}
