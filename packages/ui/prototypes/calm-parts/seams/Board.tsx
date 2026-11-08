// Scrappy: the board, as the direction has it: the case's card, drawn its way, and where Scratch opens.
import { useState } from 'react'

import { TaskKind, BoardLane } from '../../../src/foundations/vocabulary'
import { Board as RealBoard, BoardColumn as RealBoardColumn, type BoardColumnProps, type BoardProps } from '../../../src/board/Board/Board'
import { BoardCard as RealBoardCard, type BoardCardProps } from '../../../src/board/BoardCard/BoardCard'
import { Popover } from '../../../src/primitives/Popover/Popover'
import { VIEWS } from '../directions'
import { needOf } from '../need'
import { CHATS, css, ScratchList } from '../parts'
import { proto, useProto } from '../state'

const KINDS = { change: TaskKind.Change, review: TaskKind.Review, plain: TaskKind.Plain } as const

const toChat = () => {
  proto.go('scratch')
  window.location.hash = '#/threads/th1'
}

export function BoardCard(props: BoardCardProps) {
  const p = useProto()
  const c = proto.current()
  if (props.title !== c.title || c.lane === 'scratch' || c.lane === 'settled') return <RealBoardCard {...props} />
  const over = VIEWS[p.direction].card(c, needOf(c, p.answered))
  const { why: _why, object: _object, foot: _foot, next: _next, ...rest } = props
  return (
    <RealBoardCard
      {...rest}
      word={c.word}
      kind={KINDS[c.kind]}
      local={c.changes.some((one) => one.place === 'local')}
      {...(c.changes.some((one) => one.toward !== undefined) ? { toward: c.changes.find((one) => one.toward !== undefined)?.toward ?? '' } : {})}
      {...over}
    />
  )
}

/** A's Scratch: one chip, at the board's foot, opening in place. */
function ScratchChip({ opened }: { opened: boolean }) {
  return (
    <Popover
      label="Scratch"
      placement="above"
      align="start"
      width={340}
      padded={false}
      defaultOpen={opened}
      trigger={
        <button type="button" className={css.scratchChip}>
          Scratch <b>{CHATS.length}</b>
        </button>
      }
    >
      <div className={css.scratchHead}>
        <span className={css.scratchTitle}>Scratch</span>
        <span className={css.note}>Chats, by their latest exchange</span>
      </div>
      <ScratchList onOpen={toChat} />
    </Popover>
  )
}

export function Board(props: BoardProps) {
  const p = useProto()
  if (VIEWS[p.direction].scratch !== 'corner') return <RealBoard {...props} />
  return (
    <div style={{ position: 'relative', height: '100%' }}>
      <RealBoard {...props} />
      <div style={{ position: 'absolute', bottom: 16, left: 16 }}>
        <ScratchChip opened={p.opening === 'scratch'} />
      </div>
    </div>
  )
}

/** B's Scratch: a shelf of Up next, as Kept is of Settled, showing the chats in its place. */
export function BoardColumn(props: BoardColumnProps) {
  const p = useProto()
  const [shelf, setShelf] = useState(p.opening === 'scratch' ? 'scratch' : 'next')
  if (props.lane !== BoardLane.Next || VIEWS[p.direction].scratch !== 'shelf') return <RealBoardColumn {...props} />
  return (
    <RealBoardColumn
      {...props}
      filled
      shelves={{
        label: 'Up next or Scratch',
        value: shelf,
        onChange: setShelf,
        options: [
          { value: 'next', label: 'Up next', count: props.count },
          { value: 'scratch', label: 'Scratch', count: CHATS.length },
        ],
      }}
    >
      {shelf === 'scratch' ? <ScratchList onOpen={toChat} /> : props.children}
    </RealBoardColumn>
  )
}
