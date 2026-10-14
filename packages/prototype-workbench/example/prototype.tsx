import { prototype, useShared, type View } from '@althar/prototype-workbench'
import { BoardCard, BoardColumn, BoardLane, Brand, Fact, PullChip, Spinner, TaskKind, TaskStatus, type CodeHost } from '@althar/ui'
import type { ReactNode } from 'react'

/*
 * The workbench's example, and where a new prototype can start from: two
 * directions for saying, on a board card, that the lead has commits the pull
 * request doesn't have yet, beside Today's card, which doesn't say. Each is
 * drawn with the kit's own board, at four states of the push. Open the card
 * (press its title) and switch: it stays open in every direction.
 *
 * Serve it with `bun run prototype packages/prototype-workbench/example`.
 */

type Push = 'nothing' | 'waiting' | 'pushing' | 'pushed'

/** What every direction is drawn from, for a state of the push. */
interface Fixtures {
  readonly push: Push
  /** Commits the pull request doesn't have yet. */
  readonly commits: number
}

const GITHUB: CodeHost = { name: 'GitHub', brand: Brand.GitHub }

const card = {
  kind: TaskKind.Change,
  at: '31m',
  title: 'Repair token refresh on privilege change',
  object: <PullChip host={GITHUB} repo="meridian-api" number={1187} add={412} del={37} />,
}

const checksPassed = (
  <Fact icon="check" tone="ok">
    All 8 checks passed
  </Fact>
)

/** The lane the card waits in, with another that needs the person beside it, as on the board. */
function Lane({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', height: '100%' }}>
      <div style={{ display: 'flex', width: 360 }}>
        <BoardColumn lane={BoardLane.Yours} count={2}>
          {children}
          <BoardCard
            status={TaskStatus.Yours}
            word="Question"
            kind={TaskKind.Change}
            at="4m"
            title="Queue refunds that hit the rate limit"
            why="Which database should the refund queue live in?"
          />
        </BoardColumn>
      </div>
    </div>
  )
}

/** The card, opened (pressed) in one direction and so in all of them. */
function Card(props: Omit<Parameters<typeof BoardCard>[0], 'title'>) {
  const [opened, setOpened] = useShared('opened', false)
  return (
    <Lane>
      <BoardCard {...card} {...props} current={opened} onOpen={() => setOpened((was) => !was)} />
    </Lane>
  )
}

/** Today: the card says nothing of commits not pushed. */
function Today() {
  return <Card status={TaskStatus.Yours} word="Ready to accept" foot={checksPassed} />
}

/** A: the card's foot says it, in place of the checks while there is something to push. */
function InTheFoot({ fixtures: { push, commits } }: View<Fixtures>) {
  const foot = {
    nothing: checksPassed,
    waiting: (
      <Fact icon="up" tone="warm">
        {commits} commits not pushed
      </Fact>
    ),
    pushing: (
      <Fact>
        <Spinner size="small" /> Pushing {commits} commits
      </Fact>
    ),
    pushed: (
      <Fact icon="check" tone="ok">
        Pushed {commits} commits just now
      </Fact>
    ),
  }[push]
  return <Card status={TaskStatus.Yours} word="Ready to accept" foot={foot} />
}

/** B: the word on top says it, and the card is cobalt while it pushes, as anything at work is. */
function OnTop({ fixtures: { push, commits } }: View<Fixtures>) {
  switch (push) {
    case 'nothing':
      return <Card status={TaskStatus.Yours} word="Ready to accept" foot={checksPassed} />
    case 'waiting':
      return (
        <Card
          status={TaskStatus.Yours}
          word={`${commits} commits to push`}
          why="The lead committed after the pull request opened. Push them before you accept."
        />
      )
    case 'pushing':
      return <Card status={TaskStatus.Running} word="Pushing" foot={<Fact>{commits} commits</Fact>} />
    case 'pushed':
      return (
        <Card
          status={TaskStatus.Yours}
          word="Ready to accept"
          foot={
            <Fact icon="check" tone="ok">
              Pushed just now · checks running
            </Fact>
          }
        />
      )
  }
}

export default prototype<Fixtures>({
  title: 'Board card: commits not pushed',
  states: [
    { key: 'nothing', name: 'Nothing to push' },
    { key: 'waiting', name: '3 to push' },
    { key: 'pushing', name: 'Pushing' },
    { key: 'pushed', name: 'Pushed' },
  ],
  fixtures: (state) => ({ push: state as Push, commits: state === 'nothing' ? 0 : 3 }),
  today: { render: () => <Today /> },
  directions: [
    { key: 'A', name: 'In the foot', render: (view) => <InTheFoot {...view} /> },
    { key: 'B', name: 'On top', render: (view) => <OnTop {...view} /> },
  ],
})
