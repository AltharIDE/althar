import { useEffect } from 'react'

import { useServices } from '../data/services'
import { accentSheet, accentTokens, applyAccent } from './accent'
import { usePreferences } from './usePreferences'
import { useDesktopChrome } from './useWindowChrome'

/** Lays the system's accent over Althar's while Settings › Appearance says so and it keeps contrast (accent.ts); draws nothing. */
export function SystemAccent() {
  const { host } = useServices()
  const { preferences } = usePreferences()
  const accent = useDesktopChrome(host)?.accent ?? null
  const wanted = preferences.accent === 'system' && accent !== null
  const tokens = wanted ? accentTokens(accent) : undefined
  const sheet = tokens === undefined ? null : accentSheet(tokens)
  useEffect(() => {
    applyAccent(sheet)
    return () => applyAccent(null)
  }, [sheet])
  return null
}
