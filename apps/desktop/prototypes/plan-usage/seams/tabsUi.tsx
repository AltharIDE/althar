// Scrappy: the kit as the window's bar (TabsFrame) sees it. Ninemate's: the Usage button with its count, as built. A: the quiet chip in its place, opened by the bar's own ⌘U. B and C: nothing in the bar.
import { UsageButton as KitUsageButton, type UsageButtonProps } from '@althar/ui'

import { BarChip } from '../parts/BarChip'
import { useProto } from '../store'

export * from '@althar/ui'

export function UsageButton(props: UsageButtonProps) {
  const { d } = useProto()
  if (d === 'N') return <KitUsageButton {...props} />
  if (d === 'A') return <BarChip expanded={props.expanded === true} onToggle={() => (props.onClick as unknown as () => void)()} />
  return null
}
