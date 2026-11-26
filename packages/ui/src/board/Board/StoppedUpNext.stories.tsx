import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { BoardLane, Wait } from '../../foundations/vocabulary'
import { FoldedRow } from '../FoldedRow/FoldedRow'
import { NextRow } from '../NextRow/NextRow'
import { Board, BoardColumn, BoardList } from './Board'

/*
 * Up next with two tasks a lead stopped once their work went into its own
 * task: under what waits, quiet rows saying where the work went, Resume on
 * hover, rather than cards waiting on the person.
 */

const PAIRING = 'Phone pairs with this Mac over Wi-Fi'

function UpNext() {
  return (
    <Board label="Althar’s work">
      <BoardColumn lane={BoardLane.Next} count={2}>
        <BoardList>
          <NextRow
            place={1}
            task=""
            text={{ task: () => '' }}
            title="Slim the coordinator’s brief"
            wait={Wait.You}
            reason="Held. Starts when you say"
            onOpen={() => undefined}
          />
        </BoardList>
        <BoardList>
          <FoldedRow
            title="Mobile: crisp pull-to-reload icon, no scroll jump after"
            into={PAIRING}
            at="just now"
            onOpenInto={() => undefined}
            onOpen={() => undefined}
            onResume={() => undefined}
          />
          <FoldedRow
            title="Mobile: model picker’s segment control doesn’t change model"
            into={PAIRING}
            at="just now"
            onOpenInto={() => undefined}
            onOpen={() => undefined}
            onResume={() => undefined}
          />
        </BoardList>
      </BoardColumn>
    </Board>
  )
}

const meta = { title: 'Board/StoppedUpNext', component: UpNext } satisfies Meta<typeof UpNext>
export default meta
type Story = StoryObj<typeof meta>

/** Work folded into another task, settled in all but name. */
export const Stopped: Story = {
  play: async ({ canvasElement }) => {
    const lane = within(canvasElement)
    await expect(lane.queryByText('Stopped')).toBeNull()
    await expect(lane.getAllByText('Folded into')).toHaveLength(2)
  },
}
