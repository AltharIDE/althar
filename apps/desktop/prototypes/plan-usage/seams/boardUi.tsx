// Scrappy: the kit as the board sees it, with each direction's word on the card of the task steering touched. A: one quiet line at its foot. B: the model it went to, marked as moved. Ninemate's and C: the card as the app draws it (held work says who it waits for, as every direction's does).
import { BoardCard as KitBoardCard, type BoardCardProps } from '@althar/ui'

import { steerOf } from '../data'
import { MovedModel, SteerLine, steerFor } from '../parts/Steered'
import { useProto } from '../store'

export * from '@althar/ui'

export function BoardCard(props: BoardCardProps) {
  const st = useProto()
  const steer = steerFor(props.title, steerOf(st))
  if (steer === null || steer.to === null || st.d === 'N' || st.d === 'C') return <KitBoardCard {...props} />
  const said = st.d === 'A' ? <SteerLine steer={steer} /> : <MovedModel steer={steer} />
  return (
    <KitBoardCard
      {...props}
      foot={
        props.foot === undefined || props.foot === null ? (
          said
        ) : (
          <>
            {props.foot}
            {said}
          </>
        )
      }
    />
  )
}
