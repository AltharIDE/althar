import { MeterGlyph, meterText, type MeterText } from '../Meter/Meter'
import { PeekReadout, type PeekReadoutProps } from '../Peek/Peek'
import { percent } from '../usage'

/*
 * The recommendation: direction A's meter at rest, opening direction D's
 * peek. The meter says how loaded the Mac is without being asked, and holds
 * still while it does; the peek says who is loading it, when asked. Made
 * of the two, not drawn again.
 */

export interface RecommendedProps extends Omit<PeekReadoutProps, 'glyph'> {
  /** The meter's own words; the peek's are `text`. */
  meterText?: Partial<MeterText>
}

export function Recommended({ usage, text, meterText: own, ...rest }: RecommendedProps) {
  const m = { ...meterText, ...own }
  return (
    <PeekReadout
      {...rest}
      usage={usage}
      glyph={<MeterGlyph usage={usage} text={m} />}
      text={{ label: () => m.label(percent(usage.cpu), percent(usage.memory)), ...text }}
    />
  )
}
