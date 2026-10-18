import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { OPUS } from '../../fixtures/models'
import { SHOT_AFTER, SHOT_BEFORE } from '../../fixtures/shots'
import { EvidenceKind, ToolKind, ToolState } from '../../foundations/vocabulary'
import { States } from '../../storybook/States'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { AltharLine } from '../AltharLine/AltharLine'
import { Checked } from '../Checked/Checked'
import { Gallery } from '../Gallery/Gallery'
import { Markdown } from '../Markdown/Markdown'
import { Relayed } from '../Relayed/Relayed'
import { Thread } from '../Thread/Thread'
import { Tool } from '../Tool/Tool'
import { WorkLine, WorkSaid } from '../WorkLine/WorkLine'
import { You } from '../You/You'
import { Round } from './Round'

const work = (
  <>
    <Tool kind={ToolKind.Read} verb="Read" target="src/refunds/router.ts" state={ToolState.Done} />
    <WorkSaid source="The router checks the window already; the refusal just never says why." />
    <Tool kind={ToolKind.Edit} verb="Edited" target="src/refunds/router.ts" state={ToolState.Done} />
    <Tool kind={ToolKind.Run} verb="Ran" target="bun run test refunds" state={ToolState.Done} />
  </>
)

const ACK =
  'Got it: a refused refund should say why. I’ll find where the refusal is made, add the reason there, and show it on the order page.'
const RESULT = [
  'A refused refund now says why, under the button: “Past the 30-day window (34 days)”.',
  '',
  '- The reason comes from the router, so the API answers it too (`422` with `refund_window_closed`).',
  '- Try it on any order older than 30 days at http://localhost:5173/orders.',
].join('\n')

const meta = {
  title: 'Thread/Round',
  component: Round,
  decorators: [threadDecorator],
  args: { model: OPUS, at: '12m ago', children: null },
} satisfies Meta<typeof Round>
export default meta
type Story = StoryObj<typeof meta>

/** A round as the lead answers what was asked: its acknowledgement, its work in one faint line, and its result with what it showed. */
export const Answered: Story = {
  render: (args) => (
    <Thread label="Thread">
      <You at="14m ago">Can a refused refund say why it was refused?</You>
      <Round {...args}>
        <Markdown source={ACK} />
        <WorkLine took="11m 40s" summary="edited 2 files, read 4 files, ran 6 commands">
          {work}
        </WorkLine>
        <Markdown source={RESULT} />
        <Gallery
          shots={[
            { ...SHOT_BEFORE, id: 'before', caption: 'Before: the refund button with no reason' },
            { ...SHOT_AFTER, id: 'after', caption: 'After: the reason under the refused refund' },
          ]}
        />
        <Checked
          pieces={[
            {
              id: 'tests',
              kind: EvidenceKind.TestRun,
              caption: 'The refund tests, with the new refused case',
              form: 'output',
              command: 'bun run test refunds',
              exit: 0,
              lines: ['      Tests  2 passed (2)'],
            },
          ]}
          unverified={['Not seen in Safari']}
        />
      </Round>
    </Thread>
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('article', { name: OPUS.name })).toBeInTheDocument()
    await expect(c.getByRole('button', { name: /Worked 11m 40s/ })).toBeInTheDocument()
  },
}

/** Another round the coordinator asked for, its lead at work: the line says what it is on. */
export const AtWork: Story = {
  render: (args) => (
    <Thread label="Thread">
      <Relayed title="one more round" body="they’d like the reason in the order list too, not only on the order page." />
      <Round {...args} at="1m ago">
        <Markdown source="On it: the reason in the order list as well, from the same place." />
        <WorkLine live took="48s" summary="Adding the reason to the list row">
          {work}
        </WorkLine>
      </Round>
    </Thread>
  ),
}

/** What Althar says between rounds, and a round that said nothing. */
export const Between: Story = {
  render: () => (
    <Thread label="Thread">
      <AltharLine>PR #142 conflicts with main, in 2 files. Althar asked the lead to resolve it, as the project’s rules say.</AltharLine>
      <WorkLine who={OPUS} took="43s" summary="ran 7 commands">
        {work}
      </WorkLine>
    </Thread>
  ),
}

export const AllStates: Story = {
  render: (args) => (
    <States
      size="thread"
      cells={[
        {
          state: 'answered',
          node: (
            <Round {...args}>
              <Markdown source={ACK} />
              <WorkLine took="11m 40s" summary="edited 2 files, ran 6 commands">
                {work}
              </WorkLine>
              <Markdown source={RESULT} />
            </Round>
          ),
        },
        {
          state: 'at work',
          node: (
            <Round {...args}>
              <Markdown source={ACK} />
              <WorkLine live took="48s" summary="Adding the reason to the list row" />
            </Round>
          ),
        },
        {
          state: 'a reviewer',
          node: (
            <Round {...args} part="Review">
              <Markdown source="Looks good to me." />
            </Round>
          ),
        },
        {
          state: 'dark',
          node: (
            <Round {...args}>
              <Markdown source={ACK} />
              <WorkLine took="11m 40s" summary="edited 2 files">
                {work}
              </WorkLine>
            </Round>
          ),
          dark: true,
        },
      ]}
    />
  ),
}
