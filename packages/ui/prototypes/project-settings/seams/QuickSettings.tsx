// Scrappy: the gear at the bar's end. In J, it opens the one search for every setting.
import { useEffect } from 'react'

import { QuickSettings as Real } from '../../../../../apps/desktop/src/renderer/features/settings/QuickSettings'
import type { Section as AppSection } from '../../../../../apps/desktop/src/renderer/features/settings/sections'
import { JGear } from '../directions/J'
import { useProto } from '../state'

export interface QuickProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSettings: (section: AppSection | null) => void
}

/** The bar's way to the Settings tab, at a section, kept for the project's rows that point to the app's connections. */
let opening: ((section: AppSection | null) => void) | null = null
export const openAppSettings = (section: AppSection | null) => opening?.(section)

export function QuickSettings(props: QuickProps) {
  const p = useProto()
  useEffect(() => {
    opening = props.onSettings
  }, [props.onSettings])
  if (p.direction === 'J') return <JGear {...props} />
  return <Real {...props} />
}
