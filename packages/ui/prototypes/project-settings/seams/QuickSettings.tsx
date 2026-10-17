// Scrappy: the gear at the bar's end, the app's own; kept here so the project's rows that point to the app's connections can open its Settings tab.
import { useEffect } from 'react'

import { QuickSettings as Real } from '../../../../../apps/desktop/src/renderer/features/settings/QuickSettings'
import type { Section as AppSection } from '../../../../../apps/desktop/src/renderer/features/settings/sections'

export interface QuickProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSettings: (section: AppSection | null) => void
}

/** The bar's way to the Settings tab, at a section. */
let opening: ((section: AppSection | null) => void) | null = null
export const openAppSettings = (section: AppSection | null) => opening?.(section)

export function QuickSettings(props: QuickProps) {
  useEffect(() => {
    opening = props.onSettings
  }, [props.onSettings])
  return <Real {...props} />
}
