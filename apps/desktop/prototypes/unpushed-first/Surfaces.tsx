import {
  AcceptPeek,
  ActionButton,
  Board,
  BoardColumn,
  BoardLane,
  Brand,
  Button,
  CheckState,
  Dock,
  Icon,
  NeedLine,
  NeedList,
  TaskStatus,
  WorkCard,
} from '@althar/ui'

import { MERIDIAN } from '../../../../packages/ui/src/fixtures/home'
import { useModelNames } from '../../src/renderer/shared/modelNames'
import { AcceptCard } from './AcceptCard'
import { commitsWord } from './direction'
import board from '../../src/renderer/features/board/Board.module.css'
import p from './proto.module.css'
import type { PushStage } from './scenario'

/*
 * C: the same task where the person is when not in it: its card on the
 * board, its line on the home, and the dock the card opens. Each says what
 * isn't on the pull request yet, with Push, so it shows without opening the
 * task. The dock already puts Push before Accept today.
 */

const TITLE = 'Retry charges the host rate-limits'

export function Surfaces({ stage, onPush }: { stage: PushStage; onPush: () => void }) {
  const named = useModelNames()
  const lead = named('claude-code', 'opus')
  const n = stage === 'ahead' || stage === 'pushing' ? 3 : 0
  const pushing = stage === 'pushing'
  // What the card and the home line say in place of the checks.
  const said =
    n > 0 ? (
      <span className={p.cardLine}>
        <Icon name="up" size={11} />
        {commitsWord(n)} not pushed
        <Button size="small" variant="signal" busy={pushing} onClick={onPush}>
          Push
        </Button>
      </span>
    ) : stage === 'blocked' ? (
      <span className={p.cardLine}>
        <Icon name="hold" size={11} />
        Can’t push: branch rewritten
      </span>
    ) : stage === 'pushed' ? (
      <span className={p.cardQuiet}>
        <Icon name="check" size={11} />
        Pushed just now · all 3 checks passed
      </span>
    ) : undefined
  return (
    <div className={p.surfaces}>
      <section className={p.boardPart} aria-label="The board">
        <Board label="meridian’s board">
          <BoardColumn lane={BoardLane.Running} count={1}>
            <WorkCard
              task="refund-keys"
              title="Return 409 when a refund key is reused"
              status={TaskStatus.Running}
              steps={['Implement', 'Review']}
              at={0}
              elapsed="14m"
              lead={lead}
              // A task still running says it too, in the note it already has.
              note={stage === 'none' ? '' : '2 commits not pushed'}
            />
          </BoardColumn>
          <BoardColumn lane={BoardLane.Yours} count={1}>
            <AcceptCard
              task="retry-charges"
              title={TITLE}
              prs={[{ repo: 'api', number: 214, add: 86, del: 14 }]}
              host={{ name: 'GitHub', brand: Brand.GitHub }}
              checks={3}
              at="18m ago"
              current
              {...(said === undefined ? {} : { unpushed: said })}
              {...(n > 0 ? { text: { kind: 'Push first' } } : stage === 'blocked' ? { text: { kind: 'Needs you' } } : {})}
            />
          </BoardColumn>
        </Board>
      </section>
      <section className={p.homePart} aria-label="The home">
        <NeedList>
          <NeedLine
            kind={n > 0 ? 'Push first' : stage === 'blocked' ? 'Can’t push' : 'Ready to accept'}
            project={MERIDIAN}
            title={TITLE}
            brief={
              n > 0
                ? `api #214 · ${commitsWord(n)} not pushed · checks passed`
                : stage === 'blocked'
                  ? 'api #214 · the branch was rewritten since it was pushed'
                  : stage === 'pushed'
                    ? 'api #214 · pushed just now · checks passed · +86 −14'
                    : 'api #214 · checks passed · +86 −14'
            }
            actions={
              n > 0 ? (
                <>
                  <Button size="small">Review</Button>
                  <Button size="small" variant="signal" busy={pushing} onClick={onPush}>
                    Push {commitsWord(n)}
                  </Button>
                </>
              ) : (
                <Button size="small">{stage === 'blocked' ? 'Look' : 'Review'}</Button>
              )
            }
          />
        </NeedList>
      </section>
      <div className={p.dockPart}>
        <Dock label="Beside the board" name="Ready" sub="althar/retry-charges" onClose={() => {}}>
          <AcceptPeek
            title={TITLE}
            because="Retries a charge the host rate-limits, backing off exponentially."
            repo="meridian/api"
            number={214}
            host={{ name: 'GitHub', brand: Brand.GitHub }}
            lead={lead}
            files={[
              { path: 'src/charges/retry.ts', add: 58, del: 0 },
              { path: 'src/charges/charge.ts', add: 9, del: 14 },
              { path: 'src/charges/retry.test.ts', add: 19, del: 0 },
            ]}
            checks={[
              { id: 'test', name: 'test', state: CheckState.Passed },
              { id: 'lint', name: 'lint', state: CheckState.Passed },
              { id: 'typecheck', name: 'typecheck', state: CheckState.Passed },
            ]}
            onAccept={() => {}}
            onSendBack={() => {}}
            unpushed={n}
            onPush={onPush}
            pushing={pushing}
            {...(stage === 'blocked'
              ? { error: 'Can’t push: the branch was rewritten since it was pushed. Open the task to sort it out.' }
              : {})}
            text={{ unpushed: (k: number) => `${commitsWord(k)} aren’t on the pull request yet` }}
          />
          <div className={board.actions}>
            <ActionButton icon="arrow" onClick={() => {}}>
              Open the task
            </ActionButton>
          </div>
        </Dock>
      </div>
    </div>
  )
}
