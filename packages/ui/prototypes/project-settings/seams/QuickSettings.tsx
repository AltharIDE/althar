// Scrappy: the gear at the bar's end. In E, on a project's screen, it leads with that project.
import { useEffect } from 'react'

import { QuickSettings as Real } from '../../../../../apps/desktop/src/renderer/features/settings/QuickSettings'
import type { Section as AppSection } from '../../../../../apps/desktop/src/renderer/features/settings/sections'
import { EQuick, type QuickProps, useOnProject } from '../directions/E'
import { proto, useProto } from '../state'

/** The bar's way to the Settings tab, at a section, kept for the project's rows that point to the app's connections. */
let opening: ((section: AppSection | null) => void) | null = null
export const openAppSettings = (section: AppSection | null) => {
  proto.set({ inSettings: false })
  opening?.(section)
}

export function QuickSettings(props: QuickProps) {
  const p = useProto()
  const onProject = useOnProject()
  useEffect(() => {
    opening = props.onSettings
  }, [props.onSettings])
  if (p.direction === 'E' && onProject) return <EQuick {...props} />
  return <Real {...props} />
}
