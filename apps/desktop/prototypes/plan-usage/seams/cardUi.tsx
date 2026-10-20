// Scrappy: the kit as the Talk room's task cards see it, with the direction's word on the card steering touched, beside its lead: A's quiet line, or B's moved model.
import { TaskCard as KitTaskCard, type TaskCardProps } from '@althar/ui'

import { steerOf } from '../data'
import { MovedModel, SteerLine, steerFor } from '../parts/Steered'
import { useProto } from '../store'

export * from '@althar/ui'

export function TaskCard(props: TaskCardProps) {
  const st = useProto()
  const steer = steerFor(props.title, steerOf(st))
  if (steer === null || steer.to === null || st.d === 'N' || st.d === 'C') return <KitTaskCard {...props} />
  return <KitTaskCard {...props} meta={st.d === 'A' ? <SteerLine steer={steer} /> : <MovedModel steer={steer} />} />
}
