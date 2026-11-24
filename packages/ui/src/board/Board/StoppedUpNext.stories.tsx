import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { BoardLane, TaskStatus, Wait } from '../../foundations/vocabulary'
import { NextStep } from '../../primitives/NextStep/NextStep'
import { trackOf } from '../../primitives/StepTrack/StepTrack'
import { BoardCard } from '../BoardCard/BoardCard'
import { FoldedRow } from '../FoldedRow/FoldedRow'
import { NextRow } from '../NextRow/NextRow'
import { Board, BoardColumn, BoardList } from './Board'

/*
 * Up next as the app lays out stopped work under what waits: a card for a
 * task stopped with a reason, apart from the rest as cards are, saying who
 * stopped it and why; under it, quiet rows for tasks whose work went on in
 * another, Resume on hover.
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
        <BoardCard
          status={TaskStatus.Stopped}
          word="Stopped"
          at="12m ago"
          title="Mobile: thread list loses its place after a reconnect"
          why={`Stopped by ${PAIRING}: its reconnect code is being rewritten there first`}
          track={trackOf(['Implement', 'Review'], 0)}
          startedBy={PAIRING}
          onOpenStartedBy={() => undefined}
          next={
            <NextStep signal onPress={() => undefined}>
              Resume
            </NextStep>
          }
          onOpen={() => undefined}
        />
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

/** Who stopped each and why; work folded into another task, settled in all but name. */
export const Stopped: Story = {
  play: async ({ canvasElement }) => {
    const lane = within(canvasElement)
    await expect(lane.getByText(`Stopped by ${PAIRING}: its reconnect code is being rewritten there first`)).toBeInTheDocument()
    await expect(lane.getAllByText('Folded into')).toHaveLength(2)
  },
}
