import type { Meta, StoryObj } from '@storybook/react-vite'

import { SINCE } from '../../fixtures/home'
import { States } from '../../storybook/States'
import { SinceRow } from './SinceRow'
import s from './SinceRow.stories.module.css'

const [OPENED, MOVED, FIXED, RESTARTED, ANSWERED] = SINCE
if (!OPENED || !MOVED || !FIXED || !RESTARTED || !ANSWERED) throw new Error('The demo needs what the loop did')
/* An item as its component takes it: without the id that keys it in a list. */
const strip = <T extends { id: string }>(item: T) => {
  const { id: _id, ...rest } = item
  return rest
}

const meta = {
  title: 'Home/SinceRow',
  component: SinceRow,
  decorators: [(Story) => <div className={s.width}>{Story()}</div>],
  args: strip(OPENED),
} satisfies Meta<typeof SinceRow>
export default meta
type Story = StoryObj<typeof meta>

/** A pull request opened while you were away. */
export const PullRequestOpened: Story = {}

/** Work moved to another agent at a usage limit. */
export const MovedAtALimit: Story = { args: strip(MOVED) }

/** A step that went quiet, started afresh. */
export const StartedAfresh: Story = { args: strip(RESTARTED) }

/** Something across every project, which names no project. */
export const Everywhere: Story = { args: strip(ANSWERED) }

/** What happened, with nothing more to say about it. */
export const WithoutDetail: Story = { args: { detail: undefined } }

export const AllStates: Story = {
  render: () => (
    <States
      size="thread"
      cells={[
        ...[OPENED, MOVED, FIXED, RESTARTED].map((event) => ({ state: event.what, node: <SinceRow {...strip(event)} /> })),
        { state: 'everywhere', node: <SinceRow {...strip(ANSWERED)} /> },
        { state: 'no detail', node: <SinceRow {...strip(OPENED)} detail={undefined} /> },
      ]}
    />
  ),
}
