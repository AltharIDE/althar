import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { threadDecorator } from '../../storybook/ThreadFrame'
import { Delta } from '../../primitives/FileChanges/FileChanges'
import { Tool, ToolGroup } from '../Tool/Tool'
import { WorkedFor } from './WorkedFor'
import { routerFile } from '../../fixtures/meridian'
import { useThreadShell } from '../Shell/Shell'
import { ToolKind } from '../../foundations/vocabulary'
import { States, statesParameters } from '../../storybook/States'

/* The edit's path opens the file beside the thread. */
function EditedRouter() {
  const { openDoc } = useThreadShell()
  return (
    <Tool
      kind={ToolKind.Edit}
      verb="Edited"
      target="src/refunds/router.ts"
      meta={<Delta add={14} del={3} />}
      onOpenTarget={openDoc && (() => openDoc(routerFile))}
    />
  )
}

const work = (
  <>
    <ToolGroup summary="Explored 3 files" took="8s">
      <Tool kind={ToolKind.Read} verb="Read" target="src/charges/limit.ts" meta="88 lines" />
    </ToolGroup>
    <EditedRouter />
    <Tool kind={ToolKind.Run} verb="Ran" target="pnpm test refunds" meta="38 passed" took="12s" />
  </>
)

const meta = {
  title: 'Thread/WorkedFor',
  component: WorkedFor,
  decorators: [threadDecorator],
  args: { took: '12m 40s', summary: '3 files edited · 4 commands · 1 search', children: work },
} satisfies Meta<typeof WorkedFor>
export default meta
type Story = StoryObj<typeof meta>

export const Folded: Story = {}

/** Opening it shows what the turn did. */
export const Opening: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const row = c.getByRole('button', { name: /Worked for/ })
    await expect(c.queryByRole('button', { name: /Explored/ })).toBeNull()
    await userEvent.click(row)
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    /* it eases in: wait for the transition to finish */
    await waitFor(() => expect(c.getByRole('button', { name: /Explored/ })).toBeVisible())
  },
}
export const Open: Story = { args: { defaultOpen: true } }

/** While the turn runs, its work folds under how long it has worked so far, and what it is doing now. */
export const Working: Story = {
  args: { live: true, took: '1m 12s', summary: 'Reading src/refunds/router.ts' },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const row = c.getByRole('button', { name: /Working for 1m 12s/ })
    await expect(row).toHaveAttribute('aria-busy', 'true')
    await expect(c.getByText('Reading src/refunds/router.ts')).toBeInTheDocument()
  },
}
export const WithoutSummary: Story = { args: { summary: undefined } }

export const AllStates: Story = {
  parameters: statesParameters,
  render: (args) => (
    <States
      size="thread"
      cells={[
        ...(['folded', 'hover', 'focus', 'pressed'] as const).map((state) => ({
          state,
          force: state === 'folded' ? undefined : state,
          node: <WorkedFor {...args} />,
        })),
        { state: 'open', node: <WorkedFor {...args} defaultOpen /> },
        { state: 'no summary', node: <WorkedFor {...args} summary={undefined} /> },
        { state: 'working', node: <WorkedFor {...args} live took="1m 12s" summary="Reading src/refunds/router.ts" /> },
      ]}
    />
  ),
}
