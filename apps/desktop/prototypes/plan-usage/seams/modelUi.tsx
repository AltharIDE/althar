// Scrappy: the kit as every model picker (ModelChoice) sees it. In A to C, each model in the list says what its route has left, the chip may say it beside itself, and the All models browser says it beside each runtime's sign-in. Ninemate's: as built.
import {
  ModelBrowser as KitModelBrowser,
  type ModelBrowserProps,
  type ModelInfo,
  ModelPick as KitModelPick,
  type ModelPickProps,
} from '@althar/ui'

import { usePlanUsage } from '../../../src/renderer/features/usage/useUsage'
import { setBrowserNote } from '../browserNote'
import { ChipSays, ModelNote } from '../parts/Models'
import s from '../parts/plan.module.css'
import { useProto } from '../store'

export * from '@althar/ui'

export function ModelPick(props: ModelPickProps) {
  const { d } = useProto()
  const usage = usePlanUsage()
  if (d === 'N') return <KitModelPick {...props} />
  // The row's note is text in the kit; here it carries the reading, in its ink, after any note of the app's own.
  const note = (info: ModelInfo) => {
    const own = props.note?.(info)
    return (
      <span className={s.usageRow}>
        {own !== undefined && <span className={s.own}>{own}</span>}
        <ModelNote usage={usage} info={info} d={d} />
      </span>
    ) as unknown as string
  }
  return (
    <span className={s.withChip}>
      <KitModelPick {...props} note={note} />
      <ChipSays usage={usage} info={props.model} d={d} />
    </span>
  )
}

export function ModelBrowser(props: ModelBrowserProps) {
  const { d } = useProto()
  const usage = usePlanUsage()
  // Each row's reading, by its own model's route: Opus counts its own week.
  setBrowserNote(d === 'N' ? null : (info) => <ModelNote usage={usage} info={info} d={d} compact />)
  return <KitModelBrowser {...props} />
}
