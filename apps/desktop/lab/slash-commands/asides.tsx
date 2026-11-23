import { AsideTabs as KitAsideTabs } from '@althar/ui'
import { type ComponentProps, useEffect, useSyncExternalStore } from 'react'

/*
 * The kit, as the project's asides take it in the lab: its tabs as they are,
 * which the lab's bar can ask to open an aside or the coordinator's
 * conversation, as a press on a tab would.
 */
export * from '@althar/ui'

/** What the bar asked to open: an aside's task id, or null for the coordinator's; undefined once opened. */
let asked: string | null | undefined
let count = 0
const heard = new Set<() => void>()
export const openConversation = (id: string | null) => {
  asked = id
  count += 1
  for (const listener of heard) listener()
}
const subscribe = (listener: () => void) => {
  heard.add(listener)
  return () => heard.delete(listener)
}

export function AsideTabs(props: ComponentProps<typeof KitAsideTabs>) {
  const asking = useSyncExternalStore(subscribe, () => count)
  const { onPick } = props
  useEffect(() => {
    if (asked === undefined) return
    const id = asked
    asked = undefined
    onPick(id)
  }, [asking, onPick])
  return <KitAsideTabs {...props} />
}
