// Scrappy: the wait for a reply as the app now reckons it (C, built), kept out of the comparison. Today, as it was before the
// build: no wait held, so the previous reply looks at work again in the gap, and a message the agent is about to read reads as
// queued. In every direction, the app's reckoning, which leaves the previous reply over; its Thinking is dropped (adjust.ts), so
// only the direction's sign of life shows.
import { get } from './store'

/** Whether the thread holds a wait for the reply: never, today. */
export const waits = (app: boolean): boolean => get().d !== 'T' && app

/** Whether what waits after the last reply is being read now: unsaid, today. */
export const reading = (app: boolean | undefined): boolean | undefined => (get().d === 'T' ? undefined : app)
