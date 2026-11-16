import type { Host } from '../../../src/renderer/data/services'
import { PARTS } from '../directions'
import { useLab } from '../state'

/*
 * features/homes/HomeConnections.tsx, as the app imports it in the lab: the
 * direction's button at the end of the window's bar. What opens over the
 * window is mounted by the lab's page, beside each window's router.
 */

export function HomeButton() {
  const { d } = useLab()
  const { Button } = PARTS[d]
  return <Button />
}

export function HomeConnections({ host, windowId }: { host: Host; windowId: string }) {
  const { d } = useLab()
  const { Overlays } = PARTS[d]
  return <Overlays host={host} windowId={windowId} />
}
