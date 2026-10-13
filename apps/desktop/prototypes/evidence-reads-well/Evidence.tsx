import { type EvidenceProps } from '../../../../packages/ui/src/index'
import { Evidence as Today } from '../../../../packages/ui/src/thread/Evidence/Evidence'
import { useDirection, useScenario } from './direction'
import { A, B, C, D, E } from './directions'
import s from './directions.module.css'
import { Built } from './parts'

/*
 * The kit's Evidence, as the page's direction draws it. The app draws it in
 * two places: under a step's report in the thread (a heading of level 4),
 * and on Outputs (level 2), where the summary of what was built sits
 * directly above it.
 */

export type Face = 'thread' | 'out'

export interface DirectionProps {
  pieces: EvidenceProps['pieces']
  unverified: readonly string[]
  face: Face
}

export function Evidence({ pieces, unverified = [], headingLevel = 3, text: _text, className: _className, ...rest }: EvidenceProps) {
  const direction = useDirection()
  const scenario = useScenario()
  const face: Face = headingLevel === 2 ? 'out' : 'thread'
  if (direction === 'today')
    return face === 'out' ? (
      <>
        <Built source={scenario.built} />
        <Today pieces={pieces} unverified={unverified} headingLevel={headingLevel} {...rest} />
      </>
    ) : (
      <Today pieces={pieces} unverified={unverified} headingLevel={headingLevel} {...rest} />
    )
  const props = { pieces, unverified, face }
  const drawn = draw(direction, props)
  // Under a step, set apart from the report above it.
  return face === 'thread' ? <div className={s.inThread}>{drawn}</div> : drawn
}

function draw(direction: string, props: DirectionProps) {
  switch (direction) {
    case 'a':
      return <A {...props} />
    case 'b':
      return <B {...props} />
    case 'c':
      return <C {...props} />
    case 'd':
      return <D {...props} />
    case 'e':
      return <E {...props} />
    default:
      return null
  }
}
