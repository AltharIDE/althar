import type { Meta, StoryObj } from '@storybook/react-vite'

import { refDoc, TEST_EARLIER, TEST_OUTPUT } from '../../fixtures/meridian'
import { CODEX, OPUS } from '../../fixtures/models'
import { SHOT_AFTER, SHOT_BEFORE } from '../../fixtures/shots'
import { ToolKind, ToolState } from '../../foundations/vocabulary'
import { States } from '../../storybook/States'
import { ThreadFrame } from '../../storybook/ThreadFrame'
import { FileArtifact } from '../FileArtifact/FileArtifact'
import { Markdown } from '../Markdown/Markdown'
import { Shots } from '../Shots/Shots'
import { Terminal } from '../Terminal/Terminal'
import { Tool } from '../Tool/Tool'
import { Prose, Turn } from '../Turn/Turn'
import { WorkedFor } from '../WorkedFor/WorkedFor'
import { You } from '../You/You'
import { ThreadMeasure, Thread } from './Thread'

const meta = {
  title: 'Thread/Thread',
  component: Thread,
  parameters: { layout: 'fullscreen' },
  args: { label: 'Task 431, with the lead', children: null },
} satisfies Meta<typeof Thread>
export default meta
type Story = StoryObj<typeof meta>

const turns = (
  <>
    <You at="2h ago">Refunds should rate-limit like charges do. Match the headers exactly.</You>
    <Turn model={OPUS} at="2h ago">
      <Prose>
        Charges apply the limit in the partner middleware; the refund router was added after and never wrapped. Wrapping it now.
      </Prose>
    </Turn>
  </>
)

/** A feed of turns, 30px apart, in the reading measure. */
export const Conversation: Story = {
  render: (args) => (
    <ThreadMeasure>
      <Thread {...args}>{turns}</Thread>
    </ThreadMeasure>
  ),
}

const LIMITS = `Refunds now share the partner budget with charges. Limits as they now apply:

| Endpoint | Budget | Window | Over the limit |
| :-- | --: | :-: | :-- |
| \`POST /charges\` | 600 | 1 min | 429 · Retry-After |
| \`POST /refunds\` | shared | 1 min | 429 · Retry-After |
| \`GET /refunds/:id\` | none | — | — |

How a partner sees a refused refund, before and after, and the reference I wrote for partners:`

/**
 * What an agent hands back, as the thread shows it: its work folded, the
 * command's output in the tool call, then what it said with a table, its
 * screenshots, which open in the lightbox, and the document it wrote, which
 * opens in the side panel. Its actions wait for hover: Copy.
 */
export const HandsBack: Story = {
  render: (args) => (
    <ThreadFrame>
      <Thread {...args}>
        <You at="1h ago">Make refunds rate-limit like charges, check the dashboard, and write the reference for partners.</You>
        <Turn model={OPUS} at="58m ago" copy={LIMITS} meta="2.4k tokens">
          <WorkedFor took="12m 40s" summary="1 file written · 2 commands" defaultOpen>
            <Tool kind={ToolKind.Edit} verb="Edited" target="src/refunds/router.ts" />
            <Tool kind={ToolKind.Run} verb="Ran" target="pnpm test refunds" copy="pnpm test refunds" took="12s" defaultOpen>
              <Terminal lines={TEST_OUTPUT} earlier={TEST_EARLIER} exit={0} />
            </Tool>
            <Tool kind={ToolKind.Create} verb="Created" target="docs/api/refunds-rate-limits.md" />
          </WorkedFor>
          <Markdown source={LIMITS} />
          <Shots items={[SHOT_BEFORE, SHOT_AFTER]} />
          <FileArtifact path="docs/api/refunds-rate-limits.md" kind="Markdown" size="2.1 KB" lines={64} body={refDoc.body} />
        </Turn>
      </Thread>
    </ThreadFrame>
  ),
}

/** Working now: the command running, its output streaming into the tool call as it comes. */
export const WorkingNow: Story = {
  render: (args) => (
    <ThreadFrame>
      <Thread {...args} busy>
        <You at="2m ago">Run the whole suite before you open the pull request.</You>
        <Turn model={CODEX} at="now">
          <WorkedFor took="1m 12s" summary="Running pnpm test" live defaultOpen>
            <Tool kind={ToolKind.Run} verb="Running" target="pnpm test" state={ToolState.Running} copy="pnpm test" defaultOpen>
              <Terminal lines={[' ✓ charges/limit (14)', ' ✓ refunds/router (38)']} live=" ⋯ webhooks/deliver (running 22 of 41)" />
            </Tool>
          </WorkedFor>
          <Prose>
            All refund tests pass. Running the full suite before I open the pull request, since the limiter is shared with charges.
          </Prose>
        </Turn>
      </Thread>
    </ThreadFrame>
  ),
}

export const AllStates: Story = {
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'settled', node: <Thread {...args}>{turns}</Thread> },
        {
          state: 'busy',
          node: (
            <Thread {...args} busy>
              {turns}
            </Thread>
          ),
        },
        { state: 'empty', node: <Thread {...args} /> },
        {
          state: 'wide measure',
          node: (
            <ThreadMeasure wide>
              <span style={{ fontSize: 12, color: 'var(--t-3)' }}>measure + 140px, for sheets beside the thread</span>
            </ThreadMeasure>
          ),
        },
      ]}
    />
  ),
}
