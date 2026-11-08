// Scrappy: Althar's line, where it carries a block's key, is the direction's block; a turn's line says where its time went.
import { AltharLine as RealAltharLine, type AltharLineProps } from '../../../src/thread/AltharLine/AltharLine'
import { WorkedFor as RealWorkedFor, type WorkedForProps } from '../../../src/thread/WorkedFor/WorkedFor'
import { timeOf, VIEWS } from '../directions'
import { useProto } from '../state'
import { BLOCKS, drawing, TIMES } from '../thread'

export function AltharLine(props: AltharLineProps) {
  useProto()
  const key = typeof props.children === 'string' ? /^⟦(b\d+)⟧$/.exec(props.children)?.[1] : undefined
  if (key === undefined) return <RealAltharLine {...props} />
  return <>{BLOCKS.get(key)?.()}</>
}

export function WorkedFor(props: WorkedForProps) {
  const { direction } = useProto()
  const known = TIMES.get(props.took)
  if (known === undefined || drawing === null || props.live === true) return <RealWorkedFor {...props} />
  const words = VIEWS[direction].took(drawing, props.took, known.t, known.beat)
  return (
    <RealWorkedFor {...props} text={{ ...props.text, took: () => `Worked for ${words}` }}>
      {timeOf(known.t)}
      {props.children}
    </RealWorkedFor>
  )
}
