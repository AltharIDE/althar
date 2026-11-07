import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'

import { threadDecorator } from '../../storybook/ThreadFrame'
import { ToolKind, ToolState } from '../../foundations/vocabulary'
import { Prose } from '../Turn/Turn'
import { Terminal } from '../Terminal/Terminal'
import { Tool } from './Tool'

/*
 * A lead's shell commands as a thread shows them, case by case: a short
 * success, a long output, very long lines, a failure, one still running and
 * one that printed colour codes. Each opens as the person would.
 */

const meta = {
  title: 'Thread/Commands',
  decorators: [threadDecorator],
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const SEARCH = `ls docs/plans docs/research; grep -rli "orca\\|t3 code\\|t3code\\|t3\\.chat" docs | head; ls docs/decisions | wc -l`

const FOUND = [
  'agent-restrictions.md',
  'automations.md',
  'plan-usage.md',
  'safety-pass.md',
  'task-as-container.md',
  'background-helpers.md',
  'claude-code-sandbox.md',
  'codex-sandbox.md',
  'dev-193-startup.md',
  'orca-notes.md',
  'pricing.md',
  'scratch-shelf.md',
  't3-code.md',
  'voice-input.md',
  'dev-193-startup.md',
  'docs/open-questions.md',
  'docs/research/background-helpers.md',
  'docs/plans/automations.md',
  'docs/plans/plan-usage.md',
  'docs/decisions/056-a-finished-task-s-folder-goes-after-a-wait-and-comes-back-when-needed.md',
  'docs/decisions/050-an-agent-joins-where-althar-can-hold-it-to-asking.md',
  'docs/decisions/062-a-usage-read-may-use-an-account-s-own-sign-in-once.md',
  'docs/decisions/061-automations-start-ordinary-tasks-on-a-schedule.md',
  'docs/decisions/087-a-lead-starts-helpers-on-any-agent-in-copies-of-their-own.md',
  'docs/architecture/03-agent-runtime-and-auth.md',
  '      95',
]
const TAIL = 8
const lines = FOUND.slice(-TAIL)
const earlier = FOUND.slice(0, -TAIL)

const before = <Prose>There are already two plans, and Orca comes up in several docs. Reading those first:</Prose>

/** A short command that worked: one row, its output a click away. */
export const ShortSuccess: Story = {
  render: () => (
    <>
      {before}
      <Tool kind={ToolKind.Run} verb="Ran" target="git status --short" copy="git status --short" defaultOpen>
        <Terminal lines={[' M packages/ui/src/thread/Tool/Tool.tsx', '?? packages/ui/src/thread/Tool/Commands.stories.tsx']} exit={0} />
      </Tool>
      <Tool kind={ToolKind.Run} verb="Ran" target="git add -A" copy="git add -A">
        <Terminal lines={[]} exit={0} />
      </Tool>
    </>
  ),
}

/** The person's own example: a long command, a long output, a count with tool padding before it. */
export const LongOutput: Story = {
  render: () => (
    <>
      {before}
      <Tool kind={ToolKind.Run} verb="Ran" target={SEARCH} copy={SEARCH} defaultOpen>
        <Terminal lines={lines} earlier={earlier} exit={0} printedBy={SEARCH} />
      </Tool>
    </>
  ),
}

/** Opening what came before the tail. */
export const LongOutputExpanded: Story = {
  ...LongOutput,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: /earlier lines/ }))
    await expect(c.getByText('scratch-shelf.md')).toBeInTheDocument()
  },
}

const WIDE = [
  'src/thread/Terminal/Terminal.tsx:84:  const line = (raw: string, key: string) => { const l = plainTerminalLine(raw); return <Line key={key} className={isError(l) ? s.err : undefined}>{l}</Line> }',
  'src/thread/Tool/Tool.tsx:131:  /* the row’s look follows it open, so the state is held here and handed to the Disclosure, which folds the output under it */',
  'docs/decisions/087-a-lead-starts-helpers-on-any-agent-in-copies-of-their-own-and-hands-their-findings-back-as-one-message.md:12:Helpers run in copies.',
]

