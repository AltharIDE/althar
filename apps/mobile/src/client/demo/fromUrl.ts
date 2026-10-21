import { Platform } from 'react-native'

import type { Connection } from '../AltharClient'
import type { DemoOptions } from './DemoClient'

/*
 * The demo's options, from the page's address on the web, so a screenshot
 * can show each state: `?connection=away`, `?live=0`.
 */
export const demoOptionsFromUrl = (): DemoOptions => {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return { live: true }
  const params = new URLSearchParams(window.location.search)
  const connection = params.get('connection')
  const states: ReadonlyArray<Connection['state']> = ['unpaired', 'connecting', 'online', 'away']
  return {
    live: params.get('live') !== '0',
    connection: states.find((state) => state === connection) ?? 'online',
    latency: params.get('live') === '0' ? 0 : 250,
  }
}
