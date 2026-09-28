import type { Meta, StoryObj } from '@storybook/react-vite'

import { threadDecorator } from '../../storybook/ThreadFrame'
import { GPT_MINI, SONNET } from '../../fixtures/models'
import { ToolKind, ToolState } from '../../foundations/vocabulary'
import { Delta } from '../../primitives/FileChanges/FileChanges'
import { Tool } from '../Tool/Tool'
import { SubAgents } from './SubAgents'
import { States, statesOn } from '../../storybook/States'

const meta = {
  title: 'Thread/SubAgents',
  component: SubAgents,
  decorators: [threadDecorator],
  args: {
    list: [
      {
        id: 'edges',
        label: 'Edge cases: burst, reset, clock skew',
        model: SONNET,
        state: ToolState.Done,
        meta: '9 tests · 6m',
        calls: (
          <>
            <Tool kind={ToolKind.Read} verb="Read" target="src/charges/limit.test.ts" meta="210 lines" />
            <Tool kind={ToolKind.Edit} verb="Edited" target="src/refunds/limit.test.ts" meta={<Delta add={48} />} />
            <Tool kind={ToolKind.Run} verb="Ran" target="pnpm test refunds/limit" meta="9 passed" took="6s" />
          </>
        ),
      },
      {
        id: 'docs',
        label: 'API reference for 429 on refunds',
        model: GPT_MINI,
        state: ToolState.Running,
        meta: 'writing · 3m',
        calls: (
          <>
            <Tool kind={ToolKind.Read} verb="Read" target="docs/api/charges-rate-limits.md" meta="58 lines" />
            <Tool kind={ToolKind.Create} verb="Writing" target="docs/api/refunds-rate-limits.md" state={ToolState.Running} meta="now" />
          </>
        ),
      },
    ],
  },
} satisfies Meta<typeof SubAgents>
export default meta
type Story = StoryObj<typeof meta>

export const TwoAgents: Story = {}

export const AllStates: Story = {
  parameters: statesOn({ hover: 'li:first-child button', focus: 'li:first-child button', pressed: 'li:first-child button' }),
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'both folded', node: <SubAgents {...args} /> },
        { state: 'one open', node: <SubAgents {...args} defaultOpen={args.list[0]?.id ?? null} /> },
        { state: 'failed', node: <SubAgents list={args.list.map((a) => ({ ...a, state: ToolState.Failed, meta: 'stopped · exit 1' }))} /> },
        { state: 'hover', node: <SubAgents {...args} /> },
        { state: 'focus', node: <SubAgents {...args} /> },
        { state: 'pressed', node: <SubAgents {...args} /> },
      ]}
    />
  ),
}
