// Scrappy: the kit as the window's bar (TabsFrame) sees it. Ninemate's: the Usage button with its count, as built. A: a third gauge after the load meter. B: the load meter itself with the plan as its third gauge (⌘U opens it). C: a figure after the load meter.
import { LoadMeter as KitLoadMeter, type LoadMeterProps, UsageButton as KitUsageButton, type UsageButtonProps } from '@althar/ui'
import { useLayoutEffect } from 'react'

import { MeterWithPlan, PlanFigure, PlanGauge, setBridge } from '../parts/Bar'
import { useProto } from '../store'

export * from '@althar/ui'

export function UsageButton(props: UsageButtonProps) {
  const { d } = useProto()
  const expanded = props.expanded === true
  const toggle = props.onClick as unknown as () => void
  useLayoutEffect(() => setBridge({ expanded, toggle }), [expanded, toggle])
  if (d === 'N') return <KitUsageButton {...props} />
  if (d === 'A') return <PlanGauge expanded={expanded} onToggle={toggle} />
  if (d === 'C') return <PlanFigure expanded={expanded} onToggle={toggle} />
  return null
}

export function LoadMeter(props: LoadMeterProps) {
  const { d } = useProto()
  return d === 'B' ? <MeterWithPlan {...props} /> : <KitLoadMeter {...props} />
}
