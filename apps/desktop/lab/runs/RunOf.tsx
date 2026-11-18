import { RunCard } from '@althar/ui'

import { RunOf as AppRunOf } from '../../src/renderer/shared/RunOf'
import { runCardOf } from '../../src/renderer/shared/running'
import { useLab } from './state'
import { useWorld, world } from './world'

/*
 * A run's card in the coordinator's thread, as the lab gives it
 * (vite.config.ts's seam). Today's is the app's own: what it printed in a
 * console over the card. Elsewhere the card is the same, and its console
 * opens the run where the direction keeps it: along the foot (B and its
 * spin-offs), or in the terminal's tab (D).
 */

export function RunOf(props: Parameters<typeof AppRunOf>[0]) {
  const { d } = useLab()
  useWorld()
  const id = props.run.launchId
  const run = world.run(id)
  if (d === 'today' || run === undefined) return <AppRunOf {...props} />
  const card = {
    ...runCardOf(props.run),
    ...(run.url === null
      ? {}
      : { url: run.url.replace(/^https?:\/\//, '').replace(/\/$/, ''), onOpen: () => window.open(run.url ?? '', '_blank') }),
    ...(run.ended === null ? { onStop: () => props.onStop(id) } : { onRunAgain: () => props.onRunAgain(null, run.runnableId) }),
  }
  return (
    <RunCard
      {...card}
      output={{ text: '' }}
      outputOpen={false}
      onOutputOpenChange={(open) => {
        if (open) world.show({ kind: 'run', id })
      }}
    />
  )
}
