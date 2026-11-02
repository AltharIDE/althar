import type { Meta, StoryObj } from '@storybook/react-vite'

import { DiffLineKind } from '../../foundations/vocabulary'
import { COMMENT_DIFF, CSS_DIFF, JSON_DIFF, LONG_DIFF, MARKDOWN_DIFF, TSX_DIFF } from '../../fixtures/diffs'
import { ROUTER_DIFF } from '../../fixtures/meridian'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { Diff } from './Diff'
import { States } from '../../storybook/States'

const meta = {
  title: 'Thread/Diff',
  component: Diff,
  decorators: [threadDecorator],
  args: { lines: ROUTER_DIFF, label: 'src/refunds/router.ts', path: 'src/refunds/router.ts' },
} satisfies Meta<typeof Diff>
export default meta
type Story = StoryObj<typeof meta>

export const Changes: Story = {}
/* Each in its file's colours, the changed words marked over them. */
export const TypeScriptReact: Story = {
  args: { lines: TSX_DIFF, label: 'src/refunds/RefundForm.tsx', path: 'src/refunds/RefundForm.tsx', fold: 3, oldNumbers: true },
}
export const Css: Story = {
  args: { lines: CSS_DIFF, label: 'src/refunds/RefundForm.module.css', path: 'src/refunds/RefundForm.module.css' },
}
export const Json: Story = { args: { lines: JSON_DIFF, label: 'package.json', path: 'package.json' } }
export const Markdown: Story = { args: { lines: MARKDOWN_DIFF, label: 'README.md', path: 'README.md' } }
/* A comment and a template string that span the change: the lines inside stay comment and string on both sides. */
export const CommentAcrossTheChange: Story = { args: { lines: COMMENT_DIFF, label: 'src/charges/limit.ts', path: 'src/charges/limit.ts' } }
/* A file whose name says no language: plain, as before. */
export const Plain: Story = { args: { lines: ROUTER_DIFF, label: 'NOTES', path: 'NOTES' } }
/* A long file's whole diff, folded as the Outputs show it: colouring it takes a while, a slice at a time, and the diff scrolls meanwhile. */
export const Long: Story = {
  args: { lines: LONG_DIFF, label: 'src/refunds/RefundForms.tsx', path: 'src/refunds/RefundForms.tsx', fold: 3, oldNumbers: true },
}
/* The same, plain, as before diffs were coloured: what Long is measured against. */
export const LongPlain: Story = { args: { ...Long.args, path: undefined } }
export const Dark: Story = {
  globals: { theme: 'dark' },
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'tsx', node: <Diff {...args} lines={TSX_DIFF} path="RefundForm.tsx" fold={3} oldNumbers /> },
        { state: 'css', node: <Diff {...args} lines={CSS_DIFF} path="RefundForm.module.css" /> },
        { state: 'comment across the change', node: <Diff {...args} lines={COMMENT_DIFF} path="limit.ts" /> },
      ]}
    />
  ),
}
export const OnlyAdded: Story = { args: { lines: ROUTER_DIFF.filter((l) => l.kind !== DiffLineKind.Removed) } }

export const AllStates: Story = {
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'changes', node: <Diff {...args} /> },
        { state: 'only added', node: <Diff {...args} lines={ROUTER_DIFF.filter((l) => l.kind !== DiffLineKind.Removed)} /> },
        { state: 'only removed', node: <Diff {...args} lines={ROUTER_DIFF.filter((l) => l.kind !== DiffLineKind.Added)} /> },
        { state: 'old numbers too', node: <Diff {...args} oldNumbers /> },
        { state: 'no label', node: <Diff lines={ROUTER_DIFF.slice(0, 4)} /> },
      ]}
    />
  ),
}
