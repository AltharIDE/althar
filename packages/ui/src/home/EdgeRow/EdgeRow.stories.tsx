import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { EDGE_NEEDS, EDGE_WORK } from '../../fixtures/edge'
import { TaskStatus } from '../../foundations/vocabulary'
import { Button } from '../../primitives/Button/Button'
import { States, statesOn } from '../../storybook/States'
import { EdgeSheet } from '../EdgeSheet/EdgeSheet'
import { NeedCommand } from '../NeedCard/NeedCard'
import { EdgeRow } from './EdgeRow'
import s from './EdgeRow.stories.module.css'

const [PERMISSION, READY] = EDGE_NEEDS
const [RUNNING, , , HELD] = EDGE_WORK
if (!PERMISSION || !READY || !RUNNING || !HELD) throw new Error('The demo needs its rows')

const { id: _r, ...ON } = RUNNING
const meta = {
  title: 'Home/EdgeRow',
  component: EdgeRow,
  decorators: [(Story) => <div className={s.width}>{Story()}</div>],
  args: { ...ON, onOpen: fn() },
} satisfies Meta<typeof EdgeRow>
export default meta
type Story = StoryObj<typeof meta>

const answers = (
  <>
    <Button size="small" variant="signal">
      Allow once
    </Button>
    <Button size="small">Deny</Button>
  </>
)

/** An agent is on it: cobalt and still, with its step, model and time. */
export const Running: Story = {}

/** A permission: what it asks, and its answers, so it is answered without opening Althar. */
export const Permission: Story = {
  args: {
    status: TaskStatus.Yours,
    project: PERMISSION.project,
    title: PERMISSION.title,
    kind: PERMISSION.kind,
    meta: PERMISSION.meta,
    detail: <NeedCommand command={PERMISSION.command ?? ''} />,
    actions: answers,
  },
}

/** Ready to accept: it needs reading first, so its one answer opens it. */
export const ReadyToAccept: Story = {
  args: {
    status: TaskStatus.Yours,
    project: READY.project,
    title: READY.title,
    kind: READY.kind,
    meta: READY.meta,
    detail: 'Pull request 1191 · +212 −41 · 3 checks passed',
    actions: <Button size="small">Review</Button>,
  },
}

/** Just come in: its ring goes out quicker for a moment. */
export const JustCameIn: Story = { args: { ...Permission.args, fresh: true } }

/** Held for a usage limit: it says what it waits for. */
export const Held: Story = { args: { status: HELD.status, project: HELD.project, title: HELD.title, meta: HELD.meta } }

/** Stopped, with no agent on it. */
export const Stopped: Story = { args: { status: TaskStatus.Stopped, meta: 'No agent is working on it' } }

/** A long title stays on one line, and the line under it gives way to the project. */
export const LongTitle: Story = {
  args: {
    title: 'Backfill idempotency keys on every refund created before PR 1184, in batches the read replicas can take',
    meta: 'Implement · Sonnet 5 · 2h 41m, after a usage limit reset at 12:00',
  },
}

/** Nowhere to open it: the title is words. */
export const WithoutOpening: Story = { args: { onOpen: undefined } }

/** On the island's black, inside its sheet, which sets the ink. */
export const OnInk: Story = {
  decorators: [(Story) => <div className={s.ink}>{Story()}</div>],
  render: (args) => (
    <EdgeSheet tone="ink" waiting={1} working={1} needs={<EdgeRow {...args} {...Permission.args} />} work={<EdgeRow {...args} />} />
  ),
}

export const AllStates: Story = {
  parameters: statesOn({ hover: '> div', focus: 'button', pressed: 'button' }),
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'running', node: <EdgeRow {...args} /> },
        { state: 'permission', node: <EdgeRow {...args} {...Permission.args} /> },
        { state: 'ready to accept', node: <EdgeRow {...args} {...ReadyToAccept.args} /> },
        { state: 'just came in', node: <EdgeRow {...args} {...JustCameIn.args} /> },
        { state: 'held', node: <EdgeRow {...args} {...Held.args} /> },
        { state: 'stopped', node: <EdgeRow {...args} {...Stopped.args} /> },
        { state: 'hover', node: <EdgeRow {...args} /> },
        { state: 'focus', node: <EdgeRow {...args} /> },
        { state: 'long title', node: <EdgeRow {...args} {...LongTitle.args} /> },
      ]}
    />
  ),
}
