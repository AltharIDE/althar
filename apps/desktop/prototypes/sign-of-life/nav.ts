// Scrappy: what a direction's words can do, wired by the page once the app is up: Stop, and Send again through the real composer.
import type { Screen } from './data'

export const actions = {
  stop: (_screen: Screen): void => undefined,
  sendAgain: (_screen: Screen, _text: string): void => undefined,
}
