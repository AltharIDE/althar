import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { threadDecorator } from '../../storybook/ThreadFrame'
import { Delta } from '../../primitives/FileChanges/FileChanges'
import { Markdown } from '../Markdown/Markdown'
import { Reasoning } from '../Reasoning/Reasoning'
import { Tool, ToolGroup } from '../Tool/Tool'
import { Prose, Turn } from '../Turn/Turn'
import { Step } from '../Step/Step'
import { OPUS } from '../../fixtures/models'
import { WorkedFor, WorkNow } from './WorkedFor'
import { routerFile } from '../../fixtures/meridian'
import { useThreadShell } from '../Shell/Shell'
import { StepState, ToolKind } from '../../foundations/vocabulary'
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

const SAID = 'I’ll find where refunds skip the partner limit, and wrap them the way charges are.'

const work = (
  <>
    <Markdown source={SAID} />
    <Reasoning
      source="Charges wrap the handler in withPartnerLimit. Refunds were added later behind their own router and never picked it up."
      took="6s"
    />
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
  args: { took: '12m 40s', children: work },
} satisfies Meta<typeof WorkedFor>
export default meta
type Story = StoryObj<typeof meta>

/** Done: the turn's work is its header alone, how long it worked; its answer stands under it. */
export const Folded: Story = {}

/** A long queue wait stays in the details; the headline is the work itself. */
export const AfterLongWait: Story = {
  args: {
    took: '20s',
    most: undefined,
    spent: ['50h 0m waiting for a place', '1m 0s starting', '20s thinking and writing'],
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('button', { name: 'Worked for 20s' })).toBeInTheDocument()
    await expect(c.queryByText(/50h/)).toBeNull()
  },
}

/** Opening it shows the whole trail: what it said on the way, its thoughts, its tools. */
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

/** Just started: how long so far, and that it is thinking. */
export const Thinking: Story = {
  args: { live: true, took: '4s', now: <WorkNow>Thinking</WorkNow> },
}

/**
 * At work: what it has said on the way, in its own words, and one line for
 * what it is doing now, replaced in place as it moves on.
 */
export const Working: Story = {
  args: {
    live: true,
    took: '1m 12s',
    said: <Markdown source={SAID} />,
    now: <WorkNow icon="file">Reading src/refunds/router.ts</WorkNow>,
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const row = c.getByRole('button', { name: /Working for 1m 12s/ })
    await expect(row).toHaveAttribute('aria-busy', 'true')
    await expect(c.getByText('Reading src/refunds/router.ts')).toBeVisible()
    await expect(c.getByText(SAID)).toBeVisible()
  },
}

/** At work, its step a long command: the line ends in an ellipsis, the whole of it on hover. */
export const WorkingOnALongStep: Story = {
  args: {
    live: true,
    took: '3m 2s',
    said: <Markdown source={SAID} />,
    now: (
      <WorkNow icon="terminal">
        Running bunx vitest run tests/refunds/router.test.ts tests/charges/limit.test.ts tests/partners/bucket.test.ts --maxWorkers=1
      </WorkNow>
    ),
  },
}

/** A turn, then its answer: the work folded under how long it took, the answer under it. */
export const OverItsAnswer: Story = {
  render: (args) => (
    <Turn model={OPUS} at="4m ago">
      <WorkedFor {...args} took="19s" />
      <Prose>Refunds now go through the partner limit, as charges do: they share the partner’s bucket, so the budget stays one.</Prose>
    </Turn>
  ),
}

/**
 * A lead that carries on after a step's result, woken by a command it left
 * running, is a turn of its own: it folds its work under its own time, and
 * what it said last shows whole. The turn is as `blocksOf` makes it from that
 * run of items (see the desktop's thread tests).
 */
export const SelfStarted: Story = {
  render: (args) => (
    <>
      <WorkedFor {...args} took="9m 12s" />
      <Step n={3} of={4} label="Publish" model={OPUS} state={StepState.Done} outcome="Pull request opened" took="9m" />
      <WorkedFor {...args} took="3m 40s" />
      <Turn model={OPUS} at="4m ago" bare>
        <Prose>
          The log isn’t where I expected; it was under the build output, which shows whether branch coverage clears 90%. It does: the verify
          finished at 92% and the pull request is ready.
        </Prose>
      </Turn>
    </>
  ),
}

/**
 * A turn that spent most of its time on something other than its work names
 * that part after how long it took, and opening it says where all of it went,
 * before its steps (a task is a conversation plus parts).
 */
export const WhereItsTimeWent: Story = {
  args: {
    took: '4m',
    most: '3m 10s waiting for a place',
    spent: ['3m 10s waiting for a place', '8s starting', '30s thinking and writing', '12s running tools'],
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const row = c.getByRole('button', { name: /Worked for 4m\s*· 3m 10s waiting for a place/ })
    await userEvent.click(row)
    await waitFor(() => expect(c.getByText(/8s starting · 30s thinking and writing/)).toBeVisible())
  },
}

/** Where its time went with nothing else to open: the line opens to that alone. */
export const OnlyWhereItsTimeWent: Story = {
  args: { took: '1m 2s', children: undefined, spent: ['50s thinking and writing', '12s running tools'] },
}

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
        {
          state: 'its time elsewhere',
          node: (
            <WorkedFor
              {...args}
              took="4m"
              most="3m 10s waiting for a place"
              spent={['3m 10s waiting for a place', '50s thinking and writing']}
            />
          ),
        },
        { state: 'thinking', node: <WorkedFor {...args} live took="4s" now={<WorkNow>Thinking</WorkNow>} /> },
        {
          state: 'working',
          node: (
            <WorkedFor
              {...args}
              live
              took="1m 12s"
              said={<Markdown source={SAID} />}
              now={<WorkNow icon="file">Reading src/refunds/router.ts</WorkNow>}
            />
          ),
        },
        {
          state: 'working, hover',
          force: 'hover',
          node: <WorkedFor {...args} live took="1m 12s" now={<WorkNow icon="search">Searching POLL_EVERY</WorkNow>} />,
        },
        { state: 'working, writing', node: <WorkedFor {...args} live took="1m 30s" said={<Markdown source={SAID} />} /> },
        { state: 'working, opened', node: <WorkedFor {...args} live took="1m 12s" defaultOpen now={<WorkNow>Thinking</WorkNow>} /> },
      ]}
    />
  ),
}
