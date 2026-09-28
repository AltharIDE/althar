import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { LINT_OUTPUT, ROUTER_DIFF, TEST_EARLIER, TEST_OUTPUT } from '../../fixtures/meridian'
import { ThreadFrame, threadDecorator } from '../../storybook/ThreadFrame'
import { ToolKind, ToolState } from '../../foundations/vocabulary'
import { Diff } from '../Diff/Diff'
import { Terminal } from '../Terminal/Terminal'
import { Delta } from '../../primitives/FileChanges/FileChanges'
import { Tool, ToolGroup } from './Tool'
import { States, statesParameters } from '../../storybook/States'

const meta = {
  title: 'Thread/Tool',
  component: Tool,
  decorators: [threadDecorator],
  args: { kind: ToolKind.Read, verb: 'Read', target: 'src/charges/limit.ts', meta: '88 lines' },
} satisfies Meta<typeof Tool>
export default meta
type Story = StoryObj<typeof meta>

/** A call with nothing to open. */
export const Quiet: Story = {}
export const Running: Story = {
  args: { kind: ToolKind.Create, verb: 'Writing', target: 'docs/api/refunds-rate-limits.md', state: ToolState.Running, meta: 'now' },
}

export const Edit: Story = {
  args: {
    kind: ToolKind.Edit,
    verb: 'Edited',
    target: 'src/refunds/router.ts',
    sheet: true,
    meta: <Delta add={14} del={3} />,
    defaultOpen: true,
    children: <Diff lines={ROUTER_DIFF} />,
  },
}

/** The path is a link to the file; the rest of the row opens the diff. */
export const EditThatOpensTheFile: Story = {
  args: { ...Edit.args, defaultOpen: false, onOpenTarget: fn() },
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Open src/refunds/router.ts' }))
    await expect(args.onOpenTarget).toHaveBeenCalledOnce()
    await expect(c.getByRole('button', { name: /Edited src\/refunds\/router.ts/ })).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(c.getByRole('button', { name: /Edited src\/refunds\/router.ts/ }))
    await expect(c.getByRole('button', { name: /Edited src\/refunds\/router.ts/ })).toHaveAttribute('aria-expanded', 'true')
  },
}

export const Command: Story = {
  args: {
    kind: ToolKind.Run,
    verb: 'Ran',
    target: 'pnpm test refunds',
    meta: '38 passed',
    took: '12s',
    copy: 'pnpm test refunds',
    defaultOpen: true,
    children: <Terminal exit={0} lines={TEST_OUTPUT} earlier={TEST_EARLIER} />,
  },
}

export const CommandFolded: Story = {
  args: { ...Command.args, defaultOpen: false },
}

/** Opened, a command becomes a sheet, with Copy in its header. */
export const OpeningACommand: Story = {
  args: { ...Command.args, defaultOpen: false },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const row = c.getByRole('button', { name: /Ran pnpm test refunds/ })
    await userEvent.click(row)
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    /* it eases in: wait for the transition to finish */
    await waitFor(() => expect(c.getByRole('button', { name: 'Copy command' })).toBeVisible())
  },
}

export const Failed: Story = {
  args: {
    kind: ToolKind.Run,
    verb: 'Ran',
    target: 'pnpm lint',
    state: ToolState.Failed,
    exit: 1,
    meta: '2 problems',
    took: '4s',
    copy: 'pnpm lint',
    defaultOpen: true,
    children: <Terminal exit={1} lines={LINT_OUTPUT} />,
  },
}

/** You said no to it: it never ran. Set back, and not red. */
export const Declined: Story = {
  args: { kind: ToolKind.Run, verb: 'Run', target: 'psql $STAGING_URL -f backfill.sql', state: ToolState.Declined, meta: undefined },
}

/** Stopped with the turn, part way through. */
export const Cancelled: Story = {
  args: { kind: ToolKind.Run, verb: 'Ran', target: 'pnpm test', state: ToolState.Cancelled, took: '38s', meta: undefined },
}

export const Live: Story = {
  args: {
    kind: ToolKind.Run,
    verb: 'Running',
    target: 'pnpm test',
    state: ToolState.Running,
    meta: '1m 12s',
    copy: 'pnpm test',
    defaultOpen: true,
    children: <Terminal lines={[' ✓ charges/limit (14)', ' ✓ refunds/router (38)']} live=" ⋯ webhooks/deliver (running 22 of 41)" />,
  },
}

