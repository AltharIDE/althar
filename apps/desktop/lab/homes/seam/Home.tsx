import { Home as Real, type HomeProps } from '@althar/ui/screens'

import { PARTS } from '../directions'
import { useLab } from '../state'

/** The Home screen: the direction's, where it changes it. */
export function Home(props: HomeProps) {
  const { d } = useLab()
  const { Home: Changed } = PARTS[d]
  return Changed === undefined ? <Real {...props} /> : <Changed {...props} Real={Real} />
}
