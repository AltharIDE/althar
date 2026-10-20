// Scrappy: the kit as every model picker (ModelChoice) sees it. In B, each model in the list says what its route has left, and a chip whose route is under a tenth says so beside it: in a composer, and on each step of a plan.
import { type ModelInfo, ModelPick as KitModelPick, type ModelPickProps } from '@althar/ui'

import { usePlanUsage } from '../../../src/renderer/features/usage/useUsage'
import { ChipWarning, ModelNote } from '../parts/ModelUsage'
import s from '../parts/parts.module.css'
import { useProto } from '../store'

export * from '@althar/ui'

export function ModelPick(props: ModelPickProps) {
  const { d } = useProto()
  const usage = usePlanUsage()
  if (d !== 'B') return <KitModelPick {...props} />
  // The row's note is text in the kit; here it carries the reading, in its ink.
  const note = (info: ModelInfo) => (<ModelNote usage={usage} info={info} />) as unknown as string
  return (
    <span className={s.withWarn}>
      <KitModelPick {...props} note={note} />
      <ChipWarning usage={usage} info={props.model} />
    </span>
  )
}
