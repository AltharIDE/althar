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

/** Each column sits as its values read best: numbers to the right. */
export const Aligned: Story = { args: { align: [null, 'right', 'center', 'left'] } }
/** Sentences in cells wrap, each column kept wide enough to read. */
export const Sentences: Story = {
  args: {
    caption: undefined,
    rowHeaders: false,
    wrap: true,
    head: ['Finding', 'What to do'],
    rows: [
      ['Refunds skip the partner budget when the idempotency key repeats', 'Check the key before the budget, and answer 409'],
      ['Retry-After is an HTTP date in the v1 handler', 'Leave v1 alone; refunds never go through it'],
    ],
  },
}
/** A head and no rows. */
export const Empty: Story = { args: { rows: [] } }
/** Many rows: it grows with them, and the thread scrolls. */
export const Long: Story = {
  args: {
    rows: Array.from({ length: 24 }, (_, i) => [
      `GET /refunds/${1000 + i}`,
      String(600 - i * 10),
      '1 min',
      i % 3 === 0 ? '429 · Retry-After' : '—',
    ]),
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
        { state: 'aligned', node: <Table {...args} align={[null, 'right', 'center', 'left']} /> },
        { state: 'no rows', node: <Table {...args} rows={[]} /> },
        {
          state: 'sentences wrap',
          node: (
            <Table
              head={['Finding', 'What to do']}
              rows={[
                ['Refunds skip the partner budget when the idempotency key repeats', 'Check the key before the budget, and answer 409'],
              ]}
              rowHeaders={false}
              wrap
            />
          ),
        },
        { state: 'focus', node: <Table {...args} /> },
      ]}
    />
  ),
}