/** Lines longer than the column: each wraps under itself, not like prose. */
export const VeryLongLines: Story = {
  render: () => (
    <Tool kind={ToolKind.Run} verb="Ran" target="rg -n 'Line key' src docs" copy="rg -n 'Line key' src docs" defaultOpen>
      <Terminal lines={WIDE} exit={0} />
    </Tool>
  ),
}

const LINT = [
  'src/refunds/router.ts',
  '  42:7  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any',
  '  88:3  warning  Unused variable “attempt”  no-unused-vars',
  '',
  '✖ 2 problems (1 error, 1 warning)',
]

/** A failure: the row says so, folded or open. */
export const Failure: Story = {
  render: () => (
    <>
      <Tool
        kind={ToolKind.Run}
        verb="Ran"
        target="wc -l docs/plans/task-as-container.md docs/plans/safety-pass.md; sed -n 1,40p docs/plans/safety-pass.md"
        copy="wc -l docs/plans/task-as-container.md docs/plans/safety-pass.md; sed -n 1,40p docs/plans/safety-pass.md"
        state={ToolState.Failed}
        exit={1}
      >
        <Terminal lines={['wc: docs/plans/safety-pass.md: No such file or directory']} exit={1} />
      </Tool>
      <Tool kind={ToolKind.Run} verb="Ran" target="pnpm lint" copy="pnpm lint" state={ToolState.Failed} exit={1} defaultOpen>
        <Terminal lines={LINT} exit={1} />
      </Tool>
    </>
  ),
}

/** Still running: the line being written ends in the cursor. */
export const Running: Story = {
  render: () => (
    <>
      <Tool kind={ToolKind.Run} verb="Ran" target="pnpm build" copy="pnpm build">
        <Terminal lines={['built in 4.2s']} exit={0} />
      </Tool>
      <Tool kind={ToolKind.Run} verb="Running" target="pnpm test refunds" copy="pnpm test refunds" state={ToolState.Running} defaultOpen>
        <Terminal lines={[' ✓ charges/limit (14)', ' ✓ refunds/router (38)']} live=" ⋯ webhooks/deliver (running 22 of 41)" />
      </Tool>
      <Tool kind={ToolKind.Run} verb="Ran" target="pnpm lint" copy="pnpm lint" state={ToolState.Failed} exit={1}>
        <Terminal lines={LINT} exit={1} />
      </Tool>
    </>
  ),
}

const ESC = '\u001b'
const COLOURED = [
  `${ESC}[1m${ESC}[32m ✓${ESC}[39m${ESC}[22m charges/limit ${ESC}[2m(14 tests)${ESC}[22m`,
  `${ESC}[1m${ESC}[32m ✓${ESC}[39m${ESC}[22m refunds/router ${ESC}[2m(38 tests)${ESC}[22m`,
  `${ESC}[1m${ESC}[31m ✗${ESC}[39m${ESC}[22m webhooks/deliver ${ESC}[2m(1 failed)${ESC}[22m`,
  `${ESC}]8;;https://vitest.dev${ESC}\\Vitest${ESC}]8;;${ESC}\\ ${ESC}[2m3.2.1${ESC}[22m`,
  `${ESC}[31mError: expected 429, got 200${ESC}[39m`,
]

/** Output written for a terminal: its colour and link codes don't show as noise. */
export const Ansi: Story = {
  render: () => (
    <Tool kind={ToolKind.Run} verb="Ran" target="pnpm vitest run" copy="pnpm vitest run" state={ToolState.Failed} exit={1} defaultOpen>
      <Terminal lines={COLOURED} exit={1} />
    </Tool>
  ),
  play: async ({ canvasElement }) => {
    await expect(canvasElement.textContent).not.toContain(ESC)
  },
}
