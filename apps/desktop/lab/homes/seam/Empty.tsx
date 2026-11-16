import { PARTS } from '../directions'
import { useLab } from '../state'

/** A home's window with no projects yet: the direction's, in StartView's place for it. */
export function RemoteEmpty() {
  const { d } = useLab()
  const { Empty } = PARTS[d]
  return <Empty />
}
