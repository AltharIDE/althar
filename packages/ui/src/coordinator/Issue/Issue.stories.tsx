import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { MER_231 } from '../../fixtures/coordinator'
import { Brand } from '../../foundations/brands/brands'
import { IssuePriority, IssueStatus } from '../../foundations/vocabulary'
import { States, statesOn } from '../../storybook/States'
import { From, Issue, IssueUnread } from './Issue'
import { PriorityGlyph, StatusGlyph } from './glyphs'

const meta = {
  title: 'Coordinator/Issue',
  component: Issue,
  args: MER_231,
  decorators: [
    (Story) => (
      <div style={{ width: 540 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Issue>
export default meta
type Story = StoryObj<typeof meta>

/** A Linear issue, unfurled: Linear's colour, and its field of squares on the right. */
export const Linear: Story = {}

/** Any other tracker: in ink. */
export const Jira: Story = {
  args: {
    mark: Brand.Jira,
    source: 'Jira',
    id: 'PAY-212',
    title: 'Refund webhooks retry too fast after a 429',
    href: 'https://meridian.atlassian.net/browse/PAY-212',
    status: { state: IssueStatus.InProgress, label: 'In Progress' },
    priority: { level: IssuePriority.Medium, label: 'Medium' },
    meta: 'Payments',
    tone: 'plain',
  },
}

/** The tracker is not connected: what went wrong, and a way to fix it. */
export const Unread: Story = {
  render: () => (
    <IssueUnread mark={Brand.Linear} source="Linear" id="MER-240" reason="Linear isn’t connected to Meridian yet" onConnect={fn()} />
  ),
}

/** Every workflow state and priority, as drawn. */
export const Glyphs: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 14, color: 'var(--t-2)' }}>
      {Object.values(IssueStatus).map((x) => (
        <StatusGlyph key={x} status={x} />
      ))}
      {Object.values(IssuePriority).map((x) => (
        <PriorityGlyph key={x} priority={x} />
      ))}
    </div>
  ),
}

export const AllStates: Story = {
  parameters: statesOn({ hover: 'a', focus: 'a', pressed: 'a' }),
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'linear', node: <Issue {...args} /> },
        { state: 'linear, hover', force: 'hover', node: <Issue {...args} /> },
        { state: 'linear, focus', force: 'focus', node: <Issue {...args} /> },
        { state: 'plain', node: <Issue {...args} {...Jira.args} /> },
        { state: 'no status, no priority', node: <Issue {...args} status={undefined} priority={undefined} meta={undefined} /> },
        {
          state: 'long title',
          node: <Issue {...args} title="Backfill idempotency keys on every refund created before PR 1184, including partial refunds" />,
        },
        {
          state: 'unread',
          node: (
            <IssueUnread
              mark={Brand.Linear}
              source="Linear"
              id="MER-240"
              reason="Linear isn’t connected to Meridian yet"
              onConnect={() => {}}
            />
          ),
        },
        {
          state: 'unread, no fix',
          node: <IssueUnread mark={Brand.Linear} source="Linear" id="MER-240" reason="You don’t have access to this issue" />,
        },
        { state: 'from, linear', node: <From mark={Brand.Linear} id="MER-231" linear /> },
        { state: 'from, plain', node: <From mark={Brand.Jira} id="PAY-212" /> },
      ]}
    />
  ),
}
