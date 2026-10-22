// Scrappy: the warnings at the foot of the open coordinator's Talk room: ninemate's, as built; none in A, B or C.
import { UsageNotices as Built } from '../../../src/renderer/features/usage/UsageNotices'
import { useProto } from '../store'

export function UsageNotices() {
  const { d } = useProto()
  return d === 'N' ? <Built /> : null
}