/** The dark finish for commands, when the host sets it. */
export const DarkTerminal: Story = {
  args: Command.args,
  decorators: [
    (Story) => (
      <ThreadFrame term="dark">
        <Story />
      </ThreadFrame>
    ),
  ],
}

export const Group: Story = {
  render: () => (
    <ToolGroup summary="Explored 4 files and ran 2 searches" took="22s" defaultOpen>
      <Tool kind={ToolKind.Search} verb="Searched" target="withPartnerLimit  src/" meta="6 results" />
      <Tool kind={ToolKind.Search} verb="Searched" target="Retry-After  src/" meta="3 results" />
      <Tool kind={ToolKind.Read} verb="Read" target="src/charges/limit.ts" meta="88 lines" />
      <Tool kind={ToolKind.Read} verb="Read" target="src/refunds/router.ts" meta="142 lines" />
      <Tool kind={ToolKind.List} verb="Listed" target="src/refunds/" meta="9 files" />
    </ToolGroup>
  ),
}

/** Every kind of call, by its glyph. */
export const Kinds: Story = {
  render: () => (
    <>
      <Tool kind={ToolKind.Read} verb="Read" target="src/charges/limit.ts" meta="88 lines" />
      <Tool kind={ToolKind.List} verb="Listed" target="src/refunds/" meta="9 files" />
      <Tool kind={ToolKind.Search} verb="Searched" target="withPartnerLimit" meta="6 results" />
      <Tool kind={ToolKind.Edit} verb="Edited" target="src/refunds/router.ts" meta={<Delta add={14} del={3} />} />
      <Tool kind={ToolKind.Create} verb="Created" target="src/refunds/limit.test.ts" meta={<Delta add={61} />} />
      <Tool kind={ToolKind.Delete} verb="Deleted" target="src/refunds/legacy-limit.ts" meta={<Delta del={48} />} />
      <Tool kind={ToolKind.Move} verb="Moved" target="src/limits/ → src/refunds/limits/" />
      <Tool kind={ToolKind.Run} verb="Ran" target="pnpm lint" meta="clean" took="4s" />
      <Tool kind={ToolKind.Think} verb="Planned" target="how refunds share the limiter" />
      <Tool kind={ToolKind.Fetch} verb="Fetched" target="https://www.rfc-editor.org/rfc/rfc9110" />
      <Tool kind={ToolKind.Mcp} verb="Called" target="linear.get_issue" />
      <Tool kind={ToolKind.Agent} verb="Started" target="2 sub-agents" />
      <Tool kind={ToolKind.PullRequest} verb="Opened" target="PR 1206" />
      <Tool kind={ToolKind.Comment} verb="Replied on" target="PR 1206" meta="to dana" />
      <Tool kind={ToolKind.Push} verb="Pushed" target="ch/431-refund-limits" />
      <Tool kind={ToolKind.Other} verb="Used" target="format_sql" />
    </>
  ),
}

export const AllStates: Story = {
  parameters: statesParameters,
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'quiet', node: <Tool kind={ToolKind.Read} verb="Read" target="src/charges/limit.ts" meta="88 lines" /> },
        {
          state: 'running',
          node: <Tool kind={ToolKind.Create} verb="Writing" target="docs/api/refunds.md" state={ToolState.Running} meta="now" />,
        },
        { state: 'command, folded', node: <Tool {...args} {...Command.args} defaultOpen={false} /> },
        { state: 'hover', node: <Tool {...args} {...Command.args} defaultOpen={false} /> },
        { state: 'focus', node: <Tool {...args} {...Command.args} defaultOpen={false} /> },
        { state: 'pressed', node: <Tool {...args} {...Command.args} defaultOpen={false} /> },
        { state: 'command, open', node: <Tool {...args} {...Command.args} /> },
        { state: 'edit, open', node: <Tool {...args} {...Edit.args} /> },
        { state: 'failed', node: <Tool {...args} {...Failed.args} /> },
        { state: 'declined', node: <Tool {...args} {...Declined.args} /> },
        { state: 'cancelled', node: <Tool {...args} {...Cancelled.args} /> },
        { state: 'live', node: <Tool {...args} {...Live.args} /> },
        {
          state: 'group, folded',
          node: (
            <ToolGroup summary="Read 3 files" took="2s">
              <Tool kind={ToolKind.Read} verb="Read" target="src/charges/limit.ts" />
            </ToolGroup>
          ),
        },
      ]}
    />
  ),
}
