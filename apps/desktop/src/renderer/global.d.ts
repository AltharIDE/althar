import type { Host } from './data/services'

declare global {
  interface Window {
    /** What the preload exposes. */
    readonly althar: Host
  }
}
