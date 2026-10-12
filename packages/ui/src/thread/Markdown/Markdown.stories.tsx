import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { refDoc } from '../../fixtures/meridian'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { Markdown } from './Markdown'
import { States } from '../../storybook/States'

const meta = { title: 'Thread/Markdown', component: Markdown, decorators: [threadDecorator], args: { source: refDoc.body } } satisfies Meta<
  typeof Markdown
>
export default meta

const RICH = `- [x] Wrap the refund route
- [ ] Update the API reference

| Route | Limit |
| :-- | --: |
| charges | 600/min |
| refunds | shared |

See [the spec](https://docs.example.com/rate-limits) and ~~the old note~~.`

/* Tables as agents write them in a message. */
const LIMITS = `Limits as they now apply:

| Endpoint | Budget | Window | Over the limit |
| :-- | --: | :-: | :-- |
| \`POST /charges\` | 600 | 1 min | 429 · Retry-After |
| \`POST /refunds\` | shared | 1 min | 429 · Retry-After |
| \`GET /refunds/:id\` | none | — | — |`

/* Half written: the head and two rows so far, then the head alone, before its rule arrives. */
const STREAMING = LIMITS.split('\n').slice(0, 6).join('\n')
const HEAD_ONLY = LIMITS.split('\n').slice(0, 3).join('\n')

const SENTENCES = `| Finding | Where | What to do |
| --- | --- | --- |
${Array.from(
  { length: 14 },
  (_, i) =>
    `| Refund ${i + 1} skips the partner budget when the idempotency key repeats within the window | \`src/refunds/router.ts:${18 + i}\` | Check the key before the budget, and answer 409 rather than spending it twice |`,
).join('\n')}`

const NO_ROWS = `| Endpoint | Budget |
| --- | --- |`

const UNSAFE = `A [link that runs script](javascript:alert(1)) stays text. <b onclick="x">So does this</b>.`
type Story = StoryObj<typeof meta>

export const InTheThread: Story = {}
/** A size up, in the side panel. */
export const InThePanel: Story = { args: { size: 'panel' } }

/** A table in a message: the kit's, sitting each column as the markdown says. */
export const ATable: Story = {
  args: { source: LIMITS },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('columnheader', { name: 'Budget' })).toHaveStyle({ textAlign: 'right' })
    await expect(c.getByRole('cell', { name: 'shared' })).toBeInTheDocument()
    await expect(c.getByRole('region')).toHaveAttribute('tabindex', '0')
  },
}
/** While the message streams: the rows so far; before the head's rule arrives, the head is a line of text. */
export const TableWhileStreaming: Story = {
  render: () => (
    <>
      <Markdown source={STREAMING} />
      <Markdown source={HEAD_ONLY} />
    </>
  ),
}
/** Long, with sentences in its cells: they wrap, and the rest scrolls. */
export const LongTable: Story = { args: { source: SENTENCES } }
/** A head and no rows. */
export const EmptyTable: Story = { args: { source: NO_ROWS } }

export const AllStates: Story = {
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'thread', node: <Markdown {...args} /> },
        { state: 'panel', node: <Markdown {...args} size="panel" /> },
        { state: 'a preview: the first three blocks', node: <Markdown {...args} to={3} /> },
        { state: 'task list, table, link', node: <Markdown source={RICH} /> },
        { state: 'unsafe link and raw HTML, shown as text', node: <Markdown source={UNSAFE} /> },
        { state: 'a table', node: <Markdown source={LIMITS} /> },
        { state: 'a table, streaming', node: <Markdown source={STREAMING} /> },
        { state: 'a table, head before its rule', node: <Markdown source={HEAD_ONLY} /> },
        { state: 'a table, long sentences', node: <Markdown source={SENTENCES} /> },
        { state: 'a table, no rows', node: <Markdown source={NO_ROWS} /> },
        {
          state: 'one paragraph',
          node: <Markdown source="Refunds share the partner budget with charges; `429` carries `Retry-After`." />,
        },
      ]}
    />
  ),
}
